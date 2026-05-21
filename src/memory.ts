import type { KnowledgeCard, RelatedMemoryCard } from "./types";

const STOP_WORDS = new Set([
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "a",
  "an",
  "is",
  "are",
  "this",
  "that",
  "it",
  "用",
  "的",
  "了",
  "和",
  "在",
]);

function normalize(value: string) {
  return value.toLowerCase().trim();
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      normalize(value)
        .match(/[a-z0-9][a-z0-9_./-]*|[\u4e00-\u9fa5]{2,}/g)
        ?.map((token) => token.replace(/^[-./_]+|[-./_]+$/g, ""))
        .filter((token) => token.length > 1 && !STOP_WORDS.has(token)) || []
    )
  );
}

function textForCard(card: KnowledgeCard) {
  return [card.term, card.tags.join(" "), card.sourceContext, card.body]
    .join("\n")
    .toLowerCase();
}

function scoreCard(card: KnowledgeCard, queryTokens: string[], queryTerm: string) {
  const haystack = textForCard(card);
  const term = normalize(card.term);
  let score = 0;

  if (queryTerm && term === queryTerm) {
    score += 24;
  } else if (queryTerm && (term.includes(queryTerm) || queryTerm.includes(term))) {
    score += 12;
  }

  queryTokens.forEach((token) => {
    if (!haystack.includes(token)) {
      return;
    }

    if (term.includes(token)) {
      score += 8;
    } else if (card.tags.some((tag) => normalize(tag).includes(token))) {
      score += 6;
    } else if (normalize(card.sourceContext).includes(token)) {
      score += 4;
    } else {
      score += 1;
    }
  });

  return score;
}

function excerpt(value: string, limit = 700) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

export function findRelatedMemoryCards(
  draft: KnowledgeCard,
  cards: KnowledgeCard[],
  limit = 3
): RelatedMemoryCard[] {
  const queryText = [draft.term, draft.tags.join(" "), draft.sourceContext, draft.body]
    .join("\n")
    .trim();
  const queryTokens = tokenize(queryText);
  const queryTerm = normalize(draft.term);

  if (!queryTokens.length && !queryTerm) {
    return [];
  }

  return cards
    .filter((card) => card.id !== draft.id && (card.term.trim() || card.body.trim()))
    .map((card) => ({
      card,
      score: scoreCard(card, queryTokens, queryTerm),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.card.updatedAt.localeCompare(left.card.updatedAt)
    )
    .slice(0, limit)
    .map(({ card }) => ({
      id: card.id,
      term: card.term,
      tags: card.tags,
      sourceContext: card.sourceContext,
      bodyExcerpt: excerpt(card.body),
    }));
}

export function memoryHint(relatedCards: RelatedMemoryCard[], enabled: boolean) {
  if (!enabled) {
    return "个人记忆已关闭。";
  }

  if (!relatedCards.length) {
    return "未找到相关旧卡片。";
  }

  return `参考：${relatedCards.map((card) => card.term).join("、")}`;
}
