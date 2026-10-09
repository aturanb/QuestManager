package com.cafequest.agent

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import org.webrtc.EglBase
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource

/**
 * The one-use Quest consent result. It is handed straight to the capturer and is
 * never cached, logged, persisted, or reused for a later session.
 */
class AndroidProjectionGrant(val resultCode: Int, val resultData: Intent) : ProjectionGrant

/**
 * Wraps one `ScreenCapturerAndroid`, its `SurfaceTextureHelper`, and the WebRTC
 * video source it feeds. `start` may run once; `stop` releases capturer, helper,
 * and source in reverse order and is idempotent.
 */
class ProjectionCapture(
    private val context: Context,
    private val grant: AndroidProjectionGrant,
    private val eglContext: EglBase.Context,
    private val videoSourceFactory: (Boolean) -> VideoSource,
    private val onProjectionStopped: () -> Unit,
) {
    @Volatile private var capturer: ScreenCapturerAndroid? = null
    @Volatile private var helper: SurfaceTextureHelper? = null
    @Volatile private var source: VideoSource? = null

    /** One use only: a second call fails rather than reusing the consent token. */
    fun start(): VideoSource {
        check(capturer == null) { "the projection consent result was already used" }
        val newCapturer = ScreenCapturerAndroid(
            grant.resultData,
            object : MediaProjection.Callback() {
                override fun onStop() {
                    // The system revoked or replaced this projection.
                    onProjectionStopped()
                }
            },
        )
        val newHelper = SurfaceTextureHelper.create("CafeQuestCast", eglContext)
        val newSource = videoSourceFactory(newCapturer.isScreencast)
        newCapturer.initialize(newHelper, context, newSource.capturerObserver)
        capturer = newCapturer
        helper = newHelper
        source = newSource
        return newSource
    }

    fun startCapture(profile: CastVideoProfile) {
        capturer?.startCapture(profile.width, profile.height, profile.fps)
    }

    fun stop() {
        val currentCapturer = capturer
        val currentHelper = helper
        val currentSource = source
        capturer = null
        helper = null
        source = null
        try {
            currentCapturer?.stopCapture()
        } catch (_: Throwable) {
            /* already stopped */
        }
        try {
            currentCapturer?.dispose()
        } catch (_: Throwable) {
            /* already disposed */
        }
        try {
            currentHelper?.dispose()
        } catch (_: Throwable) {
            /* already disposed */
        }
        try {
            currentSource?.dispose()
        } catch (_: Throwable) {
            /* already disposed */
        }
    }
}
