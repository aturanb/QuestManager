package com.cafequest.agent

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The installed manifest must declare exactly what the consent flow needs:
 * a data-sync + media-projection foreground service, no audio capture. Runs on
 * a device/emulator (UNVERIFIED_HARDWARE when no target is attached).
 */
@RunWith(AndroidJUnit4::class)
class MediaProjectionServiceTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun agentServiceIsADataSyncAndMediaProjectionForegroundService() {
        val info = context.packageManager.getServiceInfo(
            ComponentName(context, AgentService::class.java),
            PackageManager.GET_META_DATA,
        )
        val expected =
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        assertEquals(expected, info.foregroundServiceType)
    }

    @Test
    fun declaresProjectionPermissionAndNeverAudio() {
        val declared = context.packageManager
            .getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
            .requestedPermissions
            .orEmpty()
            .toSet()
        assertTrue(declared.contains("android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"))
        assertTrue(declared.contains("android.permission.FOREGROUND_SERVICE_DATA_SYNC"))
        assertFalse("the support view is video-only", declared.contains("android.permission.RECORD_AUDIO"))
    }
}
