import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { runLcRecheck, startLcRecheckScheduler } from "./server/lcRecheck.js";
import { runXFeedSync, startXFeedScheduler } from "./server/xFeedSync.js";

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

  // Proxy /api/openstates-graphql → https://openstates.org/graphql
  if (pathname === "/api/openstates-graphql") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const proxyReq = httpsRequest(
        "https://openstates.org/graphql",
        {
          method: req.method,
          headers: {
            ...req.headers,
            host: "openstates.org",
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on("error", (err) => {
        console.error("Proxy error:", err.message);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bad Gateway" }));
      });
      proxyReq.end(body);
    });
    return;
  }

  // Manual / external trigger for the LC-number background scan.
  //   POST /api/lc-recheck            → run (default 90s budget), return summary
  //   POST /api/lc-recheck?budget=0   → run unbounded (full backfill)
  // Protected by the x-recheck-secret header when LC_RECHECK_SECRET is set.
  if (pathname === "/api/lc-recheck") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }
    const expected = process.env.LC_RECHECK_SECRET;
    if (expected && req.headers["x-recheck-secret"] !== expected) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    const budgetParam = url.searchParams.get("budget");
    const budgetMs = budgetParam != null ? Number(budgetParam) : 90_000;
    runLcRecheck({ budgetMs: Number.isFinite(budgetMs) ? budgetMs : 90_000 })
      .then((summary) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
      })
      .catch((err) => {
        console.error("[lc-recheck] HTTP run failed:", err.message);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // Manual / external trigger for the official X early-alert collector.
  // Protected by x-x-sync-secret when X_SYNC_SECRET is configured.
  if (pathname === "/api/x-feed-sync") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }
    const expected = process.env.X_SYNC_SECRET;
    if (expected && req.headers["x-x-sync-secret"] !== expected) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    runXFeedSync()
      .then((summary) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
      })
      .catch((error) => {
        console.error("[x-feed] HTTP run failed:", error.message);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      });
    return;
  }

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
  startLcRecheckScheduler();
  startXFeedScheduler();
});
