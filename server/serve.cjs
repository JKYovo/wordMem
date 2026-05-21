const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { loadLocalEnv } = require("./env.cjs");

loadLocalEnv();

const { handleAiExplain, sendJson } = require("./ai-proxy.cjs");
const { handleSyncApi } = require("./sync-api.cjs");

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const serverTimeoutMs = Number(process.env.WORDMEM_SERVER_TIMEOUT_MS || 600000);
const distDir = path.resolve(__dirname, "..", "dist");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (String(req.url || "").startsWith("/api/sync/")) {
    handleSyncApi(req, res);
    return;
  }

  if (req.method === "OPTIONS" && req.url === "/api/ai/explain") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "600",
    });
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/api/ai/explain") {
    handleAiExplain(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const normalized = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const requested = path.join(distDir, normalized === "/" ? "index.html" : normalized);

  if (!requested.startsWith(distDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.stat(requested, (error, stat) => {
    if (!error && stat.isFile()) {
      serveFile(res, requested);
      return;
    }
    serveFile(res, path.join(distDir, "index.html"));
  });
});

server.timeout = serverTimeoutMs;
server.keepAliveTimeout = serverTimeoutMs;
server.headersTimeout = serverTimeoutMs + 5000;

server.listen(port, host, () => {
  console.log(`[wordmem] listening on http://${host}:${port}`);
  if (process.env.WORDMEM_PRINT_MOBILE_URLS === "1") {
    const localHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    const mobileCandidates = Object.values(os.networkInterfaces())
      .flat()
      .filter(Boolean)
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => address.address);
    const tailscaleAddress =
      mobileCandidates.find((address) => address.startsWith("100.")) ||
      mobileCandidates[0];

    console.log(`[wordmem] desktop mobile preview: http://${localHost}:${port}/?mobilePreview=1`);
    if (tailscaleAddress) {
      console.log(`[wordmem] phone via network/Tailscale: http://${tailscaleAddress}:${port}/`);
    }
  }
});
