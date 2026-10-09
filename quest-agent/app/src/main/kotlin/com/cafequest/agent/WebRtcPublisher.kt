package com.cafequest.agent

import android.content.Context
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpParameters
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack

/** The approved initial capture profile: 960×540 at 15 FPS, capped at 1.5 Mbps. */
data class CastVideoProfile(
    val width: Int = 960,
    val height: Int = 540,
    val fps: Int = 15,
    val maxBitrateBps: Int = 1_500_000,
) {
    companion object {
        val SUPPORT = CastVideoProfile()
    }
}

/** Peer connection lifecycle, mapped by the publisher onto publisher events. */
enum class RtcPeerState { CONNECTED, FAILED, CLOSED, PROJECTION_STOPPED }

/** Native WebRTC boundary; the publisher only orchestrates. */
interface RtcPeer {
    /** Adds the screen video track, creates the local offer, and returns its SDP. */
    suspend fun start(profile: CastVideoProfile): String
    suspend fun setRemoteAnswer(sdp: String)
    suspend fun addRemoteIce(candidate: RtcSignal.Ice)
    fun close()
}

fun interface RtcPeerFactory {
    /** Native peer (and its MediaProjection capture) for one approved grant. */
    fun create(
        grant: ProjectionGrant,
        profile: CastVideoProfile,
        onLocalSignal: (RtcSignal) -> Unit,
        onState: (RtcPeerState) -> Unit,
    ): RtcPeer
}

/**
 * Orchestrates one capture session: start the native peer, relay the offer and
 * trickled ICE, accept only answer/ICE, and report exactly one terminal event.
 * No exception text ever reaches the wire.
 */
class WebRtcPublisher(
    private val grant: ProjectionGrant,
    private val peerFactory: RtcPeerFactory,
    private val events: PublisherEvents,
    private val profile: CastVideoProfile = CastVideoProfile.SUPPORT,
) : CastPublisher {
    private val mutex = Mutex()
    private val pendingLocalSignals = mutableListOf<RtcSignal>()
    @Volatile private var offerSent = false
    @Volatile private var started = false
    @Volatile private var finished = false
    @Volatile private var peer: RtcPeer? = null

    override suspend fun start() {
        mutex.withLock {
            // One-use consent result: a repeated start never reuses the grant.
            if (started || finished) return
            started = true
            val created = try {
                peerFactory.create(grant, profile, ::onLocalSignal, ::onPeerState)
            } catch (_: Throwable) {
                finish(CastFailure.CAPTURE_FAILED)
                return
            }
            peer = created
            val offer = try {
                created.start(profile)
            } catch (_: Throwable) {
                finish(CastFailure.CAPTURE_FAILED)
                return
            }
            offerSent = true
            events.onLocalSignal(RtcSignal.Offer(offer))
            // ICE trickled while the offer was being created must follow it.
            val buffered = synchronized(pendingLocalSignals) {
                val copy = pendingLocalSignals.toList()
                pendingLocalSignals.clear()
                copy
            }
            buffered.forEach { events.onLocalSignal(it) }
        }
    }

    override suspend fun handle(signal: RtcSignal) {
        val current = peer ?: return
        when (signal) {
            is RtcSignal.Answer -> try {
                current.setRemoteAnswer(signal.sdp)
            } catch (_: Throwable) {
                finish(CastFailure.CAPTURE_FAILED)
            }
            is RtcSignal.Ice -> try {
                current.addRemoteIce(signal)
            } catch (_: Throwable) {
                // A malformed candidate is not fatal to the session.
            }
            is RtcSignal.Offer -> Unit // the agent is always the offerer
        }
    }

    override fun stop() {
        finish(null)
    }

    private fun onLocalSignal(signal: RtcSignal) {
        val buffered = synchronized(pendingLocalSignals) {
            if (!offerSent) {
                pendingLocalSignals += signal
                true
            } else {
                false
            }
        }
        if (!buffered) events.onLocalSignal(signal)
    }

    private fun onPeerState(state: RtcPeerState) {
        when (state) {
            RtcPeerState.CONNECTED -> if (!finished) events.onConnected()
            RtcPeerState.FAILED -> finish(CastFailure.PEER_DISCONNECTED)
            RtcPeerState.CLOSED -> finish(CastFailure.PEER_DISCONNECTED)
            RtcPeerState.PROJECTION_STOPPED -> finish(CastFailure.PROJECTION_STOPPED)
        }
    }

    /** Exactly one terminal event and one close, however many causes arrive. */
    private fun finish(error: String?) {
        synchronized(this) {
            if (finished) return
            finished = true
        }
        val current = peer
        peer = null
        try {
            current?.close()
        } catch (_: Throwable) {
            /* already released */
        }
        events.onStopped(error)
    }
}

