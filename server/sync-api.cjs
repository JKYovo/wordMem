const {
  deleteCard,
  getSnapshot,
  saveCards,
  saveSettings,
  saveUsageRecords,
} = require("./sync-store.cjs");
const { sendJson } = require("./ai-proxy.cjs");
const {
  configuredSyncToken,
  isAuthorizedSyncRequest,
  trustedAutoSyncEnabled,
} = require("./sync-auth.cjs");

const maxBodyBytes = Number(process.env.WORDMEM_SYNC_MAX_BODY_BYTES || 10 * 1024 * 1024);

function addCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBodyBytes) {
        reject(new Error("同步请求体太大。"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function requireSyncAuth(req, res) {
  if (trustedAutoSyncEnabled()) {
    return true;
  }

  const expected = configuredSyncToken();
  if (!expected) {
    sendJson(res, 503, {
      error: "后端同步未启用：请先设置 WORDMEM_SYNC_TOKEN。",
    });
    return false;
  }

  if (!isAuthorizedSyncRequest(req)) {
    sendJson(res, 401, {
      error: "同步 token 不正确，请检查 Authorization: Bearer <WORDMEM_SYNC_TOKEN>。",
    });
    return false;
  }

  return true;
}

function parsePayload(raw) {
  return raw ? JSON.parse(raw) : {};
}

async function handleSyncApi(req, res) {
  addCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (!String(req.url || "").startsWith("/api/sync/")) {
    return false;
  }

  try {
    const url = new URL(req.url, "http://wordmem.local");

    if (req.method === "GET" && url.pathname === "/api/sync/status") {
      const tokenConfigured = Boolean(configuredSyncToken());
      const trustedAutoSync = trustedAutoSyncEnabled();
      sendJson(res, 200, {
        ok: true,
        enabled: tokenConfigured || trustedAutoSync,
        trustedAutoSync,
        requiresToken: !trustedAutoSync,
      });
      return true;
    }

    if (!requireSyncAuth(req, res)) {
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/sync/snapshot") {
      sendJson(res, 200, await getSnapshot());
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/sync/cards") {
      const payload = parsePayload(await readBody(req));
      const result = await saveCards(payload.cards || []);
      sendJson(res, 200, Object.assign({ ok: true }, result));
      return true;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/sync/cards/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/sync/cards/".length));
      if (!id) {
        sendJson(res, 400, { error: "缺少卡片 id。" });
        return true;
      }
      const deletedAt = url.searchParams.get("deletedAt") || undefined;
      const result = await deleteCard(id, deletedAt);
      sendJson(res, 200, Object.assign({ ok: true }, result));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/sync/settings") {
      const payload = parsePayload(await readBody(req));
      const result = await saveSettings(payload.settings);
      sendJson(res, 200, Object.assign({ ok: true }, result));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/sync/usage") {
      const payload = parsePayload(await readBody(req));
      const records = payload.records || (payload.record ? [payload.record] : []);
      const result = await saveUsageRecords(records);
      sendJson(res, 200, Object.assign({ ok: true }, result));
      return true;
    }

    sendJson(res, 404, { error: "同步接口不存在。" });
    return true;
  } catch (error) {
    sendJson(res, 500, {
      error: error && error.message ? error.message : "同步接口请求失败。",
    });
    return true;
  }
}

module.exports = {
  handleSyncApi,
};
