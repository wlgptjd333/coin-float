import java.io.*;
import java.nio.file.*;
import java.util.*;

/**
 * Backtest of CoinFloat's alert rules on Binance USD-M 1m candles, judged as counter-trend (fade) entries.
 * Entry = the close of the 1m bar on which the alert would have fired. Outcomes are measured on the 1m path after it.
 * usage: java Bt.java <dataDir> <mode> SYMBOL...
 */
public class Bt {
    static final double FEE = 0.10;                      // percent, round trip (taker 0.05 % x 2)

    static class Sym {
        String name; int n; long t0;
        double[] o, h, l, c, v, tb;
    }

    static class Tf {
        int m, n; int[] end;                              // end[k] = 1m index of the last minute of candle k
        double[] o, h, l, c, v, tb;
    }

    static class Sig { int e; int dir; double stop; Sig(int e, int dir, double stop) { this.e = e; this.dir = dir; this.stop = stop; } }

    static Sym load(String dir, String name) throws IOException {
        List<String> lines = Files.readAllLines(Paths.get(dir, name + "_1m.csv"));
        long t0 = Long.parseLong(lines.get(0).split(",")[0]);
        long tN = Long.parseLong(lines.get(lines.size() - 1).split(",")[0]);
        int n = (int) ((tN - t0) / 60000) + 1;
        Sym s = new Sym(); s.name = name; s.n = n; s.t0 = t0;
        s.o = new double[n]; s.h = new double[n]; s.l = new double[n]; s.c = new double[n]; s.v = new double[n]; s.tb = new double[n];
        boolean[] have = new boolean[n];
        for (String ln : lines) {
            String[] f = ln.split(",");
            int i = (int) ((Long.parseLong(f[0]) - t0) / 60000);
            s.o[i] = Double.parseDouble(f[1]); s.h[i] = Double.parseDouble(f[2]); s.l[i] = Double.parseDouble(f[3]);
            s.c[i] = Double.parseDouble(f[4]); s.v[i] = Double.parseDouble(f[5]); s.tb[i] = Double.parseDouble(f[6]);
            have[i] = true;
        }
        int gaps = 0;
        for (int i = 1; i < n; i++) if (!have[i]) { gaps++; s.o[i] = s.h[i] = s.l[i] = s.c[i] = s.c[i - 1]; }
        if (gaps > 0) System.out.println(name + ": " + gaps + " missing minutes filled");
        return s;
    }

    static Tf agg(Sym s, int m) {
        int first = 0;
        while ((s.t0 / 60000 + first) % m != 0) first++;
        int n = (s.n - first) / m;
        Tf t = new Tf(); t.m = m; t.n = n; t.end = new int[n];
        t.o = new double[n]; t.h = new double[n]; t.l = new double[n]; t.c = new double[n]; t.v = new double[n]; t.tb = new double[n];
        for (int k = 0; k < n; k++) {
            int a = first + k * m;
            t.o[k] = s.o[a]; t.h[k] = s.h[a]; t.l[k] = s.l[a];
            for (int j = a; j < a + m; j++) { t.h[k] = Math.max(t.h[k], s.h[j]); t.l[k] = Math.min(t.l[k], s.l[j]); t.v[k] += s.v[j]; t.tb[k] += s.tb[j]; }
            t.c[k] = s.c[a + m - 1]; t.end[k] = a + m - 1;
        }
        return t;
    }

