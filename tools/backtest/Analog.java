import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.*;
import java.util.stream.*;

/**
 * Pattern-scan backtest: "find the past stretches that look most like the last L candles and draw what came after them".
 * At evenly spaced points in the last EVAL_DAYS, the last L closes of one coin on one interval are compared with every
 * earlier stretch of L closes (correlation of log prices, i.e. same shape whatever the level and size), the K most alike
 * that ended at least H bars before the query are taken, and their next H bars are compared with what really followed.
 *
 * Pools (where the look-alikes may come from):
 *   same   - this coin, this interval (what CoinFloat's 닮은 흐름 does today)
 *   tf     - this coin, every interval 1m 5m 15m 1h 4h
 *   all    - every coin in the data, every interval
 *
 * Only data before the query is ever used: a match's H following bars must have closed before the query candle closed.
 * Output: hit rate of the median direction against "always the more common side" and against momentum / its reverse,
 * the correlation of predicted and real move, how often the real move landed inside the matches' middle half and full
 * range, and the rate when the matches agree (>= 70 % one way).
 *
 * java -Xmx3g Analog.java data BTCUSDT ETHUSDT ...      (1m CSVs from Fetch.java)
 */
public class Analog {
    static final String[] TF_NAMES = { "1m", "5m", "15m", "1h", "4h" };
    static final int[] TF_MIN = { 1, 5, 15, 60, 240 };
    static int L = Integer.getInteger("L", 40), H = Integer.getInteger("H", 30), EVAL_DAYS = 90, PER = 500;
    static boolean CLAMP = !"0".equals(System.getProperty("clamp"));

    static class Series {
        String coin; int tf; long barMs; long[] t; double[] p, s1, s2, r1, r2;   // log close, prefix sums of it and its square, of 1-bar returns and squares
        double sd(int e) {                                   // sd of the window of L log closes ending at e
            double m = (s1[e + 1] - s1[e + 1 - L]) / L, v = (s2[e + 1] - s2[e + 1 - L]) / L - m * m;
            return v > 0 ? Math.sqrt(v) : 0;
        }
        double retSd(int e) {                                 // sd of the L-1 one-bar returns inside the window
            int a = e - L + 2, n = L - 1; if (a < 1) return 0;
            double m = (r1[e + 1] - r1[a]) / n, v = (r2[e + 1] - r2[a]) / n - m * m;
            return v > 0 ? Math.sqrt(v) : 0;
        }
        int lastClosedBefore(long tMs) {                     // last index whose bar closed at or before tMs
            int lo = 0, hi = t.length - 1, best = -1;
            while (lo <= hi) { int m = (lo + hi) >>> 1; if (t[m] + barMs <= tMs) { best = m; lo = m + 1; } else hi = m - 1; }
            return best;
        }
    }

    static Series build(String coin, int tfIdx, long[] t1, double[] c1) {
        int min = TF_MIN[tfIdx]; long ms = min * 60000L;
        ArrayList<Long> tt = new ArrayList<>(); ArrayList<Double> cc = new ArrayList<>();
        long cur = Long.MIN_VALUE; int cnt = 0;
        for (int i = 0; i < t1.length; i++) {
            long b = Math.floorDiv(t1[i], ms) * ms;
            if (b != cur) {
                if (cur != Long.MIN_VALUE && cnt == min) { tt.add(cur); cc.add(c1[i - 1]); }   // only complete bars
                cur = b; cnt = 0;
            }
            cnt++;
        }
        Series s = new Series(); s.coin = coin; s.tf = tfIdx; s.barMs = ms;
        int n = tt.size(); s.t = new long[n]; s.p = new double[n];
        for (int i = 0; i < n; i++) { s.t[i] = tt.get(i); s.p[i] = Math.log(cc.get(i)); }
        s.s1 = new double[n + 1]; s.s2 = new double[n + 1]; s.r1 = new double[n + 1]; s.r2 = new double[n + 1];
        for (int i = 0; i < n; i++) {
            s.s1[i + 1] = s.s1[i] + s.p[i]; s.s2[i + 1] = s.s2[i] + s.p[i] * s.p[i];
            double r = i > 0 ? s.p[i] - s.p[i - 1] : 0;
            s.r1[i + 1] = s.r1[i] + r; s.r2[i + 1] = s.r2[i] + r * r;
        }
        return s;
    }

    static class Cand { Series s; int e; double r; Cand(Series s, int e, double r) { this.s = s; this.e = e; this.r = r; } }

    static class Res {
        double real, med, q25, q75, lo, hi, upFrac, meanR, mom;
    }

