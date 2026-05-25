import { normalizeKnowledgeCard } from "../cardModel";
import { normalizeAppSettings } from "../defaults";
import type { AppSettings, BackendSyncConfig, KnowledgeCard, UsageRecord } from "../types";

export type SyncMeta = {
  version: number;
  exportedAt: string;
  cardCount: number;
  tombstoneCount: number;
  settingsCount: number;
  usageCount: number;
  isEmpty: boolean;
};

export type SyncSnapshot = {
  cards: KnowledgeCard[];
  settings: AppSettings | null;
  usageRecords: UsageRecord[];
  syncMeta: SyncMeta;
};

export type SyncStatus = {
  ok: boolean;
  enabled: boolean;
  trustedAutoSync: boolean;
  requiresToken: boolean;
};

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function syncApiBase(settings: AppSettings) {
  return trimTrailingSlash(settings.backendSync?.baseUrl || "");
}

export function syncApiUrl(settings: AppSettings, path: string) {
  const base = syncApiBase(settings);
  return `${base}${path}`;
}

export function canUseBackendSync(
  settings: AppSettings | null | undefined
): settings is AppSettings {
  return Boolean(
    settings?.backendSync?.enabled &&
      (settings.backendSync.token.trim() || settings.backendSync.trustedAutoSync)
  );
}

function syncHeaders(settings: AppSettings) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = settings.backendSync.token.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function plainJsonHeaders() {
  return {
    "Content-Type": "application/json",
  };
}

async function readSyncError(response: Response) {
  try {
    const payload = await response.json();
    return payload?.error?.message || payload?.error || payload?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function syncFetch<T>(
  settings: AppSettings,
  path: string,
  init: RequestInit
): Promise<T> {
  if (!canUseBackendSync(settings)) {
    throw new Error("请先启用后端同步，并填写同步 token。");
  }

  const response = await fetch(syncApiUrl(settings, path), {
    ...init,
    headers: {
      ...syncHeaders(settings),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(await readSyncError(response));
  }

  return response.json();
}

function stripLocalSyncConfig(settings: AppSettings): AppSettings {
  return {
    ...settings,
    backendSync: {
      enabled: false,
      baseUrl: "",
      token: "",
      trustedAutoSync: false,
      autoSyncOnStartup: false,
      autoSyncOnSave: false,
      lastSyncedAt: "",
      pendingChanges: false,
    },
  };
}

export function mergeRemoteSettings(
  remoteSettings: AppSettings,
  localSettings: AppSettings,
  syncPatch: Partial<BackendSyncConfig> = {}
): AppSettings {
  const normalizedRemote = normalizeAppSettings(remoteSettings);
  const normalizedLocal = normalizeAppSettings(localSettings);
  const localBackendSync = normalizedLocal.backendSync;
  const providers = { ...normalizedRemote.providers };

  (Object.keys(normalizedLocal.providers) as Array<keyof AppSettings["providers"]>).forEach(
    (providerId) => {
      const remoteProvider = providers[providerId] || normalizedLocal.providers[providerId];
      const localProvider = normalizedLocal.providers[providerId];
      providers[providerId] = {
        ...localProvider,
        ...remoteProvider,
        apiKey: remoteProvider.apiKeySaved ? "" : localProvider.apiKey || "",
        apiKeySaved: remoteProvider.apiKeySaved || localProvider.apiKeySaved,
      };
    }
  );

  return normalizeAppSettings({
    ...normalizedLocal,
    ...normalizedRemote,
    providers,
    backendSync: {
      ...localBackendSync,
      ...syncPatch,
    },
  });
}

export async function fetchSyncSnapshot(settings: AppSettings): Promise<SyncSnapshot> {
  const snapshot = await syncFetch<SyncSnapshot>(settings, "/api/sync/snapshot", {
    method: "GET",
  });

  return {
    cards: (snapshot.cards || []).map(normalizeKnowledgeCard),
    settings: snapshot.settings ? normalizeAppSettings(snapshot.settings) : null,
    usageRecords: snapshot.usageRecords || [],
    syncMeta: snapshot.syncMeta,
  };
}

export async function fetchSyncStatus(baseUrl = ""): Promise<SyncStatus> {
  const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/sync/status`, {
    method: "GET",
    headers: plainJsonHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readSyncError(response));
  }

  return response.json();
}

export async function pushCardsToSync(settings: AppSettings, cards: KnowledgeCard[]) {
  return syncFetch(settings, "/api/sync/cards", {
    method: "POST",
    body: JSON.stringify({
      cards: cards.map(normalizeKnowledgeCard),
    }),
  });
}

export async function deleteCardFromSync(
  settings: AppSettings,
  id: string,
  deletedAt = new Date().toISOString()
) {
  return syncFetch(
    settings,
    `/api/sync/cards/${encodeURIComponent(id)}?deletedAt=${encodeURIComponent(deletedAt)}`,
    {
      method: "DELETE",
    }
  );
}

export async function pushSettingsToSync(settings: AppSettings) {
  return syncFetch<{ settings?: AppSettings }>(settings, "/api/sync/settings", {
    method: "POST",
    body: JSON.stringify({
      settings: stripLocalSyncConfig(settings),
    }),
  });
}

export async function pushUsageToSync(settings: AppSettings, records: UsageRecord[]) {
  return syncFetch(settings, "/api/sync/usage", {
    method: "POST",
    body: JSON.stringify({ records }),
  });
}
