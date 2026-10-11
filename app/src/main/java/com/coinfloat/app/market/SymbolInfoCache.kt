package com.coinfloat.app.market

/**
 * Compact on-disk form of the USDⓈ-M symbol list. Binance's exchangeInfo is ~1.1 MB of JSON (900+ contracts with all
 * their filters); the app only needs a few fields of the ~500 USDT perpetuals, so they are kept as a small TSV and the
 * full document is downloaded at most once a day instead of on every app start.
 */
object SymbolInfoCache {
    private const val HEADER = "coinfloat-symbols-v1"
    const val MAX_AGE_MS = 24 * 60 * 60 * 1000L

    data class Snapshot(val savedAt: Long, val symbols: List<SymbolInfo>)

    fun encode(symbols: List<SymbolInfo>, savedAt: Long): String = buildString {
        append(HEADER).append('\t').append(savedAt).append('\n')
        for (s in symbols) {
            append(s.symbol).append('\t').append(s.pair).append('\t').append(s.baseAsset).append('\t')
                .append(s.quoteAsset).append('\t').append(s.tickSize).append('\t').append(s.pricePrecision).append('\n')
        }
    }

    /** null when the text is not a cache this version wrote (or is damaged): the caller just downloads again. */
    fun decode(text: String): Snapshot? {
        val lines = text.split('\n').filter { it.isNotEmpty() }
        val head = lines.firstOrNull()?.split('\t') ?: return null
        if (head.size != 2 || head[0] != HEADER) return null
        val savedAt = head[1].toLongOrNull() ?: return null
        val symbols = lines.drop(1).mapNotNull { line ->
            val f = line.split('\t')
            if (f.size != 6) null else SymbolInfo(f[0], f[1], f[2], f[3], f[4], f[5].toIntOrNull() ?: 2)
        }
        return if (symbols.isEmpty()) null else Snapshot(savedAt, symbols)
    }
}
