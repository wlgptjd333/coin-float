package com.coinfloat.app

import com.coinfloat.app.ui.components.CoinIcons
import org.junit.Assert.assertEquals
import org.junit.Test

class CoinIconNameTest {
    @Test
    fun futuresMultiplesUseThePlainCoinLogo() {
        assertEquals("PEPE", CoinIcons.logoName("1000PEPE"))
        assertEquals("BONK", CoinIcons.logoName("1000bonk"))
        assertEquals("BABYDOGE", CoinIcons.logoName("1MBABYDOGE"))
        assertEquals("MOG", CoinIcons.logoName("1000000MOG"))
    }

    @Test
    fun plainNamesStay() {
        assertEquals("BTC", CoinIcons.logoName("btc"))
        assertEquals("1INCH", CoinIcons.logoName("1INCH"))       // not a multiple: no letter-led remainder after "1"
        assertEquals("ME", CoinIcons.logoName("ME"))
    }
}
