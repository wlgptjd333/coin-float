package com.coinfloat.app

import com.coinfloat.app.market.BinanceFuturesClient
import com.coinfloat.app.market.MarketPrice
import com.coinfloat.app.market.dayChangePercent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.math.BigDecimal

class DayChangeTest {

    @Test
    fun parsesMiniTickerFromCombinedStream() {
        val client = BinanceFuturesClient(CoroutineScope(Dispatchers.Unconfined))
        val msg = """{"stream":"btcusdt@miniTicker","data":{"e":"24hrMiniTicker","E":1,"s":"BTCUSDT","c":"83021.10","o":"82208.00","h":"83500","l":"81000","v":"1","q":"1"}}"""
        val event = client.parseDayTicker(msg)!!
        assertEquals("BTCUSDT", event.symbol)
        assertEquals("82208.00", event.open)
        assertNull(client.parseDayTicker("""{"e":"aggTrade","s":"BTCUSDT","p":"1"}"""))
        assertNull(client.parseAggTrade(msg))
    }

    @Test
    fun changeIsRelativeToThe24hOpen() {
        val p = MarketPrice("BTCUSDT", BigDecimal("101"), dayOpen = BigDecimal("100"))
        assertEquals(1.0f, p.dayChangePercent()!!, 0.0001f)
        assertNull(MarketPrice("BTCUSDT", BigDecimal("101")).dayChangePercent())
        assertNull(MarketPrice("BTCUSDT", BigDecimal("101"), dayOpen = BigDecimal.ZERO).dayChangePercent())
    }
}
