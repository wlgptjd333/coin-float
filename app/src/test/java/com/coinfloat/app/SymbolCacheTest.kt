package com.coinfloat.app

import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.market.SymbolInfoCache
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SymbolCacheTest {

    @Test
    fun roundTripsTheFieldsTheAppUses() {
        val list = listOf(
            SymbolInfo("BTCUSDT", "BTCUSDT", "BTC", "USDT", "0.10", 2),
            SymbolInfo("1000PEPEUSDT", "1000PEPEUSDT", "1000PEPE", "USDT", "0.0000001", 7)
        )
        val snap = SymbolInfoCache.decode(SymbolInfoCache.encode(list, 1234L))!!
        assertEquals(1234L, snap.savedAt)
        assertEquals(list, snap.symbols)
    }

    @Test
    fun foreignOrDamagedTextIsRejected() {
        assertNull(SymbolInfoCache.decode(""))
        assertNull(SymbolInfoCache.decode("{\"symbols\":[]}"))
        assertNull(SymbolInfoCache.decode("coinfloat-symbols-v1\tnotanumber\nBTCUSDT\tBTCUSDT\tBTC\tUSDT\t0.1\t2\n"))
        assertNull(SymbolInfoCache.decode("coinfloat-symbols-v1\t5\n"))
    }
}
