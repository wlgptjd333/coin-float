package com.coinfloat.app

import com.coinfloat.app.market.BinanceFuturesClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class KlineStreamTest {

    private val client = BinanceFuturesClient(CoroutineScope(Dispatchers.Unconfined))

    @Test
    fun parsesLiveCandleWithVolume() {
        val msg = """{"stream":"btcusdt@kline_15m","data":{"e":"kline","E":1,"s":"BTCUSDT","k":{"t":1760100000000,"T":1760100899999,"s":"BTCUSDT","i":"15m","o":"83000.0","c":"83021.1","h":"83050.5","l":"82990.0","v":"123.456","x":false}}}"""
        val event = client.parseKline(msg)!!
        assertEquals("BTCUSDT", event.symbol)
        assertEquals("15m", event.interval)
        assertEquals(1760100000000L, event.item.openTime)
        assertEquals(83050.5f, event.item.high, 0.01f)
        assertEquals(82990.0f, event.item.low, 0.01f)
        assertEquals(123.456f, event.item.volume, 0.001f)
        assertEquals("83021.1", event.closeText)       // exact price text, used as the price feed
    }

    @Test
    fun otherMessagesAreNotCandles() {
        assertNull(client.parseKline("""{"e":"aggTrade","s":"BTCUSDT","p":"1"}"""))
        assertNull(client.parseKline("""{"result":null,"id":3}"""))
        assertNull(client.parseKline("not json"))
    }
}