    // ---- indicators (same formulas as AlertEngine.kt) --------------------------------------------------------------------
    static double[] rsi(double[] c, int len) {
        double[] out = new double[c.length]; Arrays.fill(out, Double.NaN);
        double g = 0, l = 0;
        for (int i = 1; i < c.length; i++) {
            double ch = c[i] - c[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
            if (i <= len) { g += up; l += dn; if (i == len) { g /= len; l /= len; } }
            else { g = (g * (len - 1) + up) / len; l = (l * (len - 1) + dn) / len; }
            if (i >= len) out[i] = l == 0 ? 100 : g == 0 ? 0 : 100 - 100 / (1 + g / l);
        }
        return out;
    }
    static double[] ema(double[] src, int len) {
        double[] out = new double[src.length]; Arrays.fill(out, Double.NaN);
        double a = 2.0 / (len + 1), sum = 0; int count = 0; boolean st = false;
        for (int i = 0; i < src.length; i++) {
            double v = src[i]; if (Double.isNaN(v)) continue;
            if (!st) { sum += v; count++; if (count == len) { out[i] = sum / len; st = true; } }
            else out[i] = out[i - 1] + a * (v - out[i - 1]);
        }
        return out;
    }
    static double[] sma(double[] src, int len) {
        double[] out = new double[src.length]; Arrays.fill(out, Double.NaN); double sum = 0;
        for (int i = 0; i < src.length; i++) { sum += src[i]; if (i >= len) sum -= src[i - len]; if (i >= len - 1) out[i] = sum / len; }
        return out;
    }
    static double[] stdev(double[] src, double[] mid, int len) {
        double[] out = new double[src.length]; Arrays.fill(out, Double.NaN);
        for (int i = len - 1; i < src.length; i++) { double sq = 0; for (int j = i - len + 1; j <= i; j++) { double d = src[j] - mid[i]; sq += d * d; } out[i] = Math.sqrt(sq / len); }
        return out;
    }
    static boolean isPivot(double[] src, int p, int left, int right, boolean high) {
        if (p - left < 0 || p + right >= src.length || Double.isNaN(src[p])) return false;
        double v = src[p];
        for (int i = p - left; i <= p + right; i++) {
            if (i == p || Double.isNaN(src[i])) continue;
            if (high) { if (i < p ? src[i] > v : src[i] >= v) return false; }
            else { if (i < p ? src[i] < v : src[i] <= v) return false; }
        }
        return true;
    }

    // ---- rules ---------------------------------------------------------------------------------------------------------------
    /** Exhaustion as in AlertEngine.exhaustion; extra filters: rsiMax (RSI of the candle must be below it for lows; mirrored), dropMin
     *  (percent the close fell from the highest high of the `dropLen` candles before; mirrored for highs). */
    static List<Sig> exh(Tf t, double mult, double minRange, double wick, int len, double rsiMax, double dropMin, int dropLen) {
        List<Sig> out = new ArrayList<>();
        double[] r = rsiMax > 0 ? rsi(t.c, 14) : null;
        for (int k = Math.max(len, dropLen) + 15; k < t.n; k++) {
            double sum = 0, hi = -1e300, lo = 1e300;
            for (int i = k - len; i < k; i++) { sum += t.v[i]; hi = Math.max(hi, t.h[i]); lo = Math.min(lo, t.l[i]); }
            double avg = sum / len, rng = t.h[k] - t.l[k];
            if (avg <= 0 || rng <= 0 || t.v[k] < mult * avg || rng / t.o[k] * 100 < minRange) continue;
            double back = (t.c[k] - t.l[k]) / rng, down = (t.h[k] - t.c[k]) / rng;
            int dir = 0;
            if (t.l[k] < lo && back >= wick) dir = 1;
            else if (t.h[k] > hi && down >= wick) dir = -1;
            if (dir == 0) continue;
            if (r != null) { if (dir == 1 ? !(r[k] <= rsiMax) : !(r[k] >= 100 - rsiMax)) continue; }
            if (dropMin > 0) {
                double xh = -1e300, xl = 1e300;
                for (int i = k - dropLen; i < k; i++) { xh = Math.max(xh, t.h[i]); xl = Math.min(xl, t.l[i]); }
                double mv = dir == 1 ? (xh - t.l[k]) / xh * 100 : (t.h[k] - xl) / xl * 100;
                if (mv < dropMin) continue;
            }
            out.add(new Sig(t.end[k], dir, dir == 1 ? t.l[k] : t.h[k]));
        }
        return out;
    }

    /** Failed break: a new `len`-candle low that closed back above the previous low (mirrored), on at least `mult` x volume. */
    static List<Sig> sweep(Tf t, double mult, int len, double minRange) {
        List<Sig> out = new ArrayList<>();
        for (int k = len + 1; k < t.n; k++) {
            double sum = 0, hi = -1e300, lo = 1e300;
            for (int i = k - len; i < k; i++) { sum += t.v[i]; hi = Math.max(hi, t.h[i]); lo = Math.min(lo, t.l[i]); }
            double avg = sum / len, rng = t.h[k] - t.l[k];
            if (avg <= 0 || rng <= 0 || t.v[k] < mult * avg || rng / t.o[k] * 100 < minRange) continue;
            if (t.l[k] < lo && t.c[k] > lo) out.add(new Sig(t.end[k], 1, t.l[k]));
            else if (t.h[k] > hi && t.c[k] < hi) out.add(new Sig(t.end[k], -1, t.h[k]));
        }
        return out;
    }

    static List<Sig> flip(List<Sig> in) { List<Sig> out = new ArrayList<>(); for (Sig g : in) out.add(new Sig(g.e, -g.dir, 0)); return out; }

    /** Breakout as AlertEngine.breakout: close beyond the previous `len` candles' range, the candle before had not. dir = follow. */
    static List<Sig> brk(Tf t, int len, double volMult) {
        List<Sig> out = new ArrayList<>();
        for (int k = len + 2; k < t.n; k++) {
            double hi = -1e300, lo = 1e300, sum = 0, hp = -1e300, lp = 1e300;
            for (int i = k - len; i < k; i++) { hi = Math.max(hi, t.h[i]); lo = Math.min(lo, t.l[i]); sum += t.v[i]; }
            if (volMult > 0 && t.v[k] < volMult * sum / len) continue;
            for (int i = k - 1 - len; i < k - 1; i++) { hp = Math.max(hp, t.h[i]); lp = Math.min(lp, t.l[i]); }
            if (t.c[k] > hi && t.c[k - 1] <= hp) out.add(new Sig(t.end[k], 1, 0));
            else if (t.c[k] < lo && t.c[k - 1] >= lp) out.add(new Sig(t.end[k], -1, 0));
        }
        return out;
    }

    /** Real-time volume spike: fires on the first 1m bar of the forming candle whose running volume and body pass the thresholds.
     *  dir = the direction of the candle at that moment (follow). Use fade = true to flip. */
    static List<Sig> volLive(Sym s, Tf t, double mult, double minBody, int len, boolean fade) {
        List<Sig> out = new ArrayList<>();
        for (int k = len; k < t.n; k++) {
            double sum = 0; for (int i = k - len; i < k; i++) sum += t.v[i];
            double avg = sum / len; if (avg <= 0) continue;
            int a = t.end[k] - t.m + 1; double run = 0;
            for (int j = a; j <= t.end[k]; j++) {
                run += s.v[j];
                double body = Math.abs(s.c[j] - t.o[k]) / t.o[k] * 100;
                if (run >= mult * avg && body >= minBody) {
                    int d = s.c[j] >= t.o[k] ? 1 : -1;
                    out.add(new Sig(j, fade ? -d : d, 0)); break;
                }
            }
        }
        return out;
    }

    /** Volume spike at the close. */
    static List<Sig> volClose(Tf t, double mult, double minBody, int len, boolean fade) {
        List<Sig> out = new ArrayList<>();
        for (int k = len; k < t.n; k++) {
            double sum = 0; for (int i = k - len; i < k; i++) sum += t.v[i];
            double avg = sum / len; if (avg <= 0 || t.v[k] < mult * avg) continue;
            double body = Math.abs(t.c[k] - t.o[k]) / t.o[k] * 100; if (body < minBody) continue;
            int d = t.c[k] >= t.o[k] ? 1 : -1;
            out.add(new Sig(t.end[k], fade ? -d : d, 0));
        }
        return out;
    }

    /** RSI(len) crossing a level. mode 0: back up through `lo` (long) / back down through 100 - lo (short): "re-entry".
     *  mode 1: down through `lo` (long, catching the knife) / up through 100 - lo (short). */
    static List<Sig> rsiCross(Tf t, int len, double lo, int mode) {
        List<Sig> out = new ArrayList<>(); double[] r = rsi(t.c, len); double hi = 100 - lo;
        for (int k = len + 2; k < t.n; k++) {
            if (mode == 0) {
                if (r[k - 1] <= lo && r[k] > lo) out.add(new Sig(t.end[k], 1, 0));
                else if (r[k - 1] >= hi && r[k] < hi) out.add(new Sig(t.end[k], -1, 0));
            } else {
                if (r[k - 1] >= lo && r[k] < lo) out.add(new Sig(t.end[k], 1, 0));
                else if (r[k - 1] <= hi && r[k] > hi) out.add(new Sig(t.end[k], -1, 0));
            }
        }
        return out;
    }

    /** Bollinger: mode 1 = close crosses outside the band (fade it), mode 0 = close comes back inside after being outside. */
    static List<Sig> bb(Tf t, int len, double mult, int mode) {
        List<Sig> out = new ArrayList<>(); double[] mid = sma(t.c, len), sd = stdev(t.c, mid, len);
        for (int k = len + 1; k < t.n; k++) {
            double u0 = mid[k - 1] + mult * sd[k - 1], l0 = mid[k - 1] - mult * sd[k - 1], u1 = mid[k] + mult * sd[k], l1 = mid[k] - mult * sd[k];
            if (mode == 1) {
                if (t.c[k - 1] >= l0 && t.c[k] < l1) out.add(new Sig(t.end[k], 1, 0));
                else if (t.c[k - 1] <= u0 && t.c[k] > u1) out.add(new Sig(t.end[k], -1, 0));
            } else {
                if (t.c[k - 1] < l0 && t.c[k] >= l1) out.add(new Sig(t.end[k], 1, 0));
                else if (t.c[k - 1] > u0 && t.c[k] <= u1) out.add(new Sig(t.end[k], -1, 0));
            }
        }
        return out;
    }

    /** Regular divergence as AlertEngine.divergence (oscillator pivots, left 5, gap 5..60). src: 0 RSI, 1 CVD. */
    static List<Sig> div(Tf t, int src, int right) {
        List<Sig> out = new ArrayList<>(); int left = 5, minGap = 5, maxGap = 60;
        double[] osc;
        if (src == 0) osc = rsi(t.c, 14);
        else { osc = new double[t.n]; double acc = 0; for (int i = 0; i < t.n; i++) { acc += 2 * t.tb[i] - t.v[i]; osc[i] = acc; } }
        boolean[] pl = new boolean[t.n], ph = new boolean[t.n];
        for (int p = left; p < t.n - right; p++) { pl[p] = isPivot(osc, p, left, right, false); ph[p] = isPivot(osc, p, left, right, true); }
        for (int k = 80; k < t.n; k++) {
            int p = k - right;
            if (pl[p]) {
                for (int q = p - minGap; q >= Math.max(left, p - maxGap); q--) if (pl[q]) {
                    if (t.l[p] < t.l[q] && osc[p] > osc[q]) out.add(new Sig(t.end[k], 1, 0));
                    break;
                }
            }
            if (ph[p]) {
                for (int q = p - minGap; q >= Math.max(left, p - maxGap); q--) if (ph[q]) {
                    if (t.h[p] > t.h[q] && osc[p] < osc[q]) out.add(new Sig(t.end[k], -1, 0));
                    break;
                }
            }
        }
        return out;
    }

    // ---- evaluation ----------------------------------------------------------------------------------------------------------
    static final int[] HOR = { 5, 15, 60, 240 };
    static class Acc {
        int n; double[] sum = new double[HOR.length], sq = new double[HOR.length];
        int winA, lossA, winB, lossB, nB; double netA, netB, mae60, mfe60; int winR, nR; double netR;
        List<Double> maes = new ArrayList<>(), mfes = new ArrayList<>(), ttl = new ArrayList<>();
    }

    /** TP / SL race on 1m bars; the stop is checked first inside a bar (conservative). Returns percent, before fees. */
    static double race(Sym s, int e, int dir, double tpPct, double slPct, int maxMin) {
        double entry = s.c[e], tp = entry * (1 + dir * tpPct / 100), sl = entry * (1 - dir * slPct / 100);
        int end = Math.min(s.n - 1, e + maxMin);
        for (int j = e + 1; j <= end; j++) {
            if (dir == 1) { if (s.l[j] <= sl) return -slPct; if (s.h[j] >= tp) return tpPct; }
            else { if (s.h[j] >= sl) return -slPct; if (s.l[j] <= tp) return tpPct; }
        }
        return dir * (s.c[end] / entry - 1) * 100;
    }

    static void eval(Sym s, Sig g, Acc a) {
        int e = g.e; if (e + 241 >= s.n) return;
        double entry = s.c[e];
        a.n++;
        for (int x = 0; x < HOR.length; x++) { double r = g.dir * (s.c[e + HOR[x]] / entry - 1) * 100; a.sum[x] += r; a.sq[x] += r * r; }
        double ra = race(s, e, g.dir, 0.5, 0.5, 60); if (ra >= 0.5) a.winA++; else if (ra <= -0.5) a.lossA++; a.netA += ra - FEE;
        double rb = race(s, e, g.dir, 1.0, 1.0, 240); if (rb >= 1.0) a.winB++; else if (rb <= -1.0) a.lossB++; a.netB += rb - FEE;
        double mae = 0, mfe = 0; int tl = 0;
        for (int j = e + 1; j <= e + 60; j++) {
            double ad = g.dir == 1 ? (entry - s.l[j]) / entry * 100 : (s.h[j] - entry) / entry * 100;
            double fv = g.dir == 1 ? (s.h[j] - entry) / entry * 100 : (entry - s.l[j]) / entry * 100;
            if (ad > mae) { mae = ad; tl = j - e; } if (fv > mfe) mfe = fv;
        }
        a.maes.add(mae); a.mfes.add(mfe); a.ttl.add((double) tl);
        if (g.stop > 0) {                                  // structural stop: just beyond the signal candle's extreme, target 1.5 R
            double risk = Math.abs(entry - g.stop) / entry * 100 + 0.05;
            if (risk >= 0.15 && risk <= 3) {
                double rr = race(s, e, g.dir, risk * 1.5, risk, 240);
                a.nR++; if (rr >= risk * 1.5) a.winR++; a.netR += (rr - FEE) / risk;
            }
        }
    }

    static double med(List<Double> x) { if (x.isEmpty()) return 0; double[] a = x.stream().mapToDouble(Double::doubleValue).toArray(); Arrays.sort(a); return a[a.length / 2]; }

    static String row(String name, Acc a, double days) {
        if (a.n == 0) return String.format("%-34s n=0", name);
        StringBuilder sb = new StringBuilder(String.format("%-34s n=%5d %5.2f/d |", name, a.n, a.n / days));
        for (int x = 0; x < HOR.length; x++) {
            double m = a.sum[x] / a.n, sd = Math.sqrt(Math.max(1e-12, a.sq[x] / a.n - m * m)), t = m / (sd / Math.sqrt(a.n));
            sb.append(String.format(" %+.3f(t%+.1f)", m, t));
        }
        sb.append(String.format(" | A %2.0f%%/%2.0f%% net%+.3f | B %2.0f%%/%2.0f%% net%+.3f | mae %.2f mfe %.2f t%2.0fm",
            100.0 * a.winA / a.n, 100.0 * a.lossA / a.n, a.netA / a.n, 100.0 * a.winB / a.n, 100.0 * a.lossB / a.n, a.netB / a.n, med(a.maes), med(a.mfes), med(a.ttl)));
        if (a.nR > 0) sb.append(String.format(" | R n%d win%2.0f%% %+.2fR", a.nR, 100.0 * a.winR / a.nR, a.netR / a.nR));
        return sb.toString();
    }

    interface Rule { List<Sig> run(Sym s, Map<Integer, Tf> tf); }

    static double pct(List<Double> x, double p) { if (x.isEmpty()) return 0; double[] a = x.stream().mapToDouble(Double::doubleValue).toArray(); Arrays.sort(a); return a[(int) Math.min(a.length - 1, Math.floor(p * a.length))]; }

    /** Extra questions about one rule: long vs short, how often the signal candle's extreme breaks, how deep it goes against
     *  the entry, and whether waiting for a pullback (a limit order part of the way back to the extreme) is better. */
    static void deep(String name, List<Sym> syms, Rule rule) {
        Acc longs = new Acc(), shorts = new Acc();
        int n = 0, brk1 = 0, brk4 = 0;
        List<Double> mae4 = new ArrayList<>(), mfe4 = new ArrayList<>();
        double[] ks = { 0.25, 0.5, 0.75, 1.0 };
        int[] fill = new int[ks.length]; double[] ret4 = new double[ks.length], net = new double[ks.length]; int[] win = new int[ks.length], loss = new int[ks.length];
        double[][] tpsl = { { 0.5, 0.5, 60 }, { 0.7, 0.7, 120 }, { 1, 1, 240 }, { 1.5, 1, 240 }, { 2, 1, 240 }, { 1, 0.6, 240 }, { 1, 1.5, 240 }, { 0.6, 1.2, 120 } };
        int[] tw = new int[tpsl.length], tl = new int[tpsl.length]; double[] tn = new double[tpsl.length];
        int[] hold = { 30, 60, 120, 240, 480, 720 }; double[] hs = new double[hold.length]; int hn = 0;
        for (Sym s : syms) {
            Map<Integer, Tf> tf = new HashMap<>();
            for (int m : new int[] { 1, 3, 5, 15, 30, 60 }) tf.put(m, agg(s, m));
            for (Sig g : rule.run(s, tf)) {
                int e = g.e; if (e + 721 >= s.n) continue;
                eval(s, g, g.dir == 1 ? longs : shorts);
                double entry = s.c[e]; n++;
                boolean b1 = false, b4 = false; double mae = 0, mfe = 0;
                for (int j = e + 1; j <= e + 240; j++) {
                    boolean br = g.dir == 1 ? s.l[j] < g.stop : s.h[j] > g.stop;
                    if (br) { b4 = true; if (j <= e + 60) b1 = true; }
                    mae = Math.max(mae, g.dir == 1 ? (entry - s.l[j]) / entry * 100 : (s.h[j] - entry) / entry * 100);
                    mfe = Math.max(mfe, g.dir == 1 ? (s.h[j] - entry) / entry * 100 : (entry - s.l[j]) / entry * 100);
                }
                if (b1) brk1++; if (b4) brk4++; mae4.add(mae); mfe4.add(mfe);
                for (int x = 0; x < tpsl.length; x++) {
                    double r = race(s, e, g.dir, tpsl[x][0], tpsl[x][1], (int) tpsl[x][2]);
                    if (r >= tpsl[x][0]) tw[x]++; else if (r <= -tpsl[x][1]) tl[x]++; tn[x] += r - FEE;
                }
                hn++; for (int x = 0; x < hold.length; x++) hs[x] += g.dir * (s.c[e + hold[x]] / entry - 1) * 100;
                for (int x = 0; x < ks.length; x++) {
                    double lim = entry - g.dir * ks[x] * Math.abs(entry - g.stop);
                    for (int j = e + 1; j <= e + 30; j++) {
                        if (g.dir == 1 ? s.l[j] <= lim : s.h[j] >= lim) {
                            fill[x]++;
                            ret4[x] += g.dir * (s.c[j + 240] / lim - 1) * 100;
                            // race from the fill: 1 % / 1 % within 4 h (the fill bar itself is not checked again)
                            double tp = lim * (1 + g.dir * 0.01), sl = lim * (1 - g.dir * 0.01), out = 0; boolean done = false;
                            for (int q = j + 1; q <= j + 240 && !done; q++) {
                                if (g.dir == 1) { if (s.l[q] <= sl) { out = -1; done = true; } else if (s.h[q] >= tp) { out = 1; done = true; } }
                                else { if (s.h[q] >= sl) { out = -1; done = true; } else if (s.l[q] <= tp) { out = 1; done = true; } }
                            }
                            if (!done) out = g.dir * (s.c[j + 240] / lim - 1) * 100;
                            if (out >= 1) win[x]++; else if (out <= -1) loss[x]++; net[x] += out - FEE;
                            break;
                        }
                    }
                }
            }
        }
        double days = 0; for (Sym s : syms) days += s.n / 1440.0;
        System.out.println("=== " + name + "  (" + n + " signals)");
        System.out.println(row("  long  (flush lows)", longs, days));
        System.out.println(row("  short (blow-off highs)", shorts, days));
        System.out.printf("  signal candle's extreme broken: within 1h %.0f%%, within 4h %.0f%%%n", 100.0 * brk1 / n, 100.0 * brk4 / n);
        System.out.printf("  worst move against the entry within 4h: p25 %.2f  median %.2f  p75 %.2f  p90 %.2f | best move for: p25 %.2f median %.2f p75 %.2f%n",
            pct(mae4, .25), pct(mae4, .5), pct(mae4, .75), pct(mae4, .9), pct(mfe4, .25), pct(mfe4, .5), pct(mfe4, .75));
        StringBuilder sb = new StringBuilder("  hold and exit at the clock, mean % before fees:");
        for (int x = 0; x < hold.length; x++) sb.append(String.format("  %dm %+.3f", hold[x], hs[x] / hn));
        System.out.println(sb);
        for (int x = 0; x < tpsl.length; x++) System.out.printf("  TP %.1f / SL %.1f in %.0fm: win %2.0f%% loss %2.0f%% net %+.3f%%/trade%n", tpsl[x][0], tpsl[x][1], tpsl[x][2], 100.0 * tw[x] / n, 100.0 * tl[x] / n, tn[x] / n);
        for (int x = 0; x < ks.length; x++) if (fill[x] > 0) System.out.printf("  limit %.0f%% of the way back to the extreme (30m): filled %2.0f%%, 4h mean %+.3f, 1/1 win %2.0f%% loss %2.0f%% net %+.3f per fill, %+.3f per signal%n",
            ks[x] * 100, 100.0 * fill[x] / n, ret4[x] / fill[x], 100.0 * win[x] / fill[x], 100.0 * loss[x] / fill[x], net[x] / fill[x], net[x] / n);
    }

    public static void main(String[] args) throws Exception {
        String dir = args[0];
        String mode = args[1];
        List<Sym> syms = new ArrayList<>();
        for (int i = 2; i < args.length; i++) syms.add(load(dir, args[i]));
        LinkedHashMap<String, Rule> rules = new LinkedHashMap<>();
        if (mode.equals("deep")) {
            deep("exh15m 3x 0.8 w40 (default)", syms, (s, tf) -> exh(tf.get(15), 3, 0.8, 0.4, 20, 0, 0, 20));
            deep("exh15m 2x 0.8 w40", syms, (s, tf) -> exh(tf.get(15), 2, 0.8, 0.4, 20, 0, 0, 20));
            deep("exh3m 2x 1.2 w40 (fast)", syms, (s, tf) -> exh(tf.get(3), 2, 1.2, 0.4, 20, 0, 0, 20));
            deep("exh5m 3x 0.8 w50", syms, (s, tf) -> exh(tf.get(5), 3, 0.8, 0.5, 20, 0, 0, 20));
            return;
        }
        if (mode.equals("trend")) {
            // the trend-following rules of the other built-in profiles, judged in their own direction (follow)
            for (int m : new int[] { 15, 60 }) { final int mm = m;
                rules.put("brk" + m + "m 20 vol1.5 follow", (s, tf) -> brk(tf.get(mm), 20, 1.5));
                rules.put("brk" + m + "m 50 vol1.5 follow", (s, tf) -> brk(tf.get(mm), 50, 1.5));
                rules.put("bb" + m + "m 20,2 outside follow", (s, tf) -> flip(bb(tf.get(mm), 20, 2, 1)));
                rules.put("vol" + m + "m 4x b0.2 close follow", (s, tf) -> volClose(tf.get(mm), 4, 0.2, 20, false));
                rules.put("rsiDiv" + m + "m", (s, tf) -> div(tf.get(mm), 0, 3));
                rules.put("cvdDiv" + m + "m", (s, tf) -> div(tf.get(mm), 1, 3));
            }
            rules.put("vol5m 4x LIVE fade", (s, tf) -> volLive(s, tf.get(5), 4, 0.2, 20, true));
            rules.put("vol1m 10x LIVE fade", (s, tf) -> volLive(s, tf.get(1), 10, 0.3, 20, true));
        }
        if (mode.equals("pick")) {
            rules.put("exh15m 3x 0.8 w40 (default)", (s, tf) -> exh(tf.get(15), 3, 0.8, 0.4, 20, 0, 0, 20));
            rules.put("exh15m 2x 0.8 w40", (s, tf) -> exh(tf.get(15), 2, 0.8, 0.4, 20, 0, 0, 20));
            rules.put("exh3m 2x 1.2 w40 (fast)", (s, tf) -> exh(tf.get(3), 2, 1.2, 0.4, 20, 0, 0, 20));
            rules.put("exh3m 2x 1.2 w50", (s, tf) -> exh(tf.get(3), 2, 1.2, 0.5, 20, 0, 0, 20));
            rules.put("exh3m 2x 1.0 w40", (s, tf) -> exh(tf.get(3), 2, 1.0, 0.4, 20, 0, 0, 20));
            rules.put("exh3m 2x 1.5 w40", (s, tf) -> exh(tf.get(3), 2, 1.5, 0.4, 20, 0, 0, 20));
            rules.put("exh5m 3x 0.8 w50", (s, tf) -> exh(tf.get(5), 3, 0.8, 0.5, 20, 0, 0, 20));
            rules.put("exh5m 2x 1.0 w50", (s, tf) -> exh(tf.get(5), 2, 1.0, 0.5, 20, 0, 0, 20));
            rules.put("vol5m 4x b0.2 LIVE fade", (s, tf) -> volLive(s, tf.get(5), 4, 0.2, 20, true));
            rules.put("vol5m 4x b0.2 LIVE follow", (s, tf) -> volLive(s, tf.get(5), 4, 0.2, 20, false));
            rules.put("vol1m 10x b0.3 LIVE follow", (s, tf) -> volLive(s, tf.get(1), 10, 0.3, 20, false));
            rules.put("vol15m 4x b0.2 LIVE follow", (s, tf) -> volLive(s, tf.get(15), 4, 0.2, 20, false));
        } else if (mode.equals("base")) {
            rules.put("exh15m 3x 0.8 w40 (default)", (s, tf) -> exh(tf.get(15), 3, 0.8, 0.4, 20, 0, 0, 20));
            rules.put("vol5m 4x b0.2 LIVE fade", (s, tf) -> volLive(s, tf.get(5), 4, 0.2, 20, true));
            rules.put("vol5m 4x b0.2 close fade", (s, tf) -> volClose(tf.get(5), 4, 0.2, 20, true));
            rules.put("vol1m 10x b0.3 LIVE fade", (s, tf) -> volLive(s, tf.get(1), 10, 0.3, 20, true));
            rules.put("vol15m 4x b0.2 LIVE fade", (s, tf) -> volLive(s, tf.get(15), 4, 0.2, 20, true));
            rules.put("vol15m 3x b0.2 LIVE fade", (s, tf) -> volLive(s, tf.get(15), 3, 0.2, 20, true));
            rules.put("vol15m 4x b0.2 close fade", (s, tf) -> volClose(tf.get(15), 4, 0.2, 20, true));
            rules.put("vol15m 5x b0.5 close fade", (s, tf) -> volClose(tf.get(15), 5, 0.5, 20, true));
            rules.put("vol1h 3x b0.2 close fade", (s, tf) -> volClose(tf.get(60), 3, 0.2, 20, true));
            for (int m : new int[] { 5, 15, 60 }) {
                final int mm = m;
                rules.put("rsiDiv " + m + "m r3", (s, tf) -> div(tf.get(mm), 0, 3));
                rules.put("cvdDiv " + m + "m r3", (s, tf) -> div(tf.get(mm), 1, 3));
                rules.put("bb " + m + "m 20,2 outside fade", (s, tf) -> bb(tf.get(mm), 20, 2, 1));
                rules.put("bb " + m + "m 20,2 re-entry", (s, tf) -> bb(tf.get(mm), 20, 2, 0));
                rules.put("bb " + m + "m 20,3 outside fade", (s, tf) -> bb(tf.get(mm), 20, 3, 1));
                rules.put("rsi " + m + "m x30/70 re-entry", (s, tf) -> rsiCross(tf.get(mm), 14, 30, 0));
                rules.put("rsi " + m + "m x30/70 knife", (s, tf) -> rsiCross(tf.get(mm), 14, 30, 1));
                rules.put("rsi " + m + "m x20/80 re-entry", (s, tf) -> rsiCross(tf.get(mm), 14, 20, 0));
                rules.put("rsi " + m + "m x20/80 knife", (s, tf) -> rsiCross(tf.get(mm), 14, 20, 1));
            }
        } else if (mode.equals("exh")) {
            for (int m : new int[] { 1, 3, 5, 15, 30, 60 }) for (double mult : new double[] { 2, 3, 4, 6 }) for (double rg : new double[] { 0.3, 0.5, 0.8, 1.2 }) for (double w : new double[] { 0.3, 0.4, 0.5, 0.6 }) {
                final int mm = m; final double a = mult, b = rg, c = w;
                rules.put(String.format("exh%dm %.0fx %.1f w%.0f", m, mult, rg, w * 100), (s, tf) -> exh(tf.get(mm), a, b, c, 20, 0, 0, 20));
            }
        } else if (mode.equals("exhx")) {
            for (int m : new int[] { 5, 15 }) {
                final int mm = m; double rg = m == 5 ? 0.5 : 0.8;
                for (double mult : new double[] { 3, 4 }) {
                    final double a = mult, b = rg;
                    rules.put(String.format("exh%dm %.0fx %.1f w40", m, mult, rg), (s, tf) -> exh(tf.get(mm), a, b, 0.4, 20, 0, 0, 20));
                    rules.put(String.format("exh%dm %.0fx %.1f w40 rsi<30", m, mult, rg), (s, tf) -> exh(tf.get(mm), a, b, 0.4, 20, 30, 0, 20));
                    rules.put(String.format("exh%dm %.0fx %.1f w40 rsi<25", m, mult, rg), (s, tf) -> exh(tf.get(mm), a, b, 0.4, 20, 25, 0, 20));
                    for (double dp : new double[] { 1.5, 2, 3 }) { final double d = dp;
                        rules.put(String.format("exh%dm %.0fx %.1f w40 drop%.1f/20", m, mult, rg, dp), (s, tf) -> exh(tf.get(mm), a, b, 0.4, 20, 0, d, 20)); }
                    rules.put(String.format("exh%dm %.0fx %.1f w40 len50", m, mult, rg), (s, tf) -> exh(tf.get(mm), a, b, 0.4, 50, 0, 0, 20));
                    rules.put(String.format("exh%dm %.0fx %.1f w40 len100", m, mult, rg), (s, tf) -> exh(tf.get(mm), a, b, 0.4, 100, 0, 0, 20));
                }
                for (double mult : new double[] { 2, 3 }) { final double a = mult;
                    rules.put(String.format("sweep%dm %.0fx len20", m, mult), (s, tf) -> sweep(tf.get(mm), a, 20, rg));
                    rules.put(String.format("sweep%dm %.0fx len50", m, mult), (s, tf) -> sweep(tf.get(mm), a, 50, rg)); }
            }
        }
        int[] tfs = { 1, 3, 5, 15, 30, 60 };
        // per rule: pooled, per symbol, and by thirds of the period (the last third is the out-of-sample part)
        LinkedHashMap<String, Acc> pooled = new LinkedHashMap<>(), early = new LinkedHashMap<>(), late = new LinkedHashMap<>();
        LinkedHashMap<String, LinkedHashMap<String, Acc>> per = new LinkedHashMap<>();
        double days = 0, daysAll = 0;
        for (Sym s : syms) {
            Map<Integer, Tf> tf = new HashMap<>();
            for (int m : tfs) tf.put(m, agg(s, m));
            days = s.n / 1440.0; daysAll += days;
            int cut = s.n * 2 / 3;
            for (Map.Entry<String, Rule> r : rules.entrySet()) {
                List<Sig> sg = r.getValue().run(s, tf);
                Acc all = pooled.computeIfAbsent(r.getKey(), k -> new Acc()), ea = early.computeIfAbsent(r.getKey(), k -> new Acc()), la = late.computeIfAbsent(r.getKey(), k -> new Acc());
                Acc mine = per.computeIfAbsent(r.getKey(), k -> new LinkedHashMap<>()).computeIfAbsent(s.name, k -> new Acc());
                for (Sig g : sg) { eval(s, g, all); eval(s, g, mine); eval(s, g, g.e < cut ? ea : la); }
            }
        }
        System.out.println("columns: mean fade return % after 5m 15m 1h 4h (t-stat) | A = 0.5%/0.5% within 1h win/loss, net of " + FEE + "% fees | B = 1%/1% within 4h | median 1h adverse / favourable move, minutes to the worst point | R = stop past the candle's extreme, target 1.5R");
        boolean detail = mode.equals("base") || mode.equals("exhx") || mode.equals("pick");
        for (String k : rules.keySet()) {
            System.out.println(row(k, pooled.get(k), daysAll / syms.size() * 1.0 * syms.size()));
            if (detail) {
                System.out.println(row("   first 2/3", early.get(k), daysAll * 2 / 3));
                System.out.println(row("   last 1/3 (OOS)", late.get(k), daysAll / 3));
                for (Map.Entry<String, Acc> e : per.get(k).entrySet()) System.out.println(row("   " + e.getKey(), e.getValue(), days));
            }
        }
    }
}
