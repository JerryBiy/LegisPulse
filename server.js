import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(__dirname, "dist");
const PORT = process.env.PORT || 4000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

// Simple in-memory cache for frequently accessed files
const cache = new Map();
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50 MB cache limit
let cacheSize = 0;

function serveFile(filePath, res) {
  // Check cache first
  if (cache.has(filePath)) {
    const { data, mime } = cache.get(filePath);
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": data.length,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    res.end(data);
    return true;
  }

  if (!existsSync(filePath)) return false;

  const stat = statSync(filePath);
  if (!stat.isFile()) return false;

  const data = readFileSync(filePath);
  const ext = extname(filePath);
  const mime = MIME[ext] || "application/octet-stream";

  // Cache assets (not index.html — it must always be fresh for SPA routing)
  const isAsset = !filePath.endsWith("index.html");
  if (
    isAsset &&
    stat.size < 2 * 1024 * 1024 &&
    cacheSize + stat.size < MAX_CACHE_SIZE
  ) {
    cache.set(filePath, { data, mime });
    cacheSize += stat.size;
  }

  // Hashed assets get long cache; index.html gets no-cache for SPA freshness
  const cacheControl = isAsset
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": data.length,
    "Cache-Control": cacheControl,
  });
  res.end(data);
  return true;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);

  // Try exact path first
  const filePath = join(DIST, pathname);
  if (serveFile(filePath, res)) return;

  // SPA fallback: serve index.html for any non-file route
  const indexPath = join(DIST, "index.html");
  if (serveFile(indexPath, res)) return;

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Static server running on port ${PORT}`);
});
