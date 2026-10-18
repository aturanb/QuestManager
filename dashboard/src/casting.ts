import type { CastFailureCode, CastRequestError } from "./types";
import { createNativeRtcAdapter, type BrowserRtcAdapter, type BrowserRtcPeer } from "./browser-rtc";

/** WebRTC signaling union mirrored from the shared protocol. */
export type RtcSignal =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };

export type CastViewState =
  | { phase: "connecting" }
  | { phase: "awaiting_approval" }
  | { phase: "negotiating" }
  | { phase: "live" }
  | { phase: "failed"; error: CastFailureCode | CastRequestError };

export type CastClientCallbacks = {
  onState(state: CastViewState): void;
  onStream(stream: MediaStream): void;
  onUnauthorized(): void;
};

/** Minimal WebSocket surface so tests never touch a real network. */
export type CastSocket = {
  send(data: string): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; wasClean?: boolean }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type CastClientOptions = {
  sessionId: string;
  socketUrl: string;
  callbacks: CastClientCallbacks;
  /** Injected in tests; defaults to native RTCPeerConnection. */
  rtc?: BrowserRtcAdapter;
  /** Injected in tests; defaults to a real WebSocket. */
  openSocket?: (url: string) => CastSocket;
  /** Idempotent server cleanup (DELETE /api/casts/:id). */
  stopSession?: () => Promise<void>;
};

