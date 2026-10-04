package com.coinfloat.app

import com.coinfloat.app.market.BinanceFuturesClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Test

class ReconnectBackoffTest {

    @Test
    fun testExponentialBackoffProgression() {
        val client = BinanceFuturesClient(CoroutineScope(Dispatchers.Unconfined))

        // Check progression: 1s, 2s, 4s, 8s, 16s, 30s, 30s...
        assertEquals(1000L, client.calculateBackoff(0))
        assertEquals(2000L, client.calculateBackoff(1))
        assertEquals(4000L, client.calculateBackoff(2))
        assertEquals(8000L, client.calculateBackoff(3))
        assertEquals(16000L, client.calculateBackoff(4))
        assertEquals(30000L, client.calculateBackoff(5))
        assertEquals(30000L, client.calculateBackoff(6))
        assertEquals(30000L, client.calculateBackoff(10))
    }
}
