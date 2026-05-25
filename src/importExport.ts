import { normalizeKnowledgeCard } from "./cardModel";
import { DEFAULT_LIBRARY_ID, normalizeLibraries } from "./defaults";
import type {
  ExportPayload,
  KnowledgeCard,
  KnowledgeLibrary,
  UsageExportPayload,
  UsageRecord,
} from "./types";

export function buildExport(
  cards: KnowledgeCard[],
  libraries: KnowledgeLibrary[] = normalizeLibraries(undefined)
): ExportPayload {
  return {
    app: "wordmem",
    version: 2,
    exportedAt: new Date().toISOString(),
    libraries: normalizeLibraries(libraries),
    cards: cards.map(normalizeKnowledgeCard),
  };
}

export function buildUsageExport(records: UsageRecord[]): UsageExportPayload {
  return {
    app: "wordmem",
    version: 1,
    exportedAt: new Date().toISOString(),
    usageRecords: records,
  };
}

export function parseImportedCards(
  raw: string,
  fallbackLibraryId = DEFAULT_LIBRARY_ID
): KnowledgeCard[] {
  return parseImportedPayload(raw, fallbackLibraryId).cards;
}

export function parseImportedPayload(
  raw: string,
  fallbackLibraryId = DEFAULT_LIBRARY_ID
): { cards: KnowledgeCard[]; libraries: KnowledgeLibrary[] } {
  const parsed = JSON.parse(raw) as ExportPayload | KnowledgeCard[];
  const cards = Array.isArray(parsed) ? parsed : parsed.cards;
  const libraries =
    Array.isArray(parsed) || !Array.isArray(parsed.libraries)
      ? []
      : normalizeLibraries(parsed.libraries);
  const knownLibraryIds = new Set([
    ...normalizeLibraries(undefined).map((library) => library.id),
    ...libraries.map((library) => library.id),
  ]);

  if (!Array.isArray(cards)) {
    throw new Error("导入文件里没有 cards 数组。");
  }

  return {
    libraries,
    cards: cards.map((card) => {
      if (!card.id || !card.term) {
        throw new Error("导入文件里存在缺少 id 或 term 的卡片。");
      }
      const importedLibraryId = card.libraryId || "";
      const libraryId =
        importedLibraryId && knownLibraryIds.has(importedLibraryId)
          ? importedLibraryId
          : fallbackLibraryId;

      return normalizeKnowledgeCard({
        ...card,
        libraryId,
      });
    }),
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
