const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const rootDir = path.resolve(__dirname, "..");
const defaultDbPath = path.join(rootDir, "data", "wordmem.sqlite");
const dbPath = path.resolve(process.env.WORDMEM_DB_PATH || defaultDbPath);
const settingId = "app";
const encryptedPrefix = "enc:v1:";

let storePromise;
let writeQueue = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function sqlJsLocateFile(file) {
  return path.join(rootDir, "node_modules", "sql.js", "dist", file);
}

async function getStore() {
  if (!storePromise) {
    storePromise = initStore();
  }

  return storePromise;
}

async function initStore() {
  ensureDir(dbPath);
  const SQL = await initSqlJs({ locateFile: sqlJsLocateFile });
  const db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cards_updated_at ON cards(updated_at);
    CREATE INDEX IF NOT EXISTS idx_cards_deleted_at ON cards(deleted_at);

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_records(created_at);

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  if (!getMeta(db, "version")) {
    setMeta(db, "version", "1");
    setMeta(db, "createdAt", nowIso());
    persist(db);
  }

  return { db };
}

function persist(db) {
  ensureDir(dbPath);
  const tempPath = `${dbPath}.tmp`;
  fs.writeFileSync(tempPath, Buffer.from(db.export()));
  fs.renameSync(tempPath, dbPath);
}

function withWrite(task) {
  writeQueue = writeQueue.then(async () => {
    const store = await getStore();
    const result = await task(store.db);
    persist(store.db);
    return result;
  });

  return writeQueue;
}

function getMeta(db, key) {
  const stmt = db.prepare("SELECT value FROM sync_meta WHERE key = ?");
  try {
    stmt.bind([key]);
    if (!stmt.step()) {
      return "";
    }
    const row = stmt.getAsObject();
    return String(row.value || "");
  } finally {
    stmt.free();
  }
}

function setMeta(db, key, value) {
  db.run(
    "INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)",
    [key, String(value)]
  );
}

function bumpVersion(db) {
  const current = Number(getMeta(db, "version") || "0");
  const next = Number.isFinite(current) ? current + 1 : 1;
  setMeta(db, "version", String(next));
  setMeta(db, "updatedAt", nowIso());
  return next;
}

function queryRows(db, sql, params) {
  const stmt = db.prepare(sql);
  const rows = [];
  try {
    if (params) {
      stmt.bind(params);
    }
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }
  return rows;
}

function queryOne(db, sql, params) {
  const rows = queryRows(db, sql, params);
  return rows[0];
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch (_error) {
    return fallback;
  }
}

function compareIso(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}

