# Alert backtest

Checks the alert rules of `app/src/main/java/com/coinfloat/app/alerts/AlertEngine.kt` against Binance USD-M futures 1m
candles. The rules are re-implemented in `Bt.java` with the same formulas; an entry is the close of the minute on which
the alert would have fired, and what happens next is read from the 1m path (forward returns, take-profit / stop races
with the stop checked first inside a minute, worst and best excursions). Fees: 0.1 % round trip.

Needs only a JDK 17 (single-file programs, no build):

```powershell
$java = "$env:LOCALAPPDATA\Programs\jdk-17.0.20.1+1\bin\java.exe"
& $java Fetch.java data 180 BTCUSDT ETHUSDT SOLUSDT XRPUSDT DOGEUSDT HYPEUSDT BNBUSDT   # public market data, ~15 MB a coin, cached
& $java -Xmx3g Bt.java data pick  BTCUSDT ETHUSDT SOLUSDT XRPUSDT DOGEUSDT HYPEUSDT BNBUSDT
```

Modes of `Bt.java`:

| mode | what it prints |
|---|---|
| `base` | every alert kind as a fade (counter-trend) entry: pooled, first two thirds, last third, per coin |
| `exh` | exhaustion grid: interval x volume multiple x candle height x wick (384 combinations, pooled rows only) |
| `exhx` | exhaustion with extra filters (RSI, size of the drop, longer look-back) and the failed-break variant |
| `pick` | the rules in the app's profiles and the candidates next to them, with in / out-of-sample and per-coin rows |
| `trend` | the trend-following rules of the other profiles, in their own direction |
| `deep` | one rule at a time: long vs short, how often the candle's extreme breaks, stop / target pairs, pullback entries |

Columns: mean return in the trade's direction after 5 m / 15 m / 1 h / 4 h with its t-statistic, then two races
(A: 0.5 % / 0.5 % within 1 h, B: 1 % / 1 % within 4 h) as win % / loss % and the mean result after fees.

## Pattern scan (`Analog.java`)

The "닮은 흐름" method, and the wider scan some sites offer (look-alikes from every interval of the coin, or from many
coins): at up to 500 points per coin and interval in the last 90 days, the last `L` closes are compared with every earlier
stretch (correlation of log prices), the `K` most alike whose next `H` bars had closed before that point are taken, and the
median of what followed them (scaled to today's bar-to-bar size) is compared with what really followed.

```powershell
& $java -Xmx3g "-Dpools=same,tf,all" "-Dclamp=0" Analog.java data BTCUSDT ETHUSDT SOLUSDT ...   # -DL=40 -DH=30 by default
```

Pools: `same` (this coin and interval), `tf` (this coin, 1m 5m 15m 1h 4h), `all` (every coin given, every interval).
`clamp=0` scales the look-alike's move by the plain ratio of bar-to-bar spreads (needed across intervals); without it the
ratio is clamped to 0.5–2. `results-2026-11-25-analog.txt` is the run behind 1.44.0.

`results-2026-11-10-*.txt` are the runs behind 1.39.0 (2026-05-14 to 2026-11-10). The `data/` folder is not committed.

Read the results as descriptions of that period, not as a forecast: one 180-day window, seven coins, many rules tried.
The last-third rows and the neighbouring settings are the guard against picking a lucky combination.
