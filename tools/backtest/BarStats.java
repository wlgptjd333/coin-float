import java.nio.file.*;
import java.util.*;

/**
 * Checks the delta rows of the bar stats pane ("봉 통계") for counter-trend use, on the 1m CSVs in data/
 * (open time, o, h, l, c, volume, taker buy volume). Trade counts, liquidations and open interest have no
 * history long enough here, so only delta and volume are tested.
 *
 * Bars of 5m / 15m / 1h are built from the 1m bars. For every bar that makes a new 20-bar low (or high), the move
 * 1 h and 4 h later is measured in the counter-trend direction (up after a low, down after a high), against:
 *  - all bars (no condition), and
 *  - all new-low / new-high bars (the plain "it made a new low" condition).
 * The conditions add what the bar stats pane shows: a big delta (a top or bottom decile of delta % for that coin and
 * interval), a big volume (2x the last 20 bars), the wick back (close in the far half of the range) and "the new low
 * came with weaker selling than the last new low" (delta divergence).
 * Percentile cut-offs are taken over the whole sample per coin and interval. No fees.
 *
 * java BarStats.java data BTCUSDT ETHUSDT ...
 */
public class BarStats {
    static final String[] TF = { "5m", "15m", "1h" };
    static final int[] TF_MIN = { 5, 15, 60 };
    static final int N = 20;

    static class Bars { double[] o, h, l, c, v, b; int n; }

    static Bars build(long[] t, double[] o, double[] h, double[] l, double[] c, double[] v, double[] b, int min) {
        long ms = min * 60000L;
        ArrayList<double[]> out = new ArrayList<>();
        double[] cur = null; long key = Long.MIN_VALUE; int cnt = 0;
        for (int i = 0; i < t.length; i++) {
            long k = t[i] / ms;
            if (k != key) {
                if (cur != null && cnt == min) out.add(cur);
                cur = new double[] { o[i], h[i], l[i], c[i], v[i], b[i] }; key = k; cnt = 1;
            } else {
                cur[1] = Math.max(cur[1], h[i]); cur[2] = Math.min(cur[2], l[i]); cur[3] = c[i]; cur[4] += v[i]; cur[5] += b[i]; cnt++;
            }
        }
        if (cur != null && cnt == min) out.add(cur);
        Bars r = new Bars(); r.n = out.size();
        r.o = new double[r.n]; r.h = new double[r.n]; r.l = new double[r.n]; r.c = new double[r.n]; r.v = new double[r.n]; r.b = new double[r.n];
        for (int i = 0; i < r.n; i++) { double[] x = out.get(i); r.o[i] = x[0]; r.h[i] = x[1]; r.l[i] = x[2]; r.c[i] = x[3]; r.v[i] = x[4]; r.b[i] = x[5]; }
        return r;
    }

    // one row of results: count, sum of moves, wins (move > 0), per horizon; and the same for each half of the period
    static class Acc {
        long[] n = new long[2]; double[] sum = new double[2]; long[] win = new long[2];
        long[][] hn = new long[2][2]; double[][] hsum = new double[2][2]; long[][] hwin = new long[2][2];
        void add(int hz, double r, boolean second) {
            n[hz]++; sum[hz] += r; if (r > 0) win[hz]++;
            int s = second ? 1 : 0; hn[s][hz]++; hsum[s][hz] += r; if (r > 0) hwin[s][hz]++;
        }
    }