function dataKey() {
  const secret = String(process.env.WORDMEM_DATA_KEY || "").trim();
  if (!secret) {
    throw new Error("后端需要设置 WORDMEM_DATA_KEY 才能加密保存 API Key。");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

function encryptSecret(value) {
  const plain = String(value || "").trim();
  if (!plain) {
    return "";
  }
  if (plain.startsWith(encryptedPrefix)) {
    return plain;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    encryptedPrefix.slice(0, -1),
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

function decryptSecret(value) {
  const encoded = String(value || "").trim();
  if (!encoded) {
    return "";
  }
  if (!encoded.startsWith(encryptedPrefix)) {
    return encoded;
  }

  const parts = encoded.split(":");
  if (parts.length !== 5) {
    throw new Error("后端保存的 API Key 加密格式无效。");
  }

  const iv = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  const ciphertext = Buffer.from(parts[4], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", dataKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function stripLocalSyncConfig(settings) {
  const next = Object.assign({}, settings || {});
  delete next.backendSync;
  return next;
}

function prepareSettingsForStore(incomingSettings, existingSettings) {
  const next = stripLocalSyncConfig(incomingSettings);
  const existingProviders = (existingSettings && existingSettings.providers) || {};
  const incomingProviders = next.providers || {};
  const providers = {};

  Object.keys(incomingProviders).forEach((providerId) => {
    const provider = Object.assign({}, incomingProviders[providerId]);
    const incomingKey = String(provider.apiKey || "").trim();
    const existingKey =
      existingProviders[providerId] && existingProviders[providerId].apiKey
        ? String(existingProviders[providerId].apiKey)
        : "";

    provider.apiKey = incomingKey ? encryptSecret(incomingKey) : existingKey;
    delete provider.apiKeySaved;
    providers[providerId] = provider;
  });

  next.id = settingId;
  next.providers = providers;
  next.updatedAt = String(next.updatedAt || nowIso());
  return next;
}

function sanitizeSettingsForClient(settings) {
  if (!settings) {
    return null;
  }

  const next = Object.assign({}, settings);
  const providers = {};
  Object.keys(settings.providers || {}).forEach((providerId) => {
    const provider = Object.assign({}, settings.providers[providerId]);
    const hasKey = Boolean(String(provider.apiKey || "").trim());
    provider.apiKey = "";
    provider.apiKeySaved = hasKey;
    providers[providerId] = provider;
  });
  next.providers = providers;
  delete next.backendSync;
  return next;
}

function getStoredSettingsRaw(db) {
  const row = queryOne(db, "SELECT json FROM settings WHERE id = ?", [settingId]);
  return row ? parseJson(row.json, null) : null;
}

function snapshotMeta(db) {
  const cardCountRow = queryOne(
    db,
    "SELECT COUNT(*) AS count FROM cards WHERE deleted_at IS NULL"
  );
  const tombstoneCountRow = queryOne(
    db,
    "SELECT COUNT(*) AS count FROM cards WHERE deleted_at IS NOT NULL"
  );
  const settingsCountRow = queryOne(db, "SELECT COUNT(*) AS count FROM settings");
  const usageCountRow = queryOne(db, "SELECT COUNT(*) AS count FROM usage_records");
  const cardCount = Number(cardCountRow && cardCountRow.count ? cardCountRow.count : 0);
  const tombstoneCount = Number(
    tombstoneCountRow && tombstoneCountRow.count ? tombstoneCountRow.count : 0
  );
  const settingsCount = Number(
    settingsCountRow && settingsCountRow.count ? settingsCountRow.count : 0
  );
  const usageCount = Number(usageCountRow && usageCountRow.count ? usageCountRow.count : 0);

  return {
    version: Number(getMeta(db, "version") || "0"),
    exportedAt: nowIso(),
    cardCount,
    tombstoneCount,
    settingsCount,
    usageCount,
    isEmpty: cardCount + tombstoneCount + settingsCount + usageCount === 0,
  };
}

async function getSnapshot() {
  const store = await getStore();
  const db = store.db;
  const cardRows = queryRows(
    db,
    "SELECT json FROM cards WHERE deleted_at IS NULL ORDER BY updated_at DESC"
  );
  const usageRows = queryRows(
    db,
    "SELECT json FROM usage_records ORDER BY created_at DESC"
  );
  const settings = getStoredSettingsRaw(db);

  return {
    cards: cardRows.map((row) => parseJson(row.json, null)).filter(Boolean),
    settings: sanitizeSettingsForClient(settings),
    usageRecords: usageRows.map((row) => parseJson(row.json, null)).filter(Boolean),
    syncMeta: snapshotMeta(db),
  };
}

async function saveCards(cards) {
  return withWrite((db) => {
    let saved = 0;
    let skipped = 0;
    let rejectedDeleted = 0;

    (Array.isArray(cards) ? cards : []).forEach((card) => {
      if (!card || !card.id) {
        skipped += 1;
        return;
      }

      const updatedAt = String(card.updatedAt || nowIso());
      const existing = queryOne(
        db,
        "SELECT updated_at, deleted_at FROM cards WHERE id = ?",
        [card.id]
      );

      if (existing && existing.deleted_at && compareIso(updatedAt, existing.deleted_at) <= 0) {
        rejectedDeleted += 1;
        return;
      }

      if (
        existing &&
        !existing.deleted_at &&
        existing.updated_at &&
        compareIso(updatedAt, existing.updated_at) < 0
      ) {
        skipped += 1;
        return;
      }

      const nextCard = Object.assign({}, card, { updatedAt });
      db.run(
        `INSERT OR REPLACE INTO cards (id, json, updated_at, deleted_at)
         VALUES (?, ?, ?, NULL)`,
        [String(card.id), JSON.stringify(nextCard), updatedAt]
      );
      saved += 1;
    });

    if (saved > 0) {
      bumpVersion(db);
    }

    return { saved, skipped, rejectedDeleted };
  });
}

async function deleteCard(id, deletedAt) {
  return withWrite((db) => {
    const stamp = String(deletedAt || nowIso());
    const existing = queryOne(
      db,
      "SELECT json, updated_at, deleted_at FROM cards WHERE id = ?",
      [id]
    );

    if (existing && existing.deleted_at && compareIso(existing.deleted_at, stamp) >= 0) {
      return { deleted: false, skipped: true };
    }

    const json = existing && existing.json
      ? existing.json
      : JSON.stringify({ id: String(id), updatedAt: stamp });

    db.run(
      `INSERT OR REPLACE INTO cards (id, json, updated_at, deleted_at)
       VALUES (?, ?, ?, ?)`,
      [String(id), json, String((existing && existing.updated_at) || stamp), stamp]
    );
    bumpVersion(db);
    return { deleted: true, skipped: false };
  });
}

async function saveSettings(settings) {
  return withWrite((db) => {
    if (!settings || settings.id !== settingId) {
      throw new Error("同步设置缺少 app id。");
    }

    const existing = getStoredSettingsRaw(db);
    const incomingUpdatedAt = String(settings.updatedAt || nowIso());
    const existingUpdatedAt = String((existing && existing.updatedAt) || "");

    if (existing && existingUpdatedAt && compareIso(incomingUpdatedAt, existingUpdatedAt) < 0) {
      return {
        saved: false,
        settings: sanitizeSettingsForClient(existing),
      };
    }

    const prepared = prepareSettingsForStore(
      Object.assign({}, settings, { updatedAt: incomingUpdatedAt }),
      existing
    );

    db.run(
      "INSERT OR REPLACE INTO settings (id, json, updated_at) VALUES (?, ?, ?)",
      [settingId, JSON.stringify(prepared), prepared.updatedAt]
    );
    bumpVersion(db);

    return {
      saved: true,
      settings: sanitizeSettingsForClient(prepared),
    };
  });
}

async function saveUsageRecords(records) {
  return withWrite((db) => {
    let saved = 0;
    let skipped = 0;

    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!record || !record.id) {
        skipped += 1;
        return;
      }

      const createdAt = String(record.createdAt || nowIso());
      const existing = queryOne(db, "SELECT id FROM usage_records WHERE id = ?", [
        record.id,
      ]);
      if (existing) {
        skipped += 1;
        return;
      }

      db.run(
        "INSERT INTO usage_records (id, json, created_at) VALUES (?, ?, ?)",
        [String(record.id), JSON.stringify(Object.assign({}, record, { createdAt })), createdAt]
      );
      saved += 1;
    });

    if (saved > 0) {
      bumpVersion(db);
    }

    return { saved, skipped };
  });
}

async function getProviderApiKey(providerId) {
  const store = await getStore();
  const settings = getStoredSettingsRaw(store.db);
  const provider =
    settings && settings.providers ? settings.providers[String(providerId)] : null;
  if (!provider || !provider.apiKey) {
    return "";
  }

  return decryptSecret(provider.apiKey);
}

module.exports = {
  dbPath,
  deleteCard,
  getProviderApiKey,
  getSnapshot,
  saveCards,
  saveSettings,
  saveUsageRecords,
};