/** CastPublisherFactory for the Quest agent. */
class WebRtcPublisherFactory(
    private val peerFactory: RtcPeerFactory,
    private val profile: CastVideoProfile = CastVideoProfile.SUPPORT,
) : CastPublisherFactory {
    override fun create(grant: ProjectionGrant, events: PublisherEvents): CastPublisher =
        WebRtcPublisher(grant, peerFactory, events, profile)
}

/** Builds the native peer for a Quest MediaProjection session. */
class AndroidRtcPeerFactory(private val context: Context) : RtcPeerFactory {
    override fun create(
        grant: ProjectionGrant,
        profile: CastVideoProfile,
        onLocalSignal: (RtcSignal) -> Unit,
        onState: (RtcPeerState) -> Unit,
    ): RtcPeer {
        val projection = grant as? AndroidProjectionGrant
            ?: throw IllegalArgumentException("casting requires a Quest MediaProjection grant")
        return AndroidRtcPeer(context, projection, onLocalSignal, onState)
    }
}

/**
 * The native peer: one EglBase, one PeerConnectionFactory with a
 * hardware-capable encoder (libWebRTC falls back to software), one peer
 * connection with no ICE servers, and the screen video track. It never
 * initializes audio.
 */
class AndroidRtcPeer(
    context: Context,
    grant: AndroidProjectionGrant,
    private val onLocalSignal: (RtcSignal) -> Unit,
    private val onState: (RtcPeerState) -> Unit,
) : RtcPeer {
    private val eglBase = EglBase.create()
    private val factory: PeerConnectionFactory = PeerConnectionFactory.builder()
        .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
        .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
        .createPeerConnectionFactory()
    private val capture = ProjectionCapture(
        context = context,
        grant = grant,
        eglContext = eglBase.eglBaseContext,
        videoSourceFactory = { isScreencast -> factory.createVideoSource(isScreencast) },
        onProjectionStopped = { onState(RtcPeerState.PROJECTION_STOPPED) },
    )
    private val observer = NativeObserver()
    @Volatile private var connection: PeerConnection? = null
    @Volatile private var videoTrack: VideoTrack? = null
    @Volatile private var closed = false

    override suspend fun start(profile: CastVideoProfile): String {
        if (closed) throw IllegalStateException("peer already closed")
        // Direct LAN WebRTC only: no STUN, TURN, or public relay.
        val peerConnection = factory.createPeerConnection(
            PeerConnection.RTCConfiguration(emptyList()),
            observer,
        ) ?: throw IllegalStateException("no peer connection available")
        connection = peerConnection

        val source = capture.start()
        source.adaptOutputFormat(profile.width, profile.height, profile.fps)
        val track = factory.createVideoTrack("cafequest-screen", source)
        videoTrack = track
        peerConnection.addTrack(track, listOf("cafequest"))
        capture.startCapture(profile)

        val offer = peerConnection.createOfferAwait()
        peerConnection.setLocalDescriptionAwait(offer)
        capBitrate(peerConnection, profile)
        return offer.description ?: ""
    }

    override suspend fun setRemoteAnswer(sdp: String) {
        val peerConnection = connection ?: return
        peerConnection.setRemoteDescriptionAwait(SessionDescription(SessionDescription.Type.ANSWER, sdp))
    }

    override suspend fun addRemoteIce(candidate: RtcSignal.Ice) {
        val peerConnection = connection ?: return
        val ice = IceCandidate(candidate.sdpMid ?: "0", candidate.sdpMLineIndex ?: 0, candidate.candidate)
        peerConnection.addIceCandidate(ice)
    }

    override fun close() {
        synchronized(this) {
            if (closed) return
            closed = true
        }
        try {
            capture.stop()
        } catch (_: Throwable) {
            /* already released */
        }
        try {
            videoTrack?.dispose()
        } catch (_: Throwable) {
            /* already disposed */
        }
        videoTrack = null
        try {
            connection?.close()
        } catch (_: Throwable) {
            /* already closed */
        }
        connection = null
        try {
            factory.dispose()
        } catch (_: Throwable) {
            /* already disposed */
        }
        try {
            eglBase.release()
        } catch (_: Throwable) {
            /* already released */
        }
    }

    private fun capBitrate(peerConnection: PeerConnection, profile: CastVideoProfile) {
        val sender = peerConnection.senders.firstOrNull() ?: return
        val parameters: RtpParameters = sender.parameters
        val encoding = parameters.encodings.firstOrNull() ?: return
        encoding.maxBitrateBps = profile.maxBitrateBps
        encoding.maxFramerate = profile.fps
        try {
            sender.setParameters(parameters)
        } catch (_: Throwable) {
            /* the encoder may already adapt itself */
        }
    }

    private inner class NativeObserver : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate?) {
            if (candidate == null) return
            onLocalSignal(
                RtcSignal.Ice(
                    candidate = candidate.sdp,
                    sdpMid = candidate.sdpMid,
                    sdpMLineIndex = candidate.sdpMLineIndex,
                )
            )
        }

        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
            when (newState) {
                PeerConnection.PeerConnectionState.CONNECTED -> onState(RtcPeerState.CONNECTED)
                PeerConnection.PeerConnectionState.FAILED -> onState(RtcPeerState.FAILED)
                PeerConnection.PeerConnectionState.CLOSED -> onState(RtcPeerState.CLOSED)
                else -> Unit
            }
        }

        override fun onSignalingChange(newState: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) = Unit
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
        override fun onAddStream(stream: MediaStream) = Unit
        override fun onRemoveStream(stream: MediaStream) = Unit
        override fun onDataChannel(dataChannel: org.webrtc.DataChannel) = Unit
        override fun onRenegotiationNeeded() = Unit
    }
}