    static double pct(double[] a, double q) { double[] s = a.clone(); Arrays.sort(s); return s[(int) Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; }

    public static void main(String[] args) throws Exception {
        String dir = args[0];
        String[] names = { "all bars", "new 20-bar extreme", "+ big delta (decile) with the move", "+ big delta + volume 2x",
            "+ big delta + volume 2x + wick back", "+ delta against the move (absorption)", "+ weaker delta than the last extreme (divergence)",
            "+ big delta + volume 2x, the NEXT bar's delta flips" };
        for (int tf = 0; tf < TF.length; tf++) {
            int hz1 = 60 / TF_MIN[tf], hz4 = 240 / TF_MIN[tf];
            Acc[][] acc = new Acc[2][names.length];            // [0] after lows (long), [1] after highs (short)
            for (int s = 0; s < 2; s++) for (int k = 0; k < names.length; k++) acc[s][k] = new Acc();
            for (int a = 1; a < args.length; a++) {
                List<String> rows = Files.readAllLines(Paths.get(dir, args[a] + "_1m.csv"));
                int m = rows.size();
                long[] t = new long[m]; double[] o = new double[m], h = new double[m], l = new double[m], c = new double[m], v = new double[m], b = new double[m];
                for (int i = 0; i < m; i++) {
                    String[] f = rows.get(i).split(",");
                    t[i] = Long.parseLong(f[0]); o[i] = Double.parseDouble(f[1]); h[i] = Double.parseDouble(f[2]); l[i] = Double.parseDouble(f[3]);
                    c[i] = Double.parseDouble(f[4]); v[i] = Double.parseDouble(f[5]); b[i] = Double.parseDouble(f[6]);
                }
                Bars x = build(t, o, h, l, c, v, b, TF_MIN[tf]);
                double[] dp = new double[x.n];
                for (int i = 0; i < x.n; i++) dp[i] = x.v[i] > 0 ? (2 * x.b[i] - x.v[i]) / x.v[i] : 0;
                double lo10 = pct(dp, 0.10), hi10 = pct(dp, 0.90);
                int lastLow = -1, lastHigh = -1;
                for (int i = N; i + hz4 < x.n - 1; i++) {
                    boolean second = i > x.n / 2;
                    double vAvg = 0; for (int j = i - N; j < i; j++) vAvg += x.v[j]; vAvg /= N;
                    double vr = vAvg > 0 ? x.v[i] / vAvg : 0;
                    double minL = Double.MAX_VALUE, maxH = -Double.MAX_VALUE;
                    for (int j = i - N; j < i; j++) { minL = Math.min(minL, x.l[j]); maxH = Math.max(maxH, x.h[j]); }
                    double rng = x.h[i] - x.l[i], pos = rng > 0 ? (x.c[i] - x.l[i]) / rng : 0.5;
                    double r1 = x.c[i + hz1] / x.c[i] - 1, r4 = x.c[i + hz4] / x.c[i] - 1;
                    for (int s = 0; s < 2; s++) {
                        double sg = s == 0 ? 1 : -1;
                        boolean ext = s == 0 ? x.l[i] < minL : x.h[i] > maxH;
                        boolean bigWith = s == 0 ? dp[i] <= lo10 : dp[i] >= hi10;       // heavy selling into a low / buying into a high
                        boolean against = s == 0 ? dp[i] > 0 : dp[i] < 0;
                        boolean wick = s == 0 ? pos >= 0.5 : pos <= 0.5;
                        int prev = s == 0 ? lastLow : lastHigh;
                        boolean div = prev >= 0 && i - prev <= 3 * N && (s == 0 ? dp[i] > dp[prev] + 0.10 : dp[i] < dp[prev] - 0.10) && (s == 0 ? dp[prev] < 0 : dp[prev] > 0);
                        boolean flip = s == 0 ? dp[i + 1] > 0 : dp[i + 1] < 0;
                        boolean[] on = { true, ext, ext && bigWith, ext && bigWith && vr >= 2, ext && bigWith && vr >= 2 && wick, ext && against, ext && div, ext && bigWith && vr >= 2 && flip };
                        for (int k = 0; k < on.length; k++) {
                            if (!on[k]) continue;
                            // the "next bar flips" row can only be known one bar later: measure from that bar's close
                            int e = k == 7 ? i + 1 : i;
                            double q1 = k == 7 ? x.c[e + hz1] / x.c[e] - 1 : r1, q4 = k == 7 ? x.c[Math.min(x.n - 1, e + hz4)] / x.c[e] - 1 : r4;
                            acc[s][k].add(0, sg * q1 * 100, second); acc[s][k].add(1, sg * q4 * 100, second);
                        }
                        if (ext) { if (s == 0) lastLow = i; else lastHigh = i; }
                    }
                }
            }
            System.out.println("=== " + TF[tf] + " bars, 10 coins (move in the counter-trend direction, %, no fees) ===");
            for (int s = 0; s < 2; s++) {
                System.out.println(s == 0 ? "-- after a low (buy side)" : "-- after a high (sell side)");
                System.out.printf("  %-52s %7s | %8s %6s | %8s %6s | 4h win 1st/2nd half%n", "", "n", "1h avg", "1h win", "4h avg", "4h win");
                for (int k = 0; k < names.length; k++) {
                    Acc q = acc[s][k];
                    if (q.n[0] == 0) continue;
                    System.out.printf("  %-52s %7d | %+8.3f %5.1f%% | %+8.3f %5.1f%% | %5.1f%% / %5.1f%%%n", names[k], q.n[0],
                        q.sum[0] / q.n[0], 100.0 * q.win[0] / q.n[0], q.sum[1] / q.n[1], 100.0 * q.win[1] / q.n[1],
                        q.hn[0][1] > 0 ? 100.0 * q.hwin[0][1] / q.hn[0][1] : 0, q.hn[1][1] > 0 ? 100.0 * q.hwin[1][1] / q.hn[1][1] : 0);
                }
            }
            System.out.println();
        }
    }
}