    /** One query: the L closes of q ending at qe; pool series; up to K matches, most alike first. */
    static List<Cand> query(Series q, int qe, List<Series> pool, int K) {
        double sdq = q.sd(qe); if (sdq <= 1e-9) return null;
        double mq = (q.s1[qe + 1] - q.s1[qe + 1 - L]) / L, norm = sdq * Math.sqrt(L);
        double[] qn = new double[L];
        for (int i = 0; i < L; i++) qn[i] = (q.p[qe - L + 1 + i] - mq) / norm;
        long qClose = q.t[qe] + q.barMs;
        // one candidate per block of L windows per series (the block's best), then a greedy pick that keeps matches apart
        PriorityQueue<Cand> heap = new PriorityQueue<>((a, b) -> Double.compare(a.r, b.r));
        int keep = K * 6;
        for (Series s : pool) {
            int last = s.lastClosedBefore(qClose) - H;        // the match's H following bars must be closed already
            if (last < L - 1) continue;
            double sq = Math.sqrt(L);
            for (int b0 = L - 1; b0 <= last; b0 += L) {
                int b1 = Math.min(last, b0 + L - 1), bestE = -1; double best = -2;
                for (int e = b0; e <= b1; e++) {
                    double sd = s.sd(e); if (sd <= 1e-9) continue;
                    double dot = 0; int a = e - L + 1;
                    for (int i = 0; i < L; i++) dot += qn[i] * s.p[a + i];
                    double r = dot / (sd * sq);
                    if (r > best) { best = r; bestE = e; }
                }
                if (bestE < 0) continue;
                if (heap.size() < keep) heap.add(new Cand(s, bestE, best));
                else if (best > heap.peek().r) { heap.poll(); heap.add(new Cand(s, bestE, best)); }
            }
        }
        ArrayList<Cand> all = new ArrayList<>(heap);
        all.sort((a, b) -> Double.compare(b.r, a.r));
        ArrayList<Cand> pick = new ArrayList<>();
        for (Cand c : all) {
            boolean ok = true;
            for (Cand p : pick) if (p.s == c.s && Math.abs(p.e - c.e) < L) { ok = false; break; }
            if (ok) pick.add(c);
            if (pick.size() == K) break;
        }
        return pick;
    }

    /** What the first K picks say about the query, and what really happened. */
    static Res judge(Series q, int qe, List<Cand> all, int K) {
        if (all == null || all.size() < Math.min(K, 5)) return null;
        List<Cand> pick = all.subList(0, Math.min(K, all.size()));
        double vq = q.retSd(qe);
        double[] mv = new double[pick.size()]; int up = 0; double sumR = 0;
        for (int i = 0; i < pick.size(); i++) {
            Cand c = pick.get(i);
            // to today's size: the match's move times (today's bar-to-bar sd / the match's), clamped like the app or not
            double vc = c.s.retSd(c.e), k = vc > 0 ? (CLAMP ? Math.max(0.5, Math.min(2, vq / vc)) : vq / vc) : 1;
            mv[i] = (c.s.p[c.e + H] - c.s.p[c.e]) * k;
            if (mv[i] > 0) up++;
            sumR += c.r;
        }
        Arrays.sort(mv);
        Res r = new Res();
        r.med = quant(mv, 0.5); r.q25 = quant(mv, 0.25); r.q75 = quant(mv, 0.75); r.lo = mv[0]; r.hi = mv[mv.length - 1];
        r.upFrac = up / (double) mv.length; r.meanR = sumR / mv.length;
        r.real = q.p[qe + H] - q.p[qe];
        r.mom = q.p[qe] - q.p[qe - L + 1];
        return r;
    }

    static double quant(double[] s, double f) {
        double x = f * (s.length - 1); int i = (int) Math.floor(x); double d = x - i;
        return i + 1 < s.length ? s[i] * (1 - d) + s[i + 1] * d : s[i];
    }

    public static void main(String[] a) throws Exception {
        String dir = a[0];
        List<String> coins = Arrays.asList(a).subList(1, a.length);
        Map<String, Series[]> data = new LinkedHashMap<>();
        for (String coin : coins) {
            List<String> rows = Files.readAllLines(Paths.get(dir, coin + "_1m.csv"));
            long[] t = new long[rows.size()]; double[] c = new double[rows.size()];
            for (int i = 0; i < rows.size(); i++) { String[] f = rows.get(i).split(","); t[i] = Long.parseLong(f[0]); c[i] = Double.parseDouble(f[4]); }
            Series[] ss = new Series[TF_NAMES.length];
            for (int k = 0; k < ss.length; k++) ss[k] = build(coin, k, t, c);
            data.put(coin, ss);
            System.out.println(coin + " " + rows.size() + " 1m bars, " + new java.text.SimpleDateFormat("yyyy-MM-dd").format(new Date(t[0])) + " .. " + new java.text.SimpleDateFormat("yyyy-MM-dd").format(new Date(t[t.length - 1])));
        }
        List<Series> everything = data.values().stream().flatMap(Arrays::stream).collect(Collectors.toList());
        System.out.println("L=" + L + " H=" + H + " eval last " + EVAL_DAYS + " days, up to " + PER + " points per coin and interval");
        System.out.println();
        int[] qTfs = { 1, 2, 3 };                              // ask on 5m, 15m, 1h
        String[] pools = a.length > 0 && System.getProperty("pools") != null ? System.getProperty("pools").split(",") : new String[] { "same", "tf", "all" };
        for (String pool : pools) {
            for (int qt : qTfs) run(data, everything, pool, qt);
            System.out.println();
        }
    }

