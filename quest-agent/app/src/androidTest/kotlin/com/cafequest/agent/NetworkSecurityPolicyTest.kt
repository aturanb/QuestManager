package com.cafequest.agent

import android.security.NetworkSecurityPolicy
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NetworkSecurityPolicyTest {
    @Test
    fun permitsCleartextTrafficToPrivateLanHosts() {
        val policy = NetworkSecurityPolicy.getInstance()

        assertTrue(
            "CafeQuest uses ws:// to connect to its local-network server",
            policy.isCleartextTrafficPermitted("192.168.1.150"),
        )
    }
}
