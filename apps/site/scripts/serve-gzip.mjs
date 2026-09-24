// Minimal static server with gzip, to measure performance the way nginx (gzip on) will serve it.
// node scripts/serve-gzip.mjs [port]   — serves out/ directly (read-only).
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createGzip } from "node:zlib";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "out");
const port = Number(process.argv[2] ?? 8150);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".mp4": "video/mp4" };
const TEXT = new Set([".html", ".js", ".css", ".json", ".txt", ".xml", ".svg"]);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let p = normalize(join(OUT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(OUT)) return res.writeHead(403).end();
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) {
    res.writeHead(404, { "content-type": TYPES[".html"] });
    return createReadStream(join(OUT, "404.html")).pipe(res);
  }
  const ext = extname(p);
  const headers = { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": p.includes("_next") ? "public, max-age=31536000, immutable" : "no-cache" };
  if (TEXT.has(ext) && /gzip/.test(String(req.headers["accept-encoding"] ?? ""))) {
    res.writeHead(200, { ...headers, "content-encoding": "gzip", vary: "accept-encoding" });
    createReadStream(p).pipe(createGzip()).pipe(res);
  } else {
    res.writeHead(200, { ...headers, "content-length": statSync(p).size });
    createReadStream(p).pipe(res);
  }
}).listen(port, "127.0.0.1", () => console.log(`gzip server for out/ at http://127.0.0.1:${port}/`));
