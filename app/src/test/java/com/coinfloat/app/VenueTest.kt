package com.coinfloat.app

import com.coinfloat.app.market.ConnectionState
import com.coinfloat.app.market.Exchange
import com.coinfloat.app.market.HyperliquidClient
import com.coinfloat.app.market.MarketDataRepository
import com.coinfloat.app.market.SymbolInfo
import com.coinfloat.app.market.VariationalClient
import com.coinfloat.app.market.displaySymbol
import com.coinfloat.app.market.rankSymbols
import com.coinfloat.app.settings.OverlaySettings
import com.coinfloat.app.settings.SettingsSync
import com.coinfloat.app.ui.ChartInterval
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VenueTest {

    @Test
    fun keysNameTheVenue() {
        assertEquals(Exchange.BINANCE, Exchange.of("BTCUSDT"))
        assertEquals(Exchange.HYPERLIQUID, Exchange.of("HL-XYZ-TSLA"))
        assertEquals(Exchange.VARIATIONAL, Exchange.of("VAR-SOXL"))
        assertEquals("HL-BTC", Exchange.hyperliquidKey("BTC"))
        assertEquals("HL-KPEPE", Exchange.hyperliquidKey("kPEPE"))
        assertEquals("HL-XYZ-TSLA", Exchange.hyperliquidKey("xyz:TSLA"))
        assertEquals("VAR-SOXL", Exchange.variationalKey("SOXL"))
        assertEquals("BTC", Exchange.baseOf("BTCUSDT"))
        assertEquals("TSLA", Exchange.baseOf("HL-XYZ-TSLA"))
        assertEquals("SOXL", Exchange.baseOf("VAR-SOXL"))
        // every key survives the chart page's and the sync's cleaning
        listOf("BTCUSDT", "HL-XYZ-TSLA", "VAR-SOXL").forEach { assertEquals(it, ChartInterval.sanitizeSymbol(it)) }
    }

    @Test
    fun hyperliquidCoinsAndTicks() {
        assertEquals("xyz:TSLA", HyperliquidClient.guessCoin("HL-XYZ-TSLA"))
        assertEquals("BTC", HyperliquidClient.guessCoin("HL-BTC"))
        assertEquals("0.1", HyperliquidClient.tickSizeFor(5))       // BTC
        assertEquals("0.000001", HyperliquidClient.tickSizeFor(0))
        assertEquals("4h", HyperliquidClient.supportedInterval("6h"))
        assertEquals("15m", HyperliquidClient.supportedInterval("15m"))

        val meta = """{"universe":[{"name":"xyz:GOLD","szDecimals":4},{"name":"xyz:OLD","szDecimals":2,"isDelisted":true}]}"""
        val list = HyperliquidClient.parseMeta(meta, "XYZ")
        assertEquals(1, list.size)
        assertEquals("HL-XYZ-GOLD", list[0].symbol)
        assertEquals("xyz:GOLD", list[0].pair)
        assertEquals("GOLD", list[0].baseAsset)
        assertEquals("0.01", list[0].tickSize)
        assertEquals("Hyperliquid · XYZ", list[0].subtitle())
        assertEquals("xyz:GOLD (HL)", displaySymbol(list[0].symbol, list[0]))

        val candles = HyperliquidClient.parseCandles("""[{"t":2000,"T":2999,"s":"BTC","i":"1m","o":"2","c":"3","h":"4","l":"1","v":"10","n":5},{"t":1000,"T":1999,"s":"BTC","i":"1m","o":"1","c":"2","h":"2","l":"1","v":"5","n":2}]""")
        assertEquals(listOf(1000.0, 2000.0), candles.map { it[0] })
        assertEquals(3.0, candles[1][4], 0.0)
    }

    @Test
    fun variationalListings() {
        val json = """{"listings":[{"ticker":"MSTR","name":"Strategy Inc","mark_price":"131.4200678148923"},{"ticker":"PEPE","name":"Pepe","mark_price":"0.0000071"}]}"""
        val list = VariationalClient.parseStats(json).map { VariationalClient.toSymbolInfo(it) }
        assertEquals("VAR-MSTR", list[0].symbol)
        assertEquals("0.001", list[0].tickSize)
        assertEquals("Variational · Strategy Inc", list[0].subtitle())
        assertEquals("0.00000001", list[1].tickSize)
    }

    @Test
    fun searchRanksExactNamesFirstAndBinanceFirst() {
        val all = listOf(
            SymbolInfo("TSLAUSDT", "TSLAUSDT", "TSLA", "USDT", "0.01", group = "주식"),
            SymbolInfo("HL-XYZ-TSLA", "xyz:TSLA", "TSLA", "USD", "0.001", 3, Exchange.HYPERLIQUID, "XYZ"),
            SymbolInfo("VAR-TSLA", "TSLA", "TSLA", "USDC", "0.01", 2, Exchange.VARIATIONAL),
            SymbolInfo("TSLAXUSDT", "TSLAXUSDT", "TSLAX", "USDT", "0.01"),
            SymbolInfo("VAR-XAU", "XAU", "XAU", "USDC", "0.01", 2, Exchange.VARIATIONAL, name = "Gold")
        )
        assertEquals(listOf("TSLAUSDT", "HL-XYZ-TSLA", "VAR-TSLA", "TSLAXUSDT"), rankSymbols(all, "tsla").map { it.symbol })
        assertEquals(listOf("VAR-XAU"), rankSymbols(all, "gold").map { it.symbol })
        assertTrue(rankSymbols(all, "  ").isEmpty())
    }

    @Test
    fun liveOnlyWhenEveryFeedInUseIs() {
        val c = ConnectionState.CONNECTED
        assertEquals(ConnectionState.DISCONNECTED, MarketDataRepository.combinedState(emptyList()))
        assertEquals(c, MarketDataRepository.combinedState(listOf(c, c)))
        assertEquals(ConnectionState.RECONNECTING, MarketDataRepository.combinedState(listOf(c, ConnectionState.RECONNECTING)))
        assertEquals(ConnectionState.CONNECTING, MarketDataRepository.combinedState(listOf(ConnectionState.CONNECTING, c)))
    }

    @Test
    fun overlayShowsTheWatchlistWithoutHiddenOnes() {
        val s = OverlaySettings(selectedSymbols = listOf("BTCUSDT", "HL-XYZ-TSLA", "ETHUSDT"), hiddenOverlaySymbols = setOf("HL-XYZ-TSLA"))
        assertEquals(listOf("BTCUSDT", "ETHUSDT"), s.overlaySymbols)
        assertFalse(s.isOnOverlay("HL-XYZ-TSLA"))
        // never an empty window
        val all = s.copy(hiddenOverlaySymbols = s.selectedSymbols.toSet())
        assertEquals(listOf("BTCUSDT"), all.overlaySymbols)
    }

    @Test
    fun syncCarriesVenueKeysAndHiddenSymbols() {
        val s = OverlaySettings(selectedSymbols = listOf("BTCUSDT", "HL-XYZ-TSLA", "VAR-SOXL"), hiddenOverlaySymbols = setOf("VAR-SOXL"))
        val back = SettingsSync.merge(OverlaySettings(), SettingsSync.toJson(s))
        assertEquals(s.selectedSymbols, back.selectedSymbols)
        assertEquals(setOf("VAR-SOXL"), back.hiddenOverlaySymbols)
        // an older app version sends no "hidden": this device's choice stays
        val old = SettingsSync.toJson(s).apply { remove("hidden") }
        assertEquals(setOf("VAR-SOXL"), SettingsSync.merge(s, JSONObject(old.toString())).hiddenOverlaySymbols)
    }
}