private suspend fun PeerConnection.createOfferAwait(): SessionDescription = suspendCancellableCoroutine { continuation ->
    createOffer(
        object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription) {
                if (continuation.isActive) continuation.resume(description)
            }

            override fun onCreateFailure(error: String?) {
                if (continuation.isActive) continuation.resumeWithException(IllegalStateException("createOffer failed"))
            }

            override fun onSetSuccess() = Unit
            override fun onSetFailure(error: String?) = Unit
        },
        MediaConstraints(),
    )
}

private suspend fun PeerConnection.setLocalDescriptionAwait(description: SessionDescription): Unit =
    suspendCancellableCoroutine { continuation ->
        setLocalDescription(
            object : SdpObserver {
                override fun onSetSuccess() {
                    if (continuation.isActive) continuation.resume(Unit)
                }

                override fun onSetFailure(error: String?) {
                    if (continuation.isActive) {
                        continuation.resumeWithException(IllegalStateException("setLocalDescription failed"))
                    }
                }

                override fun onCreateSuccess(description: SessionDescription) = Unit
                override fun onCreateFailure(error: String?) = Unit
            },
            description,
        )
    }

private suspend fun PeerConnection.setRemoteDescriptionAwait(description: SessionDescription): Unit =
    suspendCancellableCoroutine { continuation ->
        setRemoteDescription(
            object : SdpObserver {
                override fun onSetSuccess() {
                    if (continuation.isActive) continuation.resume(Unit)
                }

                override fun onSetFailure(error: String?) {
                    if (continuation.isActive) {
                        continuation.resumeWithException(IllegalStateException("setRemoteDescription failed"))
                    }
                }

                override fun onCreateSuccess(description: SessionDescription) = Unit
                override fun onCreateFailure(error: String?) = Unit
            },
            description,
        )
    }
