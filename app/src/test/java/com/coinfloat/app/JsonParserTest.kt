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
}
