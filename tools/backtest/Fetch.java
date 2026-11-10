import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.util.*;

/** Downloads Binance USD-M futures 1m candles (public market data) into CSV: t,o,h,l,c,v,takerBuy. */
public class Fetch {
    public static void main(String[] a) throws Exception {
        String dir = a[0];
        int days = Integer.parseInt(a[1]);
        HttpClient http = HttpClient.newHttpClient();
        long now = System.currentTimeMillis() / 60000 * 60000;
        long start = now - days * 86400000L;
        for (int s = 2; s < a.length; s++) {
            String sym = a[s];
            Path out = Paths.get(dir, sym + "_1m.csv");
            if (Files.exists(out) && Files.size(out) > 1000000) { System.out.println(sym + " cached"); continue; }
            ArrayList<String> rows = new ArrayList<>();
            long from = start;
            while (from < now) {
                String url = "https://fapi.binance.com/fapi/v1/klines?symbol=" + sym + "&interval=1m&limit=1500&startTime=" + from;
                HttpResponse<String> r = null;
                for (int attempt = 0; attempt < 5; attempt++) {
                    try {
                        r = http.send(HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofString());
                        if (r.statusCode() == 200) break;
                        System.out.println(sym + " HTTP " + r.statusCode() + " " + r.body());
                        if (r.statusCode() == 400) { r = null; break; }
                    } catch (IOException e) { System.out.println("retry " + e.getMessage()); }
                    Thread.sleep(5000L * (attempt + 1));
                }
                if (r == null || r.statusCode() != 200) { System.out.println(sym + " failed"); break; }
                String used = r.headers().firstValue("x-mbx-used-weight-1m").orElse("0");
                if (Integer.parseInt(used) > 1700) Thread.sleep(20000);
                String body = r.body();
                // [[t,"o","h","l","c","v",closeT,"q",n,"takerBase","takerQuote","0"],...]
                String[] parts = body.substring(1, body.length() - 1).split("\\],\\[");
                long last = -1;
                int n = 0;
                for (String p : parts) {
                    p = p.replace("[", "").replace("]", "").replace("\"", "");
                    if (p.isEmpty()) continue;
                    String[] f = p.split(",");
                    long t = Long.parseLong(f[0]);
                    if (t >= now) continue;
                    rows.add(f[0] + "," + f[1] + "," + f[2] + "," + f[3] + "," + f[4] + "," + f[5] + "," + f[9]);
                    last = t; n++;
                }
                if (n == 0) { from += 1500L * 60000; continue; }
                from = last + 60000;
                Thread.sleep(250);
            }
            Files.write(out, rows);
            System.out.println(sym + " " + rows.size() + " rows");
        }
    }
}