    static void run(Map<String, Series[]> data, List<Series> everything, String pool, int qt) {
        long t0 = System.currentTimeMillis();
        ArrayList<Object[]> jobs = new ArrayList<>();
        for (Map.Entry<String, Series[]> en : data.entrySet()) {
            Series q = en.getValue()[qt];
            long end = q.t[q.t.length - 1], start = end - EVAL_DAYS * 86400000L;
            int i0 = Math.max(L * 3, q.lastClosedBefore(start)), i1 = q.t.length - 1 - H;
            if (i1 <= i0) continue;
            int step = Math.max(1, (i1 - i0) / PER);
            List<Series> pl = pool.equals("same") ? List.of(q) : pool.equals("tf") ? Arrays.asList(en.getValue()) : everything;
            for (int qe = i0; qe <= i1; qe += step) jobs.add(new Object[] { q, qe, pl });
        }
        @SuppressWarnings("unchecked")
        List<Object[]> done = jobs.parallelStream().map(j -> new Object[] { j[0], j[1], query((Series) j[0], (Integer) j[1], (List<Series>) j[2], 30) })
            .collect(Collectors.toList());
        for (int K : new int[] { 10, 30 }) {
            List<Res> rs = new ArrayList<>(), early = new ArrayList<>(), late = new ArrayList<>();
            for (Object[] d : done) {
                @SuppressWarnings("unchecked") Res r = judge((Series) d[0], (Integer) d[1], (List<Cand>) d[2], K);
                if (r == null) continue;
                rs.add(r);
                Series q = (Series) d[0];
                (q.t[(Integer) d[1]] < q.t[q.t.length - 1] - EVAL_DAYS * 86400000L / 2 ? early : late).add(r);
            }
            report(pool + " K=" + K + " " + TF_NAMES[qt], rs);
            report("  first half", early);
            report("  second half", late);
        }
        System.out.println("  (" + (System.currentTimeMillis() - t0) / 1000 + " s)");
    }

    static void report(String name, List<Res> rs) {
        int n = 0, hit = 0, up = 0, momHit = 0, in50 = 0, inAll = 0, agreeN = 0, agreeHit = 0, simN = 0, simHit = 0;
        double sp = 0, sr = 0, spp = 0, srr = 0, spr = 0, maeP = 0, mae0 = 0;
        for (Res r : rs) {
            if (r.real == 0 || r.med == 0) continue;
            n++;
            boolean ru = r.real > 0;
            if (ru) up++;
            if ((r.med > 0) == ru) hit++;
            if (r.mom != 0 && (r.mom > 0) == ru) momHit++;
            if (r.real >= r.q25 && r.real <= r.q75) in50++;
            if (r.real >= r.lo && r.real <= r.hi) inAll++;
            if (r.upFrac >= 0.7 || r.upFrac <= 0.3) { agreeN++; if ((r.upFrac >= 0.7) == ru) agreeHit++; }
            if (r.meanR >= 0.95) { simN++; if ((r.med > 0) == ru) simHit++; }
            sp += r.med; sr += r.real; spp += r.med * r.med; srr += r.real * r.real; spr += r.med * r.real;
            maeP += Math.abs(r.real - r.med); mae0 += Math.abs(r.real);
        }
        if (n == 0) { System.out.println(name + ": no data"); return; }
        double cov = spr / n - (sp / n) * (sr / n), vp = spp / n - Math.pow(sp / n, 2), vr = srr / n - Math.pow(sr / n, 2);
        double corr = vp > 0 && vr > 0 ? cov / Math.sqrt(vp * vr) : 0;
        double base = Math.max(up, n - up) * 100.0 / n;
        System.out.printf(Locale.ROOT, "%-14s n=%5d  hit %5.1f%%  (majority %5.1f%%, momentum %5.1f%%, reverse %5.1f%%)  corr %+.3f  err/zero %.3f  in-middle-half %4.1f%%  in-range %4.1f%%  agree>=70%%: %4.1f%% of time, hit %5.1f%%  sim>=.95: n=%d hit %5.1f%%%n",
            name, n, hit * 100.0 / n, base, momHit * 100.0 / n, 100 - momHit * 100.0 / n, corr, maeP / mae0, in50 * 100.0 / n, inAll * 100.0 / n,
            agreeN * 100.0 / n, agreeN > 0 ? agreeHit * 100.0 / agreeN : 0, simN, simN > 0 ? simHit * 100.0 / simN : 0);
    }
}
