package com.coinfloat.app

import com.coinfloat.app.market.Exchange
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
            SymbolInfo("1000PEPEUSDT", "1000PEPEUSDT", "1000PEPE", "USDT", "0.0000001", 7),
            SymbolInfo("SOXLUSDT", "SOXLUSDT", "SOXL", "USDT", "0.01", 2, group = "주식"),
            SymbolInfo("HL-XYZ-TSLA", "xyz:TSLA", "TSLA", "USD", "0.001", 3, Exchange.HYPERLIQUID, "XYZ"),
            SymbolInfo("VAR-MSTR", "MSTR", "MSTR", "USDC", "0.001", 3, Exchange.VARIATIONAL, name = "Strategy Inc")
        )
        val snap = SymbolInfoCache.decode(SymbolInfoCache.encode(list, 1234L))!!
        assertEquals(1234L, snap.savedAt)
        assertEquals(list, snap.symbols)
    }

    @Test
    fun foreignOrDamagedTextIsRejected() {
        assertNull(SymbolInfoCache.decode(""))
        assertNull(SymbolInfoCache.decode("{\"symbols\":[]}"))
        assertNull(SymbolInfoCache.decode("coinfloat-symbols-v2\tnotanumber\nBTCUSDT\tBTCUSDT\tBTC\tUSDT\t0.1\t2\tBINANCE\t\t\n"))
        assertNull(SymbolInfoCache.decode("coinfloat-symbols-v2\t5\n"))
        // the old format (no venue, and without Binance's stock contracts) is downloaded again
        assertNull(SymbolInfoCache.decode("coinfloat-symbols-v1\t5\nBTCUSDT\tBTCUSDT\tBTC\tUSDT\t0.1\t2\n"))
    }
}