/** Narrow native WebSocket events to the minimal CastSocket surface. */
function wrapWebSocket(ws: WebSocket): CastSocket {
  const socket: CastSocket = {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  ws.onmessage = (event) => socket.onmessage?.({ data: event.data });
  ws.onclose = (event) => socket.onclose?.({ code: event.code, wasClean: event.wasClean });
  ws.onerror = (event) => socket.onerror?.(event);
  return socket;
}

const FAILURE_CODES: readonly CastFailureCode[] = [
  "consent_denied",
  "approval_timeout",
  "negotiation_timeout",
  "projection_stopped",
  "peer_disconnected",
  "capture_failed",
  "internal_error",
];

function normalizeFailure(error: unknown): CastFailureCode {
  return typeof error === "string" && (FAILURE_CODES as readonly string[]).includes(error)
    ? (error as CastFailureCode)
    : "internal_error";
}

/**
 * Owns one browser-side live-view session: the dedicated signaling socket, one
 * RTCPeerConnection with no ICE servers, the answer, trickled ICE, and media
 * cleanup. The remote MediaStream is handed to the UI once and never copied
 * into application state.
 */
export class CastClient {
  private readonly options: CastClientOptions;
  private readonly rtc: BrowserRtcAdapter;
  private readonly openSocket: (url: string) => CastSocket;
  private readonly stopSession: (() => Promise<void>) | null;
  private socket: CastSocket | null = null;
  private peer: BrowserRtcPeer | null = null;
  private state: CastViewState = { phase: "connecting" };
  private readonly pendingIce: Extract<RtcSignal, { kind: "ice" }>[] = [];
  private readonly receivedTracks = new Set<MediaStreamTrack>();
  private remoteReady = false;
  private pumping = false;
  private offerInstalled = false;
  private streamDelivered = false;
  private closed = false;
  private cleanupPromise: Promise<void> | null = null;

  constructor(options: CastClientOptions) {
    this.options = options;
    this.rtc = options.rtc ?? createNativeRtcAdapter();
    this.openSocket = options.openSocket ?? ((url) => wrapWebSocket(new WebSocket(url)));
    this.stopSession = options.stopSession ?? null;
  }

  get viewState(): CastViewState {
    return this.state;
  }

  start(): void {
    if (this.closed) return;
    this.emit({ phase: "connecting" });
    const socket = this.openSocket(this.options.socketUrl);
    this.socket = socket;
    socket.onmessage = (event) => this.handleRaw(event?.data);
    socket.onclose = (event) => this.handleSocketClose(Number(event?.code ?? 1000));
    socket.onerror = () => {
      /* a close event follows; cleanup happens there */
    };
  }

  /** User stop, modal close, or unmount. Idempotent and safe during negotiation. */
  close(): Promise<void> {
    return this.cleanup({ deleteRemote: true });
  }

  private handleRaw(raw: unknown): void {
    if (this.closed || typeof raw !== "string") return;
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return; // malformed frames are ignored, never thrown
    }
    if (!message || typeof message !== "object") return;
    if (message.sessionId !== this.options.sessionId) return; // late or foreign session
    if (message.type === "cast_status" && typeof message.status === "string") {
      this.handleStatus(message.status, message.error);
    } else if (message.type === "cast_signal" && message.signal && typeof message.signal === "object") {
      const signal = message.signal as RtcSignal;
      if (signal.kind === "offer" && typeof signal.sdp === "string") {
        void this.installOffer(signal.sdp);
      } else if (signal.kind === "ice" && typeof signal.candidate === "string") {
        this.enqueueIce({
          kind: "ice",
          candidate: signal.candidate,
          sdpMid: signal.sdpMid ?? null,
          sdpMLineIndex: signal.sdpMLineIndex ?? null,
        });
      } else if (signal.kind === "answer") {
        // The viewer never receives an answer; ignore.
      }
    }
  }

  private handleStatus(status: string, error: unknown): void {
    if (this.closed) return;
    switch (status) {
      case "awaiting_approval":
        this.emit({ phase: "awaiting_approval" });
        break;
      case "negotiating":
        this.emit({ phase: "negotiating" });
        break;
      case "live":
        this.emit({ phase: "live" });
        break;
      case "failed":
        this.fail(normalizeFailure(error));
        break;
      case "stopped":
        // A clean headset-side stop still ends this viewer's stream.
        this.fail("peer_disconnected");
        break;
      default:
        break; // unknown future status: ignore
    }
  }

  private handleSocketClose(code: number): void {
    if (this.closed) return;
    if (code === 4401) {
      this.options.callbacks.onUnauthorized();
      void this.cleanup({ deleteRemote: false });
      return;
    }
    if (this.state.phase !== "failed") this.fail("peer_disconnected");
    else void this.cleanup({ deleteRemote: true });
  }

  /**
   * Installs the agent's offer once. A duplicate offer is ignored, and every
   * awaited step re-checks `closed` so cleanup during negotiation can never
   * send a late answer.
   */
  private async installOffer(sdp: string): Promise<void> {
    if (this.closed || this.offerInstalled) return;
    this.offerInstalled = true;
    const peer = this.ensurePeer();
    try {
      await peer.acceptOffer(sdp);
    } catch {
      if (!this.closed) this.fail("peer_disconnected");
      return;
    }
    if (this.closed) return;
    this.remoteReady = true;
    void this.pumpIce();
    try {
      const answer = await peer.createAnswer();
      if (this.closed) return;
      this.sendSignal({ kind: "answer", sdp: answer });
    } catch {
      if (!this.closed) this.fail("peer_disconnected");
    }
  }

  /** Remote ICE is queued until the offer is installed, then applied in order. */
  private enqueueIce(candidate: Extract<RtcSignal, { kind: "ice" }>): void {
    if (this.closed) return;
    this.pendingIce.push(candidate);
    void this.pumpIce();
  }

  private async pumpIce(): Promise<void> {
    if (this.pumping || this.closed || !this.remoteReady) return;
    this.pumping = true;
    try {
      while (!this.closed && this.pendingIce.length > 0) {
        const candidate = this.pendingIce.shift()!;
        try {
          await this.peer?.addIce(candidate);
        } catch {
          /* malformed candidate from the wire: skip it */
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private ensurePeer(): BrowserRtcPeer {
    if (this.peer) return this.peer;
    this.peer = this.rtc.createPeer({
      onIceCandidate: (candidate) => this.sendSignal(candidate),
      onTrack: (track, stream) => this.handleTrack(track, stream),
      onConnectionState: (connectionState) => {
        if (this.closed) return;
        if (connectionState === "failed" || connectionState === "disconnected" || connectionState === "closed") {
          this.fail("peer_disconnected");
        }
      },
    });
    return this.peer;
  }

  private handleTrack(track: MediaStreamTrack, stream: MediaStream): void {
    if (this.closed) return;
    this.receivedTracks.add(track);
    if (!this.streamDelivered) {
      this.streamDelivered = true;
      this.options.callbacks.onStream(stream);
    }
  }

  private sendSignal(signal: RtcSignal): void {
    if (this.closed || !this.socket) return;
    try {
      this.socket.send(
        JSON.stringify({
          type: "cast_signal",
          protocolVersion: 1,
          sessionId: this.options.sessionId,
          signal,
        }),
      );
    } catch {
      /* the close handler runs cleanup */
    }
  }

  private fail(error: CastFailureCode | CastRequestError): void {
    if (this.closed) return;
    if (this.state.phase !== "failed") this.emit({ phase: "failed", error });
    void this.cleanup({ deleteRemote: true });
  }

  private emit(state: CastViewState): void {
    this.state = state;
    this.options.callbacks.onState(state);
  }

  /** One cleanup promise owns peer/socket/track/DELETE teardown, exactly once. */
  private cleanup(options: { deleteRemote: boolean }): Promise<void> {
    if (!this.cleanupPromise) {
      this.closed = true;
      this.cleanupPromise = (async () => {
        const peer = this.peer;
        this.peer = null;
        try {
          peer?.close();
        } catch {
          /* already closed */
        }
        for (const track of this.receivedTracks) {
          try {
            track.stop();
          } catch {
            /* already ended */
          }
        }
        this.receivedTracks.clear();
        const socket = this.socket;
        this.socket = null;
        try {
          socket?.close();
        } catch {
          /* already closed */
        }
        if (options.deleteRemote && this.stopSession) {
          try {
            await this.stopSession();
          } catch {
            /* the server frees the slot on socket close regardless */
          }
        }
      })();
    }
    return this.cleanupPromise;
  }
}
