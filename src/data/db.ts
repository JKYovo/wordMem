import { createDefaultSettings } from "../defaults";
import { normalizeKnowledgeCard } from "../cardModel";
import type { AppSettings, KnowledgeCard, UsageRecord } from "../types";

const DB_NAME = "wordmem-db";
const DB_VERSION = 3;
const CARD_STORE = "cards";
const SETTINGS_STORE = "settings";
const USAGE_STORE = "usage";
const TOMBSTONE_STORE = "sync_tombstones";

export type PendingDelete = {
  id: string;
  deletedAt: string;
};

let dbPromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(CARD_STORE)) {
        const store = db.createObjectStore(CARD_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("term", "term");
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(USAGE_STORE)) {
        const usageStore = db.createObjectStore(USAGE_STORE, { keyPath: "id" });
        usageStore.createIndex("dateKey", "dateKey");
        usageStore.createIndex("createdAt", "createdAt");
      }

      if (!db.objectStoreNames.contains(TOMBSTONE_STORE)) {
        const tombstoneStore = db.createObjectStore(TOMBSTONE_STORE, { keyPath: "id" });
        tombstoneStore.createIndex("deletedAt", "deletedAt");
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function listCards(): Promise<KnowledgeCard[]> {
  const db = await openDatabase();
  const store = db.transaction(CARD_STORE, "readonly").objectStore(CARD_STORE);
  const cards = await requestToPromise<KnowledgeCard[]>(store.getAll());
  return cards
    .map(normalizeKnowledgeCard)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveCard(card: KnowledgeCard): Promise<void> {
  const db = await openDatabase();
  const store = db.transaction(CARD_STORE, "readwrite").objectStore(CARD_STORE);
  await requestToPromise(store.put(normalizeKnowledgeCard(card)));
}

export async function saveCards(cards: KnowledgeCard[]): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(CARD_STORE, "readwrite");
  const store = tx.objectStore(CARD_STORE);

  cards.forEach((card) => {
    store.put(normalizeKnowledgeCard(card));
  });

  await new Promise<void>((resolve, reject) => {
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

export async function replaceCards(cards: KnowledgeCard[]): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(CARD_STORE, "readwrite");
  const store = tx.objectStore(CARD_STORE);

  store.clear();
  cards.forEach((card) => {
    store.put(normalizeKnowledgeCard(card));
  });

  await new Promise<void>((resolve, reject) => {
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

export async function deleteCard(id: string): Promise<void> {
  const db = await openDatabase();
  const store = db.transaction(CARD_STORE, "readwrite").objectStore(CARD_STORE);
  await requestToPromise(store.delete(id));
}

export async function loadSettings(): Promise<AppSettings> {
  const db = await openDatabase();
  const store = db.transaction(SETTINGS_STORE, "readonly").objectStore(SETTINGS_STORE);
  const stored = await requestToPromise<AppSettings | undefined>(store.get("app"));
  const defaults = createDefaultSettings();

  if (!stored) {
    return defaults;
  }

  return {
    ...defaults,
    ...stored,
    disableResponseStorage:
      stored.disableResponseStorage ?? defaults.disableResponseStorage,
    memoryEnabled: stored.memoryEnabled ?? defaults.memoryEnabled,
    personalPreference:
      stored.personalPreference ?? defaults.personalPreference,
    dailyTotalBudgetUsd:
      stored.dailyTotalBudgetUsd ?? defaults.dailyTotalBudgetUsd,
    reservedBudgetUsd:
      stored.reservedBudgetUsd ?? defaults.reservedBudgetUsd,
    wordMemDailyBudgetUsd:
      stored.wordMemDailyBudgetUsd ?? defaults.wordMemDailyBudgetUsd,
    economyModeThresholdUsd:
      stored.economyModeThresholdUsd ?? defaults.economyModeThresholdUsd,
    perRequestBudgetUsd:
      stored.perRequestBudgetUsd ?? defaults.perRequestBudgetUsd,
    enableBackgroundAiTasks:
      stored.enableBackgroundAiTasks ?? defaults.enableBackgroundAiTasks,
    backendSync: {
      ...defaults.backendSync,
      ...stored.backendSync,
    },
    providers: {
      openai: {
        ...defaults.providers.openai,
        ...stored.providers?.openai,
        label: defaults.providers.openai.label,
      },
      deepseek: { ...defaults.providers.deepseek, ...stored.providers?.deepseek },
      bxi: { ...defaults.providers.bxi, ...stored.providers?.bxi },
      custom: { ...defaults.providers.custom, ...stored.providers?.custom },
    },
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await openDatabase();
  const store = db.transaction(SETTINGS_STORE, "readwrite").objectStore(SETTINGS_STORE);
  await requestToPromise(store.put(settings));
}

export async function listUsageRecords(): Promise<UsageRecord[]> {
  const db = await openDatabase();
  const store = db.transaction(USAGE_STORE, "readonly").objectStore(USAGE_STORE);
  const records = await requestToPromise<UsageRecord[]>(store.getAll());
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function saveUsageRecord(record: UsageRecord): Promise<void> {
  const db = await openDatabase();
  const store = db.transaction(USAGE_STORE, "readwrite").objectStore(USAGE_STORE);
  await requestToPromise(store.put(record));
}

export async function saveUsageRecords(records: UsageRecord[]): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(USAGE_STORE, "readwrite");
  const store = tx.objectStore(USAGE_STORE);

  records.forEach((record) => {
    store.put(record);
  });

  await new Promise<void>((resolve, reject) => {
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

export async function listPendingDeletes(): Promise<PendingDelete[]> {
  const db = await openDatabase();
  const store = db.transaction(TOMBSTONE_STORE, "readonly").objectStore(TOMBSTONE_STORE);
  const records = await requestToPromise<PendingDelete[]>(store.getAll());
  return records.sort((left, right) => left.deletedAt.localeCompare(right.deletedAt));
}

export async function savePendingDelete(record: PendingDelete): Promise<void> {
  const db = await openDatabase();
  const store = db.transaction(TOMBSTONE_STORE, "readwrite").objectStore(TOMBSTONE_STORE);
  await requestToPromise(store.put(record));
}

export async function clearPendingDelete(id: string): Promise<void> {
  const db = await openDatabase();
  const store = db.transaction(TOMBSTONE_STORE, "readwrite").objectStore(TOMBSTONE_STORE);
  await requestToPromise(store.delete(id));
}
