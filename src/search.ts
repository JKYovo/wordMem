import type { KnowledgeCard } from "./types";
import { cardSummary } from "./cardModel";

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function cardHaystack(card: KnowledgeCard) {
  return [
    card.term,
    card.body,
    card.sourceContext,
    card.tags.join(" "),
    card.providerId || "",
    card.model || "",
  ]
    .join("\n")
    .toLowerCase();
}

export function searchCards(
  cards: KnowledgeCard[],
  query: string,
  tags: string[] | string
): KnowledgeCard[] {
  const normalizedQuery = normalize(query);
  const normalizedTags = (Array.isArray(tags) ? tags : [tags]).map(normalize).filter(Boolean);

  const filtered = cards.filter((card) => {
    const tagMatches =
      !normalizedTags.length ||
      normalizedTags.every((selectedTag) =>
        card.tags.some((cardTag) => normalize(cardTag) === selectedTag)
      );

    if (!tagMatches) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return cardHaystack(card).includes(normalizedQuery);
  });

  if (!normalizedQuery) {
    return filtered;
  }

  return filtered.sort((left, right) => {
    const leftTerm = normalize(left.term);
    const rightTerm = normalize(right.term);
    const leftScore = leftTerm.includes(normalizedQuery) ? 2 : 0;
    const rightScore = rightTerm.includes(normalizedQuery) ? 2 : 0;
    return rightScore - leftScore || right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function collectTags(cards: KnowledgeCard[]) {
  return Array.from(new Set(cards.flatMap((card) => card.tags.map((tag) => tag.trim())).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right)
  );
}

export function getCardSummary(card: KnowledgeCard) {
  return cardSummary(card);
}
