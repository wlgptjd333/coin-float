package com.coinfloat.app

import com.coinfloat.app.market.BinanceFuturesClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class SubscriptionBuilderTest {

    @Test
    fun testBuildSubscriptionPayload() {
        val client = BinanceFuturesClient(CoroutineScope(Dispatchers.Unconfined))
        val payload = client.buildSubscriptionPayload(
            method = "SUBSCRIBE",
            symbols = listOf("BTCUSDT", "ETHUSDT", "SOLUSDT"),
            id = 42
        )

        val json = JSONObject(payload)
        assertEquals("SUBSCRIBE", json.getString("method"))
        assertEquals(42, json.getInt("id"))

        val params = json.getJSONArray("params")
        assertEquals(3, params.length())
        assertEquals("btcusdt@aggTrade", params.getString(0))
        assertEquals("ethusdt@aggTrade", params.getString(1))
        assertEquals("solusdt@aggTrade", params.getString(2))
    }

    @Test
    fun testBuildUnsubscribePayload() {
        val client = BinanceFuturesClient(CoroutineScope(Dispatchers.Unconfined))
        val payload = client.buildSubscriptionPayload(
            method = "UNSUBSCRIBE",
            symbols = listOf("ETHUSDT"),
            id = 99
        )

        val json = JSONObject(payload)
        assertEquals("UNSUBSCRIBE", json.getString("method"))
        assertEquals(99, json.getInt("id"))

        val params = json.getJSONArray("params")
        assertEquals(1, params.length())
        assertEquals("ethusdt@aggTrade", params.getString(0))
    }
}
