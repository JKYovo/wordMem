function configuredSyncToken() {
  return String(process.env.WORDMEM_SYNC_TOKEN || "").trim();
}

function trustedAutoSyncEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.WORDMEM_TRUSTED_SYNC || "").trim());
}

function requestBearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isAuthorizedSyncRequest(req) {
  if (trustedAutoSyncEnabled()) {
    return true;
  }

  const expected = configuredSyncToken();
  if (!expected) {
    return false;
  }

  return requestBearerToken(req) === expected;
}

module.exports = {
  configuredSyncToken,
  isAuthorizedSyncRequest,
  trustedAutoSyncEnabled,
};
