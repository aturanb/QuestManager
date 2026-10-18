import type { RtcSignal } from "./casting";

/**
 * The slice of RTCPeerConnection the cast client needs. Keeping it behind an
 * interface lets tests run without a browser WebRTC implementation.
 */
export type BrowserRtcPeer = {
  /** Installs the agent's offer as the remote description. */
  acceptOffer(sdp: string): Promise<void>;
  /** Creates and installs the local answer, returning its SDP. */
  createAnswer(): Promise<string>;
  /** Adds one trickled remote ICE candidate. */
  addIce(candidate: Extract<RtcSignal, { kind: "ice" }>): Promise<void>;
  close(): void;
};

export type BrowserRtcCallbacks = {
  onIceCandidate(candidate: Extract<RtcSignal, { kind: "ice" }>): void;
  onTrack(track: MediaStreamTrack, stream: MediaStream): void;
  onConnectionState(state: RTCPeerConnectionState): void;
};

export type BrowserRtcAdapter = {
  createPeer(callbacks: BrowserRtcCallbacks): BrowserRtcPeer;
};

/** Direct LAN WebRTC: no STUN, TURN, or public relay in v1. */
export const EMPTY_ICE_SERVERS: RTCIceServer[] = [];

export function createNativeRtcAdapter(): BrowserRtcAdapter {
  return {
    createPeer(callbacks) {
      const peer = new RTCPeerConnection({ iceServers: EMPTY_ICE_SERVERS });
      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        callbacks.onIceCandidate({
          kind: "ice",
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        });
      };
      peer.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        callbacks.onTrack(event.track, stream);
      };
      peer.onconnectionstatechange = () => callbacks.onConnectionState(peer.connectionState);
      return {
        async acceptOffer(sdp) {
          await peer.setRemoteDescription({ type: "offer", sdp });
        },
        async createAnswer() {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          return answer.sdp ?? "";
        },
        async addIce(candidate) {
          await peer.addIceCandidate({
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          });
        },
        close() {
          peer.onicecandidate = null;
          peer.ontrack = null;
          peer.onconnectionstatechange = null;
          peer.close();
        },
      };
    },
  };
}
