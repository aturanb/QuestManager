package com.cafequest.agent

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises the real bundled libWebRTC startup path without beginning capture. */
@RunWith(AndroidJUnit4::class)
class WebRtcInitializationInstrumentedTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun nativePeerFactoryInitializesWebRtcBeforeCreatingPeer() {
        val peer = AndroidRtcPeerFactory(context).create(
            grant = AndroidProjectionGrant(Activity.RESULT_OK, Intent()),
            profile = CastVideoProfile.SUPPORT,
            onLocalSignal = {},
            onState = {},
        )

        peer.close()
    }
}
