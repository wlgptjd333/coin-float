import com.sun.net.httpserver.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

/** Serves the chart page the way pages.yml assembles it, straight from the source folders (no copy step). */
public class Serve {
    public static void main(String[] a) throws Exception {
        Path assets = Paths.get(a[0]), web = Paths.get(a[1]);
        int port = Integer.parseInt(a[2]);
        HttpServer s = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        s.createContext("/", ex -> {
            try {
                String p = ex.getRequestURI().getPath();
                byte[] body; String type = "application/octet-stream";
                if (p.equals("/") || p.equals("/index.html")) {
                    String html = new String(Files.readAllBytes(assets.resolve("chart.html")), StandardCharsets.UTF_8)
                        .replace("<script src=\"chart.js\"></script>", "<script src=\"web.js\"></script>\n<script src=\"chart.js\"></script>");
                    body = html.getBytes(StandardCharsets.UTF_8); type = "text/html; charset=utf-8";
                } else {
                    String name = Paths.get(p.substring(1)).getFileName().toString();
                    Path f = Files.exists(web.resolve(name)) ? web.resolve(name) : assets.resolve(name);
                    if (!Files.isRegularFile(f)) { ex.sendResponseHeaders(404, -1); ex.close(); return; }
                    body = Files.readAllBytes(f);
                    if (name.endsWith(".js")) type = "text/javascript; charset=utf-8";
                    else if (name.endsWith(".html")) type = "text/html; charset=utf-8";
                    else if (name.endsWith(".txt")) type = "text/plain; charset=utf-8";
                    else if (name.endsWith(".svg")) type = "image/svg+xml";
                    else if (name.endsWith(".webmanifest")) type = "application/manifest+json";
                    else if (name.endsWith(".jpg")) type = "image/jpeg";
                }
                ex.getResponseHeaders().set("Content-Type", type);
                ex.getResponseHeaders().set("Cache-Control", "no-store");
                ex.sendResponseHeaders(200, body.length);
                ex.getResponseBody().write(body); ex.close();
            } catch (Exception e) { ex.sendResponseHeaders(500, -1); ex.close(); }
        });
        s.start();
        System.out.println("serving on http://localhost:" + port);
    }
}
