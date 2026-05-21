const http = require("http");
const { loadLocalEnv } = require("./env.cjs");

loadLocalEnv();

const { handleAiExplain, sendJson } = require("./ai-proxy.cjs");
const { handleSyncApi } = require("./sync-api.cjs");

const port = Number(process.env.WORDMEM_API_PORT || 8787);
const host = process.env.WORDMEM_API_HOST || process.env.HOST || "127.0.0.1";
const serverTimeoutMs = Number(process.env.WORDMEM_SERVER_TIMEOUT_MS || 600000);

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

  sendJson(res, 404, { error: "Not found" });
});

server.timeout = serverTimeoutMs;
server.keepAliveTimeout = serverTimeoutMs;
server.headersTimeout = serverTimeoutMs + 5000;

server.listen(port, host, () => {
  console.log(`[wordmem-api] listening on http://${host}:${port}`);
});
