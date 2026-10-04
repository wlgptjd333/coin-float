package com.coinfloat.app

import com.coinfloat.app.market.BinanceFuturesClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class JsonParserTest {

    @Test
    fun testParseValidAggTrade() {
        val client = BinanceFuturesClient(CoroutineScope(Dispatchers.Unconfined))
        val sampleJson = """
            {
              "e": "aggTrade",
              "E": 1672531199000,
              "s": "BTCUSDT",
              "a": 12345,
              "p": "118250.50",
              "q": "0.1",
              "f": 100,
              "l": 105,
              "T": 1672531198500,
              "m": true
            }
        """.trimIndent()

        val event = client.parseAggTrade(sampleJson)
        assertNotNull(event)
        assertEquals("aggTrade", event?.eventType)
        assertEquals("BTCUSDT", event?.symbol)
        assertEquals("118250.50", event?.price)
        assertEquals(1672531199000L, event?.eventTime)
        assertEquals(1672531198500L, event?.tradeTime)
    }

    @Test
    fun testParseCombinedStreamWrappedAggTrade() {
        val client = BinanceFuturesClient(CoroutineScope(Dispatchers.Unconfined))
        val streamJson = """
            {
              "stream": "btcusdt@aggTrade",
              "data": {
                "e": "aggTrade",
                "E": 1791118251728,
                "a": 3474570314,
                "s": "BTCUSDT",
                "p": "85136.70",
                "q": "0.002",
                "T": 1791118251578
              }
            }
        """.trimIndent()

        val event = client.parseAggTrade(streamJson)
        assertNotNull(event)
        assertEquals("aggTrade", event?.eventType)
        assertEquals("BTCUSDT", event?.symbol)
        assertEquals("85136.70", event?.price)
        assertEquals(1791118251728L, event?.eventTime)
        assertEquals(1791118251578L, event?.tradeTime)
    }

    @Test
    fun testParseNonAggTradeMessage() {
        val client = BinanceFuturesClient(CoroutineScope(Dispatchers.Unconfined))

        // Subscription response ack
        val ackJson = """{"result": null, "id": 1}"""
        assertNull(client.parseAggTrade(ackJson))

        // Malformed json
        assertNull(client.parseAggTrade("not a json"))
        assertNull(client.parseAggTrade(""))
    }

    @Test
    fun testParseExchangeInfo() {
        val client = BinanceFuturesClient(CoroutineScope(Dispatchers.Unconfined))
        val exchangeJson = """
            {
              "symbols": [
                {
                  "symbol": "BTCUSDT",
                  "pair": "BTCUSDT",
                  "contractType": "PERPETUAL",
                  "status": "TRADING",
                  "baseAsset": "BTC",
                  "quoteAsset": "USDT",
                  "pricePrecision": 2,
                  "filters": [
                    {
                      "filterType": "PRICE_FILTER",
                      "tickSize": "0.10"
                    }
                  ]
                },
                {
                  "symbol": "ETHUSD_230630",
                  "pair": "ETHUSD",
                  "contractType": "CURRENT_QUARTER",
                  "status": "TRADING",
                  "baseAsset": "ETH",
                  "quoteAsset": "USD",
                  "filters": []
                },
                {
                  "symbol": "DOGEUSDT",
                  "pair": "DOGEUSDT",
                  "contractType": "PERPETUAL",
                  "status": "BREAK",
                  "baseAsset": "DOGE",
                  "quoteAsset": "USDT",
                  "filters": []
                }
              ]
            }
        """.trimIndent()

        val parsed = client.parseExchangeInfo(exchangeJson)
        // Only BTCUSDT should match (PERPETUAL + USDT + TRADING)
        assertEquals(1, parsed.size)
        val btc = parsed[0]
        assertEquals("BTCUSDT", btc.symbol)
        assertEquals("BTC", btc.baseAsset)
        assertEquals("USDT", btc.quoteAsset)
        assertEquals("0.10", btc.tickSize)
    }

    @Test
    fun testParseKlines() {
        val client = BinanceFuturesClient(CoroutineScope(Dispatchers.Unconfined))
        val klinesJson = """
            [
              [1791126900000, "85319.90", "85440.40", "85239.80", "85276.50", "1401.950", 1791127799999],
              [1791127800000, "85276.50", "85276.60", "85240.60", "85240.60", "177.026", 1791128699999]
            ]
        """.trimIndent()

        val parsed = client.parseKlines(klinesJson)
        assertEquals(2, parsed.size)
        assertEquals(1791126900000L, parsed[0].openTime)
        assertEquals(85319.90f, parsed[0].open, 0.01f)
        assertEquals(85440.40f, parsed[0].high, 0.01f)
        assertEquals(85239.80f, parsed[0].low, 0.01f)
        assertEquals(85276.50f, parsed[0].close, 0.01f)
        assertEquals(1401.950f, parsed[0].volume, 0.01f)
    }
}
