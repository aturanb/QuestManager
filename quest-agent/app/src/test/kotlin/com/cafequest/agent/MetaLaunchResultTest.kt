package com.cafequest.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MetaLaunchResultTest {
    @Test fun `structured SDK success payload is accepted`() {
        val result = parseMetaLaunchResult(
            "{\"payload\":\"Successfully launched the target app 5740397619319389\"}"
        )

        assertEquals(LaunchOutcome.Success, result)
    }

    @Test fun `legacy success string is accepted`() {
        assertEquals(LaunchOutcome.Success, parseMetaLaunchResult("Success"))
    }

    @Test fun `SDK failure status remains a failure`() {
        val result = parseMetaLaunchResult("TargetAppBlocked")

        assertTrue(result is LaunchOutcome.Failed)
        assertEquals("TargetAppBlocked", (result as LaunchOutcome.Failed).error)
    }
}
