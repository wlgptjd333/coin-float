// Built-in Pine Script® indicators for the in-app chart, written from the standard published formulas and run by
// PineTS (pine.js). Users can add them in one tap, change their inputs and style, or paste their own scripts.
// Pine Script® is a trademark of TradingView, Inc.; these scripts are not TradingView's code.
window.PINE_LIB = [
{ id: 'ichimoku', cat: '추세', name: '일목균형표', desc: '전환선 · 기준선 · 구름 · 후행스팬', src: `//@version=5
indicator("일목균형표", shorttitle="Ichimoku", overlay=true)
convLen = input.int(9, "전환선 기간", minval=1)
baseLen = input.int(26, "기준선 기간", minval=1)
spanBLen = input.int(52, "선행스팬 B 기간", minval=1)
disp = input.int(26, "선행 · 후행 이동", minval=1)
donchian(len) => math.avg(ta.lowest(len), ta.highest(len))
conv = donchian(convLen)
base = donchian(baseLen)
spanA = math.avg(conv, base)
spanB = donchian(spanBLen)
plot(conv, "전환선", color=#2962FF)
plot(base, "기준선", color=#B71C1C)
plot(close, "후행스팬", offset=-disp + 1, color=#43A047)
p1 = plot(spanA, "선행스팬 A", offset=disp - 1, color=#A5D6A7)
p2 = plot(spanB, "선행스팬 B", offset=disp - 1, color=#EF9A9A)
fill(p1, p2, color = spanA > spanB ? color.rgb(67, 160, 71, 85) : color.rgb(244, 67, 54, 85), title="구름")
` },
{ id: 'pivots_std', cat: '추세', name: '피벗 포인트', desc: '일 · 주 · 월 기준 P, R1~R3, S1~S3 (표준 · 피보나치 · 카마릴라)', src: `//@version=5
indicator("피벗 포인트", shorttitle="Pivots", overlay=true)
tf = input.string("D", "기간", options=["D", "W", "M"])
kind = input.string("표준", "종류", options=["표준", "피보나치", "카마릴라"])
ph = request.security(syminfo.tickerid, tf, high[1], lookahead=barmerge.lookahead_on)
pl = request.security(syminfo.tickerid, tf, low[1], lookahead=barmerge.lookahead_on)
pc = request.security(syminfo.tickerid, tf, close[1], lookahead=barmerge.lookahead_on)
rng = ph - pl
p = (ph + pl + pc) / 3
r1 = kind == "피보나치" ? p + 0.382 * rng : kind == "카마릴라" ? pc + rng * 1.1 / 12 : 2 * p - pl
s1 = kind == "피보나치" ? p - 0.382 * rng : kind == "카마릴라" ? pc - rng * 1.1 / 12 : 2 * p - ph
r2 = kind == "피보나치" ? p + 0.618 * rng : kind == "카마릴라" ? pc + rng * 1.1 / 6 : p + rng
s2 = kind == "피보나치" ? p - 0.618 * rng : kind == "카마릴라" ? pc - rng * 1.1 / 6 : p - rng
r3 = kind == "피보나치" ? p + rng : kind == "카마릴라" ? pc + rng * 1.1 / 4 : ph + 2 * (p - pl)
s3 = kind == "피보나치" ? p - rng : kind == "카마릴라" ? pc - rng * 1.1 / 4 : pl - 2 * (ph - p)
fresh = ph != ph[1] or pl != pl[1]
plot(fresh ? na : p, "P", color=#F0B90B, linewidth=2, style=plot.style_linebr)
plot(fresh ? na : r1, "R1", color=#F6465D, style=plot.style_linebr)
plot(fresh ? na : r2, "R2", color=#F6465D, style=plot.style_linebr)
plot(fresh ? na : r3, "R3", color=#F6465D, style=plot.style_linebr)
plot(fresh ? na : s1, "S1", color=#0ECB81, style=plot.style_linebr)
plot(fresh ? na : s2, "S2", color=#0ECB81, style=plot.style_linebr)
plot(fresh ? na : s3, "S3", color=#0ECB81, style=plot.style_linebr)
` },
{ id: 'emacross', cat: '추세', name: 'EMA 크로스 신호', desc: '빠른 · 느린 EMA와 골든 · 데드 크로스 표시', src: `//@version=5
indicator("EMA 크로스 신호", shorttitle="EMA Cross", overlay=true)
fastLen = input.int(9, "빠른 EMA", minval=1)
slowLen = input.int(21, "느린 EMA", minval=1)
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
plot(fast, "빠른 EMA", color=#00BCD4, linewidth=2)
plot(slow, "느린 EMA", color=#FF9800, linewidth=2)
plotshape(ta.crossover(fast, slow), "골든 크로스", shape.triangleup, location.belowbar, color.new(#0ECB81, 0), size=size.small)
plotshape(ta.crossunder(fast, slow), "데드 크로스", shape.triangledown, location.abovebar, color.new(#F6465D, 0), size=size.small)
` },
{ id: 'psar', cat: '추세', name: '파라볼릭 SAR', desc: '추세 따라 붙는 점, 뒤집히면 전환', src: `//@version=5
indicator("파라볼릭 SAR", shorttitle="SAR", overlay=true)
start = input.float(0.02, "시작", step=0.001)
inc = input.float(0.02, "증가", step=0.001)
maxv = input.float(0.2, "최대", step=0.01)
s = ta.sar(start, inc, maxv)
plot(s, "SAR", style=plot.style_circles, linewidth=2, color = s < close ? #0ECB81 : #F6465D)
` },
{ id: 'hma', cat: '추세', name: '헐 이동평균 (HMA)', desc: '지연이 적은 이동평균, 기울기에 따라 색', src: `//@version=5
indicator("헐 이동평균", shorttitle="HMA", overlay=true)
len = input.int(55, "기간", minval=2)
src = input.source(close, "소스")
h = ta.hma(src, len)
plot(h, "HMA", color = h >= h[1] ? #0ECB81 : #F6465D, linewidth=2)
` },
{ id: 'vwma', cat: '추세', name: '거래량 가중 이동평균 (VWMA)', desc: '거래량이 큰 봉에 더 무게를 둔 평균', src: `//@version=5
indicator("거래량 가중 이동평균", shorttitle="VWMA", overlay=true)
len = input.int(20, "기간", minval=1)
plot(ta.vwma(close, len), "VWMA", color=#E040FB, linewidth=2)
` },
{ id: 'keltner', cat: '변동성', name: '켈트너 채널', desc: 'EMA ± ATR 배수 채널', src: `//@version=5
indicator("켈트너 채널", shorttitle="KC", overlay=true)
len = input.int(20, "기간", minval=1)
mult = input.float(2.0, "ATR 배수", step=0.1)
atrLen = input.int(10, "ATR 기간", minval=1)
basis = ta.ema(close, len)
rng = ta.atr(atrLen)
u = plot(basis + rng * mult, "상단", color=#2962FF)
plot(basis, "중심", color=#FF9800)
l = plot(basis - rng * mult, "하단", color=#2962FF)
fill(u, l, color=color.rgb(41, 98, 255, 92), title="배경")
` },
{ id: 'donchian', cat: '변동성', name: '돈치안 채널', desc: 'N봉 최고가 · 최저가 채널 (돌파 매매)', src: `//@version=5
indicator("돈치안 채널", shorttitle="DC", overlay=true)
len = input.int(20, "기간", minval=1)
hi = ta.highest(len)
lo = ta.lowest(len)
u = plot(hi, "상단", color=#2962FF)
plot(math.avg(hi, lo), "중심", color=#FF6D00)
l = plot(lo, "하단", color=#2962FF)
fill(u, l, color=color.rgb(33, 150, 243, 92), title="배경")
` },
{ id: 'pivots', cat: '추세', name: '피벗 고점 · 저점', desc: '좌우 N봉 기준 스윙 고점 · 저점 표시', src: `//@version=5
indicator("피벗 고점 · 저점", shorttitle="Pivots", overlay=true)
left = input.int(10, "왼쪽 봉 수", minval=1)
right = input.int(10, "오른쪽 봉 수", minval=1)
ph = ta.pivothigh(left, right)
pl = ta.pivotlow(left, right)
plotshape(not na(ph), "고점", shape.triangledown, location.abovebar, #F6465D, offset=-right, size=size.tiny)
plotshape(not na(pl), "저점", shape.triangleup, location.belowbar, #0ECB81, offset=-right, size=size.tiny)
` },
{ id: 'stochrsi', cat: '모멘텀', name: '스토캐스틱 RSI', desc: 'RSI의 스토캐스틱, K · D 교차', src: `//@version=5
indicator("스토캐스틱 RSI", shorttitle="Stoch RSI", overlay=false)
smoothK = input.int(3, "K", minval=1)
smoothD = input.int(3, "D", minval=1)
lengthRSI = input.int(14, "RSI 기간", minval=1)
lengthStoch = input.int(14, "스토캐스틱 기간", minval=1)
src = input.source(close, "소스")
rsi1 = ta.rsi(src, lengthRSI)
k = ta.sma(ta.stoch(rsi1, rsi1, rsi1, lengthStoch), smoothK)
d = ta.sma(k, smoothD)
plot(k, "K", color=#2962FF)
plot(d, "D", color=#FF6D00)
h0 = hline(80, "과매수", color=#787B86)
h1 = hline(20, "과매도", color=#787B86)
fill(h0, h1, color=color.rgb(33, 150, 243, 90), title="배경")
` },
{ id: 'stoch', cat: '모멘텀', name: '스토캐스틱', desc: '%K · %D, 과매수 80 · 과매도 20', src: `//@version=5
indicator("스토캐스틱", shorttitle="Stoch", overlay=false)
periodK = input.int(14, "%K 기간", minval=1)
smoothK = input.int(1, "%K 평활", minval=1)
periodD = input.int(3, "%D 기간", minval=1)
k = ta.sma(ta.stoch(close, high, low, periodK), smoothK)
d = ta.sma(k, periodD)
plot(k, "%K", color=#2962FF)
plot(d, "%D", color=#FF6D00)
h0 = hline(80, "과매수", color=#787B86)
h1 = hline(20, "과매도", color=#787B86)
fill(h0, h1, color=color.rgb(33, 150, 243, 90), title="배경")
` },
{ id: 'cci', cat: '모멘텀', name: 'CCI', desc: '평균에서 벗어난 정도, ±100 바깥이 과열', src: `//@version=5
indicator("CCI", overlay=false)
len = input.int(20, "기간", minval=1)
src = input.source(hlc3, "소스")
plot(ta.cci(src, len), "CCI", color=#2962FF)
h0 = hline(100, "+100", color=#787B86)
hline(0, "0", color=color.new(#787B86, 50))
h1 = hline(-100, "-100", color=#787B86)
fill(h0, h1, color=color.rgb(33, 150, 243, 90), title="배경")
` },
{ id: 'wpr', cat: '모멘텀', name: '윌리엄스 %R', desc: '-20 위 과매수, -80 아래 과매도', src: `//@version=5
indicator("윌리엄스 %R", shorttitle="%R", overlay=false)
len = input.int(14, "기간", minval=1)
plot(ta.wpr(len), "%R", color=#7E57C2)
h0 = hline(-20, "과매수", color=#787B86)
h1 = hline(-80, "과매도", color=#787B86)
fill(h0, h1, color=color.rgb(126, 87, 194, 90), title="배경")
` },
{ id: 'ao', cat: '모멘텀', name: '어썸 오실레이터', desc: '5 · 34 중간값 이평 차이 히스토그램', src: `//@version=5
indicator("어썸 오실레이터", shorttitle="AO", overlay=false)
ao = ta.sma(hl2, 5) - ta.sma(hl2, 34)
plot(ao, "AO", style=plot.style_columns, color = ao >= ao[1] ? #0ECB81 : #F6465D)
` },
{ id: 'roc', cat: '모멘텀', name: '변화율 (ROC)', desc: 'N봉 전 대비 가격 변화율(%)', src: `//@version=5
indicator("변화율", shorttitle="ROC", overlay=false)
len = input.int(9, "기간", minval=1)
plot(ta.roc(close, len), "ROC", color=#2962FF)
hline(0, "0", color=#787B86)
` },
{ id: 'squeeze', cat: '모멘텀', name: '스퀴즈 모멘텀', desc: '볼린저가 켈트너 안으로 좁아지면 압축(점), 히스토그램은 방향', src: `//@version=5
indicator("스퀴즈 모멘텀", shorttitle="Squeeze", overlay=false)
len = input.int(20, "기간", minval=1)
bbMult = input.float(2.0, "볼린저 배수", step=0.1)
kcMult = input.float(1.5, "켈트너 배수", step=0.1)
basis = ta.sma(close, len)
dev = bbMult * ta.stdev(close, len)
rng = ta.sma(ta.tr, len)
sqzOn = (basis - dev) > (basis - rng * kcMult) and (basis + dev) < (basis + rng * kcMult)
mid = math.avg(math.avg(ta.highest(high, len), ta.lowest(low, len)), basis)
val = ta.linreg(close - mid, len, 0)
plot(val, "모멘텀", style=plot.style_columns, color = val > 0 ? (val > nz(val[1]) ? #0ECB81 : #0B7A55) : (val < nz(val[1]) ? #F6465D : #8E2A36))
plot(0, "압축", style=plot.style_circles, linewidth=2, color = sqzOn ? #F0B90B : #3A3F4B)
` },
{ id: 'adx', cat: '추세 강도', name: 'DMI / ADX', desc: '+DI · -DI 방향, ADX 25 위면 추세 강함', src: `//@version=5
indicator("DMI / ADX", shorttitle="DMI", overlay=false)
len = input.int(14, "DI 기간", minval=1)
lensig = input.int(14, "ADX 평활", minval=1)
[diplus, diminus, adx] = ta.dmi(len, lensig)
plot(adx, "ADX", color=#F50057, linewidth=2)
plot(diplus, "+DI", color=#0ECB81)
plot(diminus, "-DI", color=#F6465D)
hline(25, "추세 기준", color=#787B86)
` },
{ id: 'aroon', cat: '추세 강도', name: '아룬', desc: '최근 고점 · 저점이 얼마나 최근인지 (0~100)', src: `//@version=5
indicator("아룬", shorttitle="Aroon", overlay=false)
len = input.int(14, "기간", minval=1)
up = 100 * (ta.highestbars(high, len + 1) + len) / len
dn = 100 * (ta.lowestbars(low, len + 1) + len) / len
plot(up, "아룬 업", color=#0ECB81)
plot(dn, "아룬 다운", color=#F6465D)
` },
{ id: 'atr', cat: '변동성', name: 'ATR', desc: '평균 진폭 (손절 폭 · 변동성 판단)', src: `//@version=5
indicator("ATR", overlay=false)
len = input.int(14, "기간", minval=1)
plot(ta.atr(len), "ATR", color=#B71C1C)
` },
{ id: 'zscore', cat: '변동성', name: 'Z-스코어', desc: '평균에서 표준편차 몇 배 떨어졌는지', src: `//@version=5
indicator("Z-스코어", shorttitle="Z", overlay=false)
len = input.int(20, "기간", minval=2)
z = (close - ta.sma(close, len)) / ta.stdev(close, len)
plot(z, "Z", style=plot.style_columns, color = z >= 0 ? color.new(#0ECB81, 30) : color.new(#F6465D, 30))
hline(2, "+2", color=#787B86)
hline(0, "0", color=color.new(#787B86, 50))
hline(-2, "-2", color=#787B86)
` },
{ id: 'obv', cat: '거래량', name: 'OBV', desc: '상승 봉 거래량은 더하고 하락 봉은 빼서 누적', src: `//@version=5
indicator("OBV", overlay=false)
sigLen = input.int(20, "시그널 기간", minval=1)
obv = ta.cum(math.sign(ta.change(close)) * volume)
plot(obv, "OBV", color=#2962FF)
plot(ta.ema(obv, sigLen), "시그널", color=#FF9800)
` },
{ id: 'mfi', cat: '거래량', name: 'MFI', desc: '거래량을 넣은 RSI, 80 · 20 기준', src: `//@version=5
indicator("MFI", overlay=false)
len = input.int(14, "기간", minval=1)
plot(ta.mfi(hlc3, len), "MFI", color=#7E57C2)
h0 = hline(80, "과매수", color=#787B86)
h1 = hline(20, "과매도", color=#787B86)
fill(h0, h1, color=color.rgb(126, 87, 194, 90), title="배경")
` },
{ id: 'cmf', cat: '거래량', name: '차이킨 머니 플로우', desc: '매집(+) · 분산(-) 압력', src: `//@version=5
indicator("차이킨 머니 플로우", shorttitle="CMF", overlay=false)
len = input.int(20, "기간", minval=1)
ad = high == low ? 0 : ((2 * close - low - high) / (high - low)) * volume
cmf = math.sum(ad, len) / math.sum(volume, len)
plot(cmf, "CMF", style=plot.style_columns, color = cmf >= 0 ? color.new(#0ECB81, 30) : color.new(#F6465D, 30))
hline(0, "0", color=#787B86)
` },
{ id: 'rvol', cat: '거래량', name: '상대 거래량 (RVOL)', desc: '직전 N봉 평균 대비 거래량 배수 (알람의 "거래량 급증"과 같은 기준)', src: `//@version=5
indicator("상대 거래량", shorttitle="RVOL", overlay=false)
len = input.int(20, "평균 기간 (직전 N봉)", minval=2)
thr = input.float(3.0, "강조 기준 (배)", step=0.5)
avg = ta.sma(volume[1], len)
rv = avg > 0 ? volume / avg : 0
plot(rv, "RVOL", style=plot.style_columns, color = rv >= thr ? (close >= open ? #0ECB81 : #F6465D) : color.new(#787B86, 55))
hline(thr, "기준", color=#F0B90B)
hline(1, "평균", color=color.new(#787B86, 50))
` },
{ id: 'wavetrend', cat: '모멘텀', name: '웨이브트렌드 오실레이터', desc: '크립토에서 인기 있는 과매수 · 과매도 + 교차 신호 (LazyBear)', src: `//@version=5
indicator("웨이브트렌드", shorttitle="WT", overlay=false)
n1 = input.int(10, "채널 길이", minval=1)
n2 = input.int(21, "평균 길이", minval=1)
obLvl = input.int(60, "과매수", minval=1)
osLvl = input.int(-60, "과매도", maxval=-1)
ap = hlc3
esa = ta.ema(ap, n1)
d = ta.ema(math.abs(ap - esa), n1)
ci = (ap - esa) / (0.015 * d)
wt1 = ta.ema(ci, n2)
wt2 = ta.sma(wt1, 4)
plot(wt1, "WT1", color=#2962FF, linewidth=2)
plot(wt2, "WT2", color=#FF6D00)
plot(wt1 - wt2, "차이", style=plot.style_columns, color=color.new(#787B86, 70))
h0 = hline(obLvl, "과매수", color=#787B86)
h1 = hline(osLvl, "과매도", color=#787B86)
hline(0, "0", color=color.new(#787B86, 50))
plotshape(ta.crossover(wt1, wt2) and wt2 < osLvl ? wt2 : na, "매수 후보", shape.circle, location.absolute, #0ECB81, size=size.tiny)
plotshape(ta.crossunder(wt1, wt2) and wt2 > obLvl ? wt2 : na, "매도 후보", shape.circle, location.absolute, #F6465D, size=size.tiny)
` },
{ id: 'bbpb', cat: '변동성', name: '볼린저 %B', desc: '가격이 볼린저 밴드 안 어디쯤인지 (0 = 하단, 1 = 상단)', src: `//@version=5
indicator("볼린저 %B", shorttitle="%B", overlay=false)
len = input.int(20, "기간", minval=2)
mult = input.float(2.0, "표준편차 배수", step=0.1)
basis = ta.sma(close, len)
dev = mult * ta.stdev(close, len)
pb = (close - (basis - dev)) / (2 * dev)
plot(pb, "%B", color=#2962FF, linewidth=2)
h0 = hline(1, "상단", color=#787B86)
hline(0.5, "중심", color=color.new(#787B86, 50))
h1 = hline(0, "하단", color=#787B86)
fill(h0, h1, color=color.rgb(33, 150, 243, 92), title="배경")
` },
{ id: 'bbw', cat: '변동성', name: '볼린저 밴드폭', desc: '밴드가 좁아지면(압축) 큰 움직임 전조, 넓으면 과열', src: `//@version=5
indicator("볼린저 밴드폭", shorttitle="BBW", overlay=false)
len = input.int(20, "기간", minval=2)
mult = input.float(2.0, "표준편차 배수", step=0.1)
lookback = input.int(120, "저점 비교 기간", minval=10)
basis = ta.sma(close, len)
bw = 2 * mult * ta.stdev(close, len) / basis * 100
plot(bw, "밴드폭 %", color=#2962FF, linewidth=2)
plot(ta.lowest(bw, lookback), "최근 최저", color=#F0B90B)
` },
{ id: 'chop', cat: '추세 강도', name: '초피니스 지수 (CHOP)', desc: '61.8 위는 횡보, 38.2 아래는 추세장', src: `//@version=5
indicator("초피니스 지수", shorttitle="CHOP", overlay=false)
len = input.int(14, "기간", minval=2)
trSum = ta.sma(ta.tr, len) * len
ci = 100 * math.log10(trSum / (ta.highest(high, len) - ta.lowest(low, len))) / math.log10(len)
plot(ci, "CHOP", color=#2962FF, linewidth=2)
h0 = hline(61.8, "횡보", color=#787B86)
h1 = hline(38.2, "추세", color=#787B86)
fill(h0, h1, color=color.rgb(33, 150, 243, 92), title="배경")
` },
{ id: 'utbot', cat: '추세', name: 'UT Bot (ATR 추적 손절)', desc: 'ATR 추적선을 가격이 뚫으면 매수 · 매도 표시', src: `//@version=5
indicator("UT Bot", shorttitle="UT", overlay=true)
key = input.float(1.0, "민감도 (배수)", step=0.1)
atrLen = input.int(10, "ATR 기간", minval=1)
nLoss = key * ta.atr(atrLen)
var float stop = 0.0
prev = nz(stop[1])
stop := close > prev and close[1] > prev ? math.max(prev, close - nLoss) : close < prev and close[1] < prev ? math.min(prev, close + nLoss) : close > prev ? close - nLoss : close + nLoss
plot(stop, "추적선", color = close > stop ? #0ECB81 : #F6465D, linewidth=2)
plotshape(ta.crossover(close, stop), "매수", shape.labelup, location.belowbar, #0ECB81, text="B", textcolor=color.white, size=size.tiny)
plotshape(ta.crossunder(close, stop), "매도", shape.labeldown, location.abovebar, #F6465D, text="S", textcolor=color.white, size=size.tiny)
` },
{ id: 'rsidiv', cat: '모멘텀', name: 'RSI 다이버전스', desc: '알람의 RSI 다이버전스와 같은 기준 (왼쪽 5 · 오른쪽 3봉, 간격 5~60봉)', src: `//@version=5
indicator("RSI 다이버전스", shorttitle="RSI Div", overlay=false)
len = input.int(14, "RSI 기간", minval=2)
lbL = input.int(5, "왼쪽 봉 수", minval=1)
lbR = input.int(3, "오른쪽 봉 수", minval=1)
rangeLower = input.int(5, "두 점 사이 최소 봉", minval=1)
rangeUpper = input.int(60, "두 점 사이 최대 봉", minval=2)
osc = ta.rsi(close, len)
plFound = not na(ta.pivotlow(osc, lbL, lbR))
phFound = not na(ta.pivothigh(osc, lbL, lbR))
inRangeL = ta.barssince(plFound[1]) >= rangeLower - 1 and ta.barssince(plFound[1]) <= rangeUpper - 1
inRangeH = ta.barssince(phFound[1]) >= rangeLower - 1 and ta.barssince(phFound[1]) <= rangeUpper - 1
oscHL = osc[lbR] > ta.valuewhen(plFound, osc[lbR], 1) and inRangeL
priceLL = low[lbR] < ta.valuewhen(plFound, low[lbR], 1)
oscLH = osc[lbR] < ta.valuewhen(phFound, osc[lbR], 1) and inRangeH
priceHH = high[lbR] > ta.valuewhen(phFound, high[lbR], 1)
bull = plFound and priceLL and oscHL
bear = phFound and priceHH and oscLH
plot(osc, "RSI", color=#B388FF, linewidth=1)
hline(70, "70", color=#787B86)
hline(30, "30", color=#787B86)
plotshape(bull ? osc[lbR] : na, "상승 다이버전스", shape.labelup, location.absolute, #0ECB81, text="강세", textcolor=color.white, offset=-lbR, size=size.tiny)
plotshape(bear ? osc[lbR] : na, "하락 다이버전스", shape.labeldown, location.absolute, #F6465D, text="약세", textcolor=color.white, offset=-lbR, size=size.tiny)
` },
{ id: 'dema', cat: '추세', name: '이중 지수이동평균 (DEMA)', desc: 'EMA보다 지연이 적은 이동평균', src: `//@version=5
indicator("이중 지수이동평균", shorttitle="DEMA", overlay=true)
len = input.int(21, "기간", minval=1)
src = input.source(close, "소스")
e1 = ta.ema(src, len)
e2 = ta.ema(e1, len)
plot(2 * e1 - e2, "DEMA", color=#43BCCD, linewidth=2)
` },
{ id: 'tema', cat: '추세', name: '삼중 지수이동평균 (TEMA)', desc: 'DEMA보다 더 빠르게 반응하는 이동평균', src: `//@version=5
indicator("삼중 지수이동평균", shorttitle="TEMA", overlay=true)
len = input.int(21, "기간", minval=1)
src = input.source(close, "소스")
e1 = ta.ema(src, len)
e2 = ta.ema(e1, len)
e3 = ta.ema(e2, len)
plot(3 * (e1 - e2) + e3, "TEMA", color=#FF9800, linewidth=2)
` },
{ id: 'ribbon', cat: '추세', name: '이동평균 리본', desc: 'EMA 20~55 여덟 개 · 펼쳐지면 추세, 꼬이면 횡보', src: `//@version=5
indicator("이동평균 리본", shorttitle="MA Ribbon", overlay=true)
start = input.int(20, "첫 기간", minval=1)
step = input.int(5, "간격", minval=1)
src = input.source(close, "소스")
plot(ta.ema(src, start), "EMA 1", color=#F6465D)
plot(ta.ema(src, start + step), "EMA 2", color=#FF7043)
plot(ta.ema(src, start + step * 2), "EMA 3", color=#F0B90B)
plot(ta.ema(src, start + step * 3), "EMA 4", color=#C0CA33)
plot(ta.ema(src, start + step * 4), "EMA 5", color=#0ECB81)
plot(ta.ema(src, start + step * 5), "EMA 6", color=#00BCD4)
plot(ta.ema(src, start + step * 6), "EMA 7", color=#2962FF)
plot(ta.ema(src, start + step * 7), "EMA 8", color=#B388FF)
` },
{ id: 'envelope', cat: '변동성', name: '엔벨로프', desc: '이동평균 위아래 일정 % 띠', src: `//@version=5
indicator("엔벨로프", shorttitle="Env", overlay=true)
len = input.int(20, "기간", minval=1)
pct = input.float(5.0, "폭 (%)", minval=0.1, step=0.5)
useEma = input.string("SMA", "이동평균", options=["SMA", "EMA"])
basis = useEma == "EMA" ? ta.ema(close, len) : ta.sma(close, len)
up = basis * (1 + pct / 100)
dn = basis * (1 - pct / 100)
plot(basis, "기준선", color=#FF6D00)
p1 = plot(up, "위", color=#2962FF)
p2 = plot(dn, "아래", color=#2962FF)
fill(p1, p2, color=color.rgb(41, 98, 255, 92), title="배경")
` },
{ id: 'linregch', cat: '추세', name: '선형 회귀 채널', desc: '회귀선 ± 표준편차 띠', src: `//@version=5
indicator("선형 회귀 채널", shorttitle="LinReg", overlay=true)
len = input.int(100, "기간", minval=2)
mult = input.float(2.0, "표준편차 배수", minval=0.1, step=0.1)
src = input.source(close, "소스")
mid = ta.linreg(src, len, 0)
dev = ta.stdev(src, len)
plot(mid, "회귀선", color=#FF9800, linewidth=2)
p1 = plot(mid + mult * dev, "위", color=#2962FF)
p2 = plot(mid - mult * dev, "아래", color=#F6465D)
fill(p1, p2, color=color.rgb(41, 98, 255, 94), title="배경")
` },
{ id: 'alligator', cat: '추세', name: '윌리엄스 앨리게이터', desc: '턱 · 이빨 · 입술 세 개의 평활 이평 (앞으로 이동)', src: `//@version=5
indicator("윌리엄스 앨리게이터", shorttitle="Alligator", overlay=true)
jawLen = input.int(13, "턱 기간", minval=1)
teethLen = input.int(8, "이빨 기간", minval=1)
lipsLen = input.int(5, "입술 기간", minval=1)
plot(ta.rma(hl2, jawLen), "턱", offset=8, color=#2962FF)
plot(ta.rma(hl2, teethLen), "이빨", offset=5, color=#E91E63)
plot(ta.rma(hl2, lipsLen), "입술", offset=3, color=#66BB6A)
` },
{ id: 'mcginley', cat: '추세', name: '맥긴리 다이내믹', desc: '시장 속도에 맞춰 스스로 조절되는 이동평균', src: `//@version=5
indicator("맥긴리 다이내믹", shorttitle="McGinley", overlay=true)
len = input.int(14, "기간", minval=1)
var float md = na
md := na(md[1]) ? ta.ema(close, len) : md[1] + (close - md[1]) / (len * math.pow(close / md[1], 4))
plot(md, "McGinley", color=#00BCD4, linewidth=2)
` },
{ id: 'trix', cat: '모멘텀', name: 'TRIX', desc: '삼중 평활 EMA의 변화율 · 0선 교차', src: `//@version=5
indicator("TRIX", shorttitle="TRIX", overlay=false)
len = input.int(18, "기간", minval=1)
sig = input.int(9, "시그널", minval=1)
t = 10000 * ta.change(ta.ema(ta.ema(ta.ema(math.log(close), len), len), len))
plot(t, "TRIX", color=#F23645)
plot(ta.ema(t, sig), "시그널", color=#2962FF)
hline(0, "0", color=#787B86)
` },
{ id: 'tsi', cat: '모멘텀', name: '트루 스트렝스 지수 (TSI)', desc: '이중 평활 모멘텀 · 시그널 교차', src: `//@version=5
indicator("트루 스트렝스 지수", shorttitle="TSI", overlay=false)
longLen = input.int(25, "긴 기간", minval=1)
shortLen = input.int(13, "짧은 기간", minval=1)
sigLen = input.int(13, "시그널", minval=1)
pc = ta.change(close)
num = ta.ema(ta.ema(pc, longLen), shortLen)
den = ta.ema(ta.ema(math.abs(pc), longLen), shortLen)
tsi = den == 0 ? 0 : 100 * num / den
plot(tsi, "TSI", color=#2962FF)
plot(ta.ema(tsi, sigLen), "시그널", color=#E91E63)
hline(0, "0", color=#787B86)
` },
{ id: 'uo', cat: '모멘텀', name: '얼티밋 오실레이터', desc: '7 · 14 · 28봉 매수 압력을 합친 0~100', src: `//@version=5
indicator("얼티밋 오실레이터", shorttitle="UO", overlay=false)
l1 = input.int(7, "짧은 기간", minval=1)
l2 = input.int(14, "중간 기간", minval=1)
l3 = input.int(28, "긴 기간", minval=1)
bp = close - math.min(low, nz(close[1], close))
trr = math.max(high, nz(close[1], close)) - math.min(low, nz(close[1], close))
a1 = math.sum(bp, l1) / math.sum(trr, l1)
a2 = math.sum(bp, l2) / math.sum(trr, l2)
a3 = math.sum(bp, l3) / math.sum(trr, l3)
uo = 100 * (4 * a1 + 2 * a2 + a3) / 7
plot(uo, "UO", color=#F44336)
hline(70, "70", color=#787B86)
hline(30, "30", color=#787B86)
` },
{ id: 'mom', cat: '모멘텀', name: '모멘텀', desc: '현재가 − N봉 전 가격', src: `//@version=5
indicator("모멘텀", shorttitle="Mom", overlay=false)
len = input.int(10, "기간", minval=1)
src = input.source(close, "소스")
m = src - src[len]
plot(m, "Mom", color=#2962FF)
hline(0, "0", color=#787B86)
` },
{ id: 'ppo', cat: '모멘텀', name: '가격 오실레이터 (PPO)', desc: 'MACD를 % 로 · 코인끼리 비교하기 좋음', src: `//@version=5
indicator("가격 오실레이터", shorttitle="PPO", overlay=false)
fastLen = input.int(12, "빠른 기간", minval=1)
slowLen = input.int(26, "느린 기간", minval=1)
sigLen = input.int(9, "시그널", minval=1)
f = ta.ema(close, fastLen)
s = ta.ema(close, slowLen)
ppo = s == 0 ? 0 : (f - s) / s * 100
sig = ta.ema(ppo, sigLen)
plot(ppo - sig, "히스토그램", style=plot.style_columns, color = ppo - sig >= 0 ? color.new(#0ECB81, 40) : color.new(#F6465D, 40))
plot(ppo, "PPO", color=#2962FF)
plot(sig, "시그널", color=#FF6D00)
hline(0, "0", color=#787B86)
` },
{ id: 'dpo', cat: '모멘텀', name: '추세 제거 가격 오실레이터 (DPO)', desc: '추세를 빼고 주기만 보기', src: `//@version=5
indicator("추세 제거 가격 오실레이터", shorttitle="DPO", overlay=false)
len = input.int(21, "기간", minval=2)
back = math.floor(len / 2) + 1
ma = ta.sma(close, len)
plot(close - ma[back], "DPO", color=#43A047)
hline(0, "0", color=#787B86)
` },
{ id: 'kst', cat: '모멘텀', name: 'KST (Know Sure Thing)', desc: '네 가지 기간 변화율의 가중 합', src: `//@version=5
indicator("Know Sure Thing", shorttitle="KST", overlay=false)
sigLen = input.int(9, "시그널", minval=1)
r1 = ta.sma(ta.roc(close, 10), 10)
r2 = ta.sma(ta.roc(close, 15), 10)
r3 = ta.sma(ta.roc(close, 20), 10)
r4 = ta.sma(ta.roc(close, 30), 15)
kst = r1 + 2 * r2 + 3 * r3 + 4 * r4
plot(kst, "KST", color=#009688)
plot(ta.sma(kst, sigLen), "시그널", color=#F44336)
hline(0, "0", color=#787B86)
` },
{ id: 'coppock', cat: '모멘텀', name: '코폭 곡선', desc: '장기 바닥 신호 (0 아래에서 상승 전환)', src: `//@version=5
indicator("코폭 곡선", shorttitle="Coppock", overlay=false)
wmaLen = input.int(10, "WMA 기간", minval=1)
longRoc = input.int(14, "긴 변화율", minval=1)
shortRoc = input.int(11, "짧은 변화율", minval=1)
c = ta.wma(ta.roc(close, longRoc) + ta.roc(close, shortRoc), wmaLen)
plot(c, "Coppock", style=plot.style_columns, color = c >= 0 ? color.new(#0ECB81, 30) : color.new(#F6465D, 30))
hline(0, "0", color=#787B86)
` },
{ id: 'fisher', cat: '모멘텀', name: '피셔 변환', desc: '가격을 정규분포로 바꿔 전환점을 날카롭게', src: `//@version=5
indicator("피셔 변환", shorttitle="Fisher", overlay=false)
len = input.int(9, "기간", minval=1)
hi = ta.highest(hl2, len)
lo = ta.lowest(hl2, len)
rng = hi - lo
var float v = 0.0
raw = rng == 0 ? 0.0 : 0.66 * ((hl2 - lo) / rng - 0.5) + 0.67 * nz(v[1])
v := raw > 0.99 ? 0.999 : raw < -0.99 ? -0.999 : raw
var float fish = 0.0
fish := 0.5 * math.log((1 + v) / (1 - v)) + 0.5 * nz(fish[1])
plot(fish, "Fisher", color=#2962FF)
plot(fish[1], "트리거", color=#FF6D00)
hline(1.5, "1.5", color=#787B86)
hline(0, "0", color=#787B86)
hline(-1.5, "-1.5", color=#787B86)
` },
{ id: 'bop', cat: '모멘텀', name: '세력 균형 (BOP)', desc: '봉 안에서 매수 · 매도 중 누가 이겼나', src: `//@version=5
indicator("세력 균형", shorttitle="BOP", overlay=false)
len = input.int(14, "평활 기간", minval=1)
raw = high == low ? 0 : (close - open) / (high - low)
b = ta.sma(raw, len)
plot(b, "BOP", style=plot.style_columns, color = b >= 0 ? color.new(#0ECB81, 30) : color.new(#F6465D, 30))
hline(0, "0", color=#787B86)
` },
{ id: 'cmo', cat: '모멘텀', name: '샹드 모멘텀 오실레이터 (CMO)', desc: '상승폭과 하락폭의 차이 · ±50 과열', src: `//@version=5
indicator("샹드 모멘텀 오실레이터", shorttitle="CMO", overlay=false)
len = input.int(9, "기간", minval=1)
m = ta.change(close)
su = math.sum(m >= 0 ? m : 0.0, len)
sd = math.sum(m >= 0 ? 0.0 : -m, len)
cmo = su + sd == 0 ? 0 : 100 * (su - sd) / (su + sd)
plot(cmo, "CMO", color=#2962FF)
hline(50, "50", color=#787B86)
hline(0, "0", color=#787B86)
hline(-50, "-50", color=#787B86)
` },
{ id: 'bbpower', cat: '모멘텀', name: '강세 · 약세 파워', desc: '고가 · 저가가 EMA에서 얼마나 벗어났나', src: `//@version=5
indicator("강세 · 약세 파워", shorttitle="BBPower", overlay=false)
len = input.int(13, "EMA 기간", minval=1)
e = ta.ema(close, len)
p = (high - e) + (low - e)
plot(p, "파워", style=plot.style_columns, color = p >= 0 ? color.new(#0ECB81, 30) : color.new(#F6465D, 30))
hline(0, "0", color=#787B86)
` },
{ id: 'adline', cat: '거래량', name: '누적 분산 (A/D)', desc: '종가 위치 × 거래량의 누적 · 매집 흐름', src: `//@version=5
indicator("누적 분산", shorttitle="A/D", overlay=false)
mfm = high == low ? 0 : ((2 * close - low - high) / (high - low)) * volume
plot(ta.cum(mfm), "A/D", color=#999915)
` },
{ id: 'chaikinosc', cat: '거래량', name: '차이킨 오실레이터', desc: 'A/D 선의 빠른 EMA − 느린 EMA', src: `//@version=5
indicator("차이킨 오실레이터", shorttitle="ChaikinOsc", overlay=false)
fastLen = input.int(3, "빠른 기간", minval=1)
slowLen = input.int(10, "느린 기간", minval=1)
mfm = high == low ? 0 : ((2 * close - low - high) / (high - low)) * volume
ad = ta.cum(mfm)
osc = ta.ema(ad, fastLen) - ta.ema(ad, slowLen)
plot(osc, "Chaikin", color=#EC407A)
hline(0, "0", color=#787B86)
` },
{ id: 'efi', cat: '거래량', name: '엘더 강도 지수', desc: '가격 변화 × 거래량 · 움직임에 실린 힘', src: `//@version=5
indicator("엘더 강도 지수", shorttitle="EFI", overlay=false)
len = input.int(13, "기간", minval=1)
efi = ta.ema(ta.change(close) * volume, len)
plot(efi, "EFI", color=#F44336)
hline(0, "0", color=#787B86)
` },
{ id: 'eom', cat: '거래량', name: '이동 용이성 (EOM)', desc: '적은 거래량으로 쉽게 움직이는지', src: `//@version=5
indicator("이동 용이성", shorttitle="EOM", overlay=false)
len = input.int(14, "기간", minval=1)
div = input.int(10000, "나눗수", minval=1)
raw = volume == 0 ? 0 : div * ta.change(hl2) * (high - low) / volume
plot(ta.sma(raw, len), "EOM", color=#43A047)
hline(0, "0", color=#787B86)
` },
{ id: 'volosc', cat: '거래량', name: '거래량 오실레이터', desc: '짧은 · 긴 거래량 EMA의 차이 (%)', src: `//@version=5
indicator("거래량 오실레이터", shorttitle="VolOsc", overlay=false)
shortLen = input.int(5, "짧은 기간", minval=1)
longLen = input.int(10, "긴 기간", minval=1)
s = ta.ema(volume, shortLen)
l = ta.ema(volume, longLen)
plot(l == 0 ? 0 : 100 * (s - l) / l, "VolOsc", color=#2962FF)
hline(0, "0", color=#787B86)
` },
{ id: 'pvt', cat: '거래량', name: '가격 거래량 추세 (PVT)', desc: '변화율 × 거래량의 누적', src: `//@version=5
indicator("가격 거래량 추세", shorttitle="PVT", overlay=false)
r = nz(close[1]) == 0 ? 0 : ta.change(close) / close[1] * volume
plot(ta.cum(nz(r)), "PVT", color=#2962FF)
` },
{ id: 'hv', cat: '변동성', name: '역사적 변동성', desc: '로그 수익률 표준편차의 연 환산 (%)', src: `//@version=5
indicator("역사적 변동성", shorttitle="HV", overlay=false)
len = input.int(10, "기간", minval=2)
per = input.int(365, "1년의 봉 수 (일봉 365)", minval=1)
r = math.log(close / nz(close[1], close))
plot(100 * ta.stdev(r, len) * math.sqrt(per), "HV", color=#2962FF)
` },
{ id: 'stdev', cat: '변동성', name: '표준편차', desc: '가격이 평균에서 퍼진 정도', src: `//@version=5
indicator("표준편차", shorttitle="StdDev", overlay=false)
len = input.int(20, "기간", minval=2)
src = input.source(close, "소스")
plot(ta.stdev(src, len), "StdDev", color=#2962FF)
` },
{ id: 'vortex', cat: '추세 강도', name: '보텍스 지표', desc: 'VI+ · VI− 교차로 추세 방향', src: `//@version=5
indicator("보텍스 지표", shorttitle="VI", overlay=false)
len = input.int(14, "기간", minval=2)
vmp = math.sum(math.abs(high - nz(low[1], low)), len)
vmm = math.sum(math.abs(low - nz(high[1], high)), len)
str = math.sum(ta.tr(true), len)
plot(str == 0 ? 0 : vmp / str, "VI +", color=#2962FF)
plot(str == 0 ? 0 : vmm / str, "VI -", color=#E91E63)
` },
{ id: 'massidx', cat: '변동성', name: '매스 인덱스', desc: '고저 폭의 확장 · 27 돌파 후 26.5 하회 = 반전 경고', src: `//@version=5
indicator("매스 인덱스", shorttitle="Mass", overlay=false)
len = input.int(25, "합산 기간", minval=1)
span = high - low
e1 = ta.ema(span, 9)
e2 = ta.ema(e1, 9)
plot(math.sum(e2 == 0 ? 1 : e1 / e2, len), "Mass", color=#2962FF)
hline(27, "27", color=#787B86)
hline(26.5, "26.5", color=#787B86)
` }
];
