import { normalizeKnowledgeCard } from "./cardModel";
import type { ExportPayload, KnowledgeCard, UsageExportPayload, UsageRecord } from "./types";

export function buildExport(cards: KnowledgeCard[]): ExportPayload {
  return {
    app: "wordmem",
    version: 2,
    exportedAt: new Date().toISOString(),
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

export function parseImportedCards(raw: string): KnowledgeCard[] {
  const parsed = JSON.parse(raw) as ExportPayload | KnowledgeCard[];
  const cards = Array.isArray(parsed) ? parsed : parsed.cards;

  if (!Array.isArray(cards)) {
    throw new Error("导入文件里没有 cards 数组。");
  }

  return cards.map((card) => {
    if (!card.id || !card.term) {
      throw new Error("导入文件里存在缺少 id 或 term 的卡片。");
    }

    return normalizeKnowledgeCard(card);
  });
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
