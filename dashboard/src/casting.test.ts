import { describe, expect, it, vi } from "vitest";
import { CastClient, type CastSocket, type CastViewState } from "./casting";
import type { BrowserRtcAdapter, BrowserRtcCallbacks, BrowserRtcPeer } from "./browser-rtc";

const SESSION = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

class FakeSocket implements CastSocket {
  sent: string[] = [];
  closedCount = 0;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; wasClean?: boolean }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closedCount += 1;
  }
  emit(raw: string) {
    this.onmessage?.({ data: raw });
  }
  emitClose(code: number) {
    this.onclose?.({ code, wasClean: code === 1000 });
  }
  signals(): any[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

function makePeer() {
  const events: string[] = [];
  let release: (() => void) | null = null;
  let gate: Promise<void> | null = null;
  const peer: BrowserRtcPeer = {
    async acceptOffer(sdp) {
      events.push(`accept:${sdp}`);
      if (gate) await gate;
    },
    async createAnswer() {
      events.push("createAnswer");
      return "v=0-answer";
    },
    async addIce(candidate) {
      events.push(`ice:${candidate.candidate}`);
    },
    close() {
      events.push("close");
    },
  };
  return {
    peer,
    events,
    holdAccept() {
      gate = new Promise<void>((r) => {
        release = r;
      });
    },
    releaseAccept() {
      release?.();
    },
    ices: () => events.filter((e) => e.startsWith("ice:")),
  };
}

function makeRtc(peer: BrowserRtcPeer) {
  let callbacks: BrowserRtcCallbacks | null = null;
  const adapter: BrowserRtcAdapter = {
    createPeer(cb) {
      callbacks = cb;
      return peer;
    },
  };
  return { adapter, callbacks: () => callbacks! };
}

function setup() {
  const socket = new FakeSocket();
  const states: CastViewState[] = [];
  const streams: any[] = [];
  const unauthorized = vi.fn();
  const stopSession = vi.fn().mockResolvedValue(undefined);
  const peerCtl = makePeer();
  const rtc = makeRtc(peerCtl.peer);
  const client = new CastClient({
    sessionId: SESSION,
    socketUrl: "ws://example.test/cast-ws",
    callbacks: {
      onState: (s) => states.push(s),
      onStream: (s) => streams.push(s),
      onUnauthorized: unauthorized,
    },
    rtc: rtc.adapter,
    openSocket: () => socket,
    stopSession,
  });
  return { client, socket, states, streams, unauthorized, stopSession, peerCtl, rtc };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const status = (value: string, error?: string) =>
  JSON.stringify({ type: "cast_status", protocolVersion: 1, sessionId: SESSION, status: value, ...(error ? { error } : {}) });
const offer = (sdp = "v=0-offer") =>
  JSON.stringify({ type: "cast_signal", protocolVersion: 1, sessionId: SESSION, signal: { kind: "offer", sdp } });
const ice = (candidate: string) =>
  JSON.stringify({ type: "cast_signal", protocolVersion: 1, sessionId: SESSION, signal: { kind: "ice", candidate, sdpMid: "0", sdpMLineIndex: 0 } });

const makeTrack = () => ({ stop: vi.fn() }) as unknown as MediaStreamTrack;

describe("CastClient", () => {
  it("status frames drive the exact UI phases", () => {
    const { client, socket, states } = setup();
    client.start();
    expect(states.map((s) => s.phase)).toEqual(["connecting"]);
    socket.emit(status("awaiting_approval"));
    socket.emit(status("negotiating"));
    socket.emit(status("live"));
    expect(states.map((s) => s.phase)).toEqual(["connecting", "awaiting_approval", "negotiating", "live"]);
  });

  it("installs the offer, creates one answer, and sends it", async () => {
    const { client, socket, peerCtl, rtc } = setup();
    client.start();
    socket.emit(offer("v=0-offer"));
    await flush();
    expect(peerCtl.events).toEqual(["accept:v=0-offer", "createAnswer"]);
    expect(rtc.callbacks()).toBeTruthy();
    expect(socket.signals()).toEqual([
      { type: "cast_signal", protocolVersion: 1, sessionId: SESSION, signal: { kind: "answer", sdp: "v=0-answer" } },
    ]);
  });

  it("sends local ICE candidates through the cast socket", async () => {
    const { client, socket, rtc } = setup();
    client.start();
    socket.emit(offer());
    await flush();
    rtc.callbacks().onIceCandidate({ kind: "ice", candidate: "local-1", sdpMid: "0", sdpMLineIndex: 0 });
    expect(socket.signals().at(-1)).toEqual({
      type: "cast_signal",
      protocolVersion: 1,
      sessionId: SESSION,
      signal: { kind: "ice", candidate: "local-1", sdpMid: "0", sdpMLineIndex: 0 },
    });
  });

  it("queues remote ICE until the offer is installed and preserves order", async () => {
    const { client, socket, peerCtl } = setup();
    peerCtl.holdAccept();
    client.start();
    socket.emit(offer());
    socket.emit(ice("one"));
    socket.emit(ice("two"));
    await flush();
    expect(peerCtl.ices()).toEqual([]);
    peerCtl.releaseAccept();
    await flush();
    expect(peerCtl.ices()).toEqual(["ice:one", "ice:two"]);
    socket.emit(ice("three"));
    await flush();
    expect(peerCtl.ices()).toEqual(["ice:one", "ice:two", "ice:three"]);
  });

  it("calls onStream once for the first remote track and stops every track on cleanup", async () => {
    const { client, socket, streams, rtc } = setup();
    client.start();
    socket.emit(offer());
    await flush();
    const first = makeTrack();
    const second = makeTrack();
    rtc.callbacks().onTrack(first, {} as MediaStream);
    rtc.callbacks().onTrack(second, {} as MediaStream);
    expect(streams).toHaveLength(1);
    await client.close();
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.stop).toHaveBeenCalledTimes(1);
  });

  it("fails and cleans up when the peer connection fails or disconnects", async () => {
    for (const connectionState of ["failed", "disconnected"] as RTCPeerConnectionState[]) {
      const { client, socket, states, stopSession, peerCtl, rtc } = setup();
      client.start();
      socket.emit(offer());
      await flush();
      rtc.callbacks().onConnectionState(connectionState);
      expect(states.at(-1)).toEqual({ phase: "failed", error: "peer_disconnected" });
      await flush();
      expect(peerCtl.events.filter((e) => e === "close")).toHaveLength(1);
      expect(socket.closedCount).toBe(1);
      expect(stopSession).toHaveBeenCalledTimes(1);
    }
  });

  it("reports ICE/peer failure to the server before closing when possible", async () => {
    const { client, socket, stopSession, rtc } = setup();
    client.start();
    socket.emit(offer());
    await flush();
    rtc.callbacks().onConnectionState("failed");
    await flush();
    // The socket close handler on the server issues cast_stop; DELETE is the belt-and-braces cleanup.
    expect(socket.closedCount).toBe(1);
    expect(stopSession).toHaveBeenCalledTimes(1);
  });

  it("maps a server failed status to its bounded error code", () => {
    const { client, socket, states } = setup();
    client.start();
    socket.emit(status("failed", "consent_denied"));
    expect(states.at(-1)).toEqual({ phase: "failed", error: "consent_denied" });
  });

  it("treats a headset stop as the end of the stream", () => {
    const { client, socket, states } = setup();
    client.start();
    socket.emit(status("stopped"));
    expect(states.at(-1)).toEqual({ phase: "failed", error: "peer_disconnected" });
  });

  it("calls onUnauthorized on close code 4401 without deleting the session", async () => {
    const { client, socket, unauthorized, stopSession } = setup();
    client.start();
    socket.emitClose(4401);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    await flush();
    expect(stopSession).not.toHaveBeenCalled();
  });

  it("ignores malformed, wrong-session, duplicate-offer, and late messages", async () => {
    const { client, socket, states, peerCtl } = setup();
    client.start();
    socket.emit("definitely not json");
    socket.emit(JSON.stringify({ type: "cast_status", protocolVersion: 1, sessionId: "other", status: "live" }));
    socket.emit(JSON.stringify({ type: "cast_signal", protocolVersion: 1, sessionId: SESSION, signal: { kind: "answer", sdp: "v=0" } }));
    expect(states.map((s) => s.phase)).toEqual(["connecting"]);
    socket.emit(offer("first"));
    await flush();
    socket.emit(offer("second"));
    await flush();
    expect(peerCtl.events).toEqual(["accept:first", "createAnswer"]);
    expect(socket.signals().filter((s) => s.signal?.kind === "answer")).toHaveLength(1);

    await client.close();
    const sentAfterClose = socket.sent.length;
    socket.emit(offer("late"));
    socket.emit(status("live"));
    socket.emitClose(1000);
    await flush();
    expect(socket.sent.length).toBe(sentAfterClose);
    expect(states.map((s) => s.phase)).toEqual(["connecting"]);
  });

  it("close during negotiation is idempotent and never sends a late answer", async () => {
    const { client, socket, stopSession, peerCtl, rtc } = setup();
    peerCtl.holdAccept();
    client.start();
    socket.emit(offer("v=0-offer"));
    await flush();
    const track = makeTrack();
    rtc.callbacks().onTrack(track, {} as MediaStream);

    const firstClose = client.close();
    const secondClose = client.close();
    peerCtl.releaseAccept();
    await Promise.all([firstClose, secondClose]);
    await flush();

    expect(peerCtl.events.filter((e) => e === "createAnswer")).toHaveLength(0);
    expect(socket.signals().filter((s) => s.signal?.kind === "answer")).toHaveLength(0);
    expect(peerCtl.events.filter((e) => e === "close")).toHaveLength(1);
    expect(socket.closedCount).toBe(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(stopSession).toHaveBeenCalledTimes(1);

    await client.close();
    expect(socket.closedCount).toBe(1);
    expect(stopSession).toHaveBeenCalledTimes(1);
  });
});
