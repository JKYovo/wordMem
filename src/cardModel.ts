import type { KnowledgeCard, StructuredDraft } from "./types";

const LEGACY_BODY_SECTIONS: Array<[keyof KnowledgeCard, string]> = [
  ["shortMeaning", "简短解释"],
  ["detailedExplanation", "详细解释"],
  ["workUsage", "工作中的用法"],
  ["examples", "相关例子"],
  ["confusingConcepts", "易混概念"],
  ["memorySentence", "记忆句"],
];

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function hasText(value: unknown) {
  return clean(value).length > 0;
}

function appendUnique(sections: string[], value: string, title?: string) {
  const text = unwrapAiWrappedBody(clean(value));
  if (!text) {
    return;
  }

  const alreadyIncluded = sections.some((section) => section.includes(text));
  if (alreadyIncluded) {
    return;
  }

  sections.push(title ? `${title}\n${text}` : text);
}

export function bodyFromCard(card: Partial<KnowledgeCard>) {
  const sections: string[] = [];
  const mainBody = unwrapAiWrappedBody(clean(card.body));

  appendUnique(sections, mainBody);

  if (!mainBody) {
    appendUnique(sections, clean(card.rawAiAnswer));

    LEGACY_BODY_SECTIONS.forEach(([key, title]) => {
      appendUnique(sections, clean(card[key]), title);
    });
  }

  return sections.join("\n\n").trim();
}

export function normalizeKnowledgeCard(card: Partial<KnowledgeCard>): KnowledgeCard {
  const stamp = new Date().toISOString();
  const wrappedDraft = structuredDraftFromText(clean(card.body));
  const tags = Array.isArray(card.tags)
    ? card.tags.map((tag) => clean(tag)).filter(Boolean)
    : [];
  const wrappedTags = wrappedDraft?.tags || [];

  return {
    id: clean(card.id) || `card_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    term: clean(card.term) || clean(wrappedDraft?.term),
    body: bodyFromCard(card),
    sourceContext: clean(card.sourceContext) || clean(wrappedDraft?.sourceContext),
    tags: Array.from(new Set([...tags, ...wrappedTags])),
    pronunciation: clean(card.pronunciation) || clean(wrappedDraft?.pronunciation) || undefined,
    providerId: card.providerId,
    model: clean(card.model) || undefined,
    createdAt: clean(card.createdAt) || stamp,
    updatedAt: clean(card.updatedAt) || stamp,
  };
}

export function draftBodyFromStructured(
  structured: StructuredDraft | undefined,
  rawAnswer: string
) {
  const draft = structured || structuredDraftFromText(rawAnswer);

  if (!draft) {
    return unwrapAiWrappedBody(rawAnswer);
  }

  return (
    clean(draft.body) ||
    clean(draft.rawAnswerMarkdown) ||
    bodyFromCard({
      detailedExplanation: draft.detailedExplanation,
      workUsage: draft.workUsage,
      examples: draft.examples,
      confusingConcepts: draft.confusingConcepts,
      memorySentence: draft.memorySentence,
      shortMeaning: draft.shortMeaning,
      rawAiAnswer: rawAnswer,
    })
  );
}

export function structuredDraftFromText(rawAnswer: string): StructuredDraft | undefined {
  const text = stripJsonFence(clean(rawAnswer));
  if (!looksLikeJsonObject(text)) {
    return undefined;
  }

  const direct = parseStructuredJson(text);
  if (direct) {
    return direct;
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = parseStructuredJson(text.slice(firstBrace, lastBrace + 1));
    if (sliced) {
      return sliced;
    }
  }

  return parseLooseStructuredDraft(text);
}

export function unwrapAiWrappedBody(value: string) {
  const draft = structuredDraftFromText(value);
  return clean(draft?.body) || clean(draft?.rawAnswerMarkdown) || value;
}

function looksLikeJsonObject(value: string) {
  const text = value.trim();
  return text.includes("{") && /"body"\s*:/.test(text);
}

function parseStructuredJson(value: string): StructuredDraft | undefined {
  try {
    const parsed = JSON.parse(stripJsonFence(value));
    if (typeof parsed === "string") {
      return parseStructuredJson(parsed);
    }
    return structuredFromUnknown(parsed);
  } catch {
    return undefined;
  }
}

function stripJsonFence(value: string) {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function structuredFromUnknown(parsed: unknown): StructuredDraft | undefined {
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const value = parsed as Record<string, unknown>;
  const body = clean(value.body);
  if (!body && !clean(value.rawAnswerMarkdown)) {
    return undefined;
  }

  return {
    term: clean(value.term) || undefined,
    body: body || undefined,
    sourceContext: clean(value.sourceContext) || undefined,
    pronunciation: clean(value.pronunciation) || undefined,
    shortMeaning: clean(value.shortMeaning) || undefined,
    detailedExplanation: clean(value.detailedExplanation) || undefined,
    workUsage: clean(value.workUsage) || undefined,
    examples: clean(value.examples) || undefined,
    confusingConcepts: clean(value.confusingConcepts) || undefined,
    memorySentence: clean(value.memorySentence) || undefined,
    rawAnswerMarkdown: clean(value.rawAnswerMarkdown) || undefined,
    tags: Array.isArray(value.tags)
      ? value.tags.map((tag) => clean(tag)).filter(Boolean)
      : undefined,
  };
}

function parseLooseStructuredDraft(value: string): StructuredDraft | undefined {
  const body = looseBodyField(value);
  if (!body) {
    return undefined;
  }

  return {
    term: looseJsonStringField(value, "term"),
    pronunciation: looseJsonStringField(value, "pronunciation"),
    sourceContext: looseJsonStringField(value, "sourceContext"),
    tags: looseTags(value),
    body,
  };
}

function looseJsonStringField(value: string, key: string) {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = value.match(pattern);
  if (!match) {
    return undefined;
  }

  return unescapeJsonish(match[1]);
}

function looseBodyField(value: string) {
  const bodyStart = value.match(/"body"\s*:\s*"/);
  if (!bodyStart || bodyStart.index === undefined) {
    return undefined;
  }

  const start = bodyStart.index + bodyStart[0].length;
  const end = findBodyStringEnd(value, start);
  if (end <= start) {
    return undefined;
  }

  return unescapeJsonish(value.slice(start, end));
}

function findBodyStringEnd(value: string, start: number) {
  const endBrace = value.lastIndexOf("}");
  const searchEnd = endBrace > start ? endBrace : value.length;
  let lastQuote = -1;
  let escaped = false;

  for (let index = start; index < searchEnd; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      const rest = value.slice(index + 1, searchEnd);
      if (/^\s*(?:,?\s*}|\s*$)/.test(rest)) {
        return index;
      }
      lastQuote = index;
    }
  }

  return lastQuote > start ? lastQuote : searchEnd;
}

function looseTags(value: string) {
  const match = value.match(/"tags"\s*:\s*\[([\s\S]*?)\]/);
  if (!match) {
    return undefined;
  }

  return match[1]
    .split(",")
    .map((item) => unescapeJsonish(item.replace(/^["\s]+|["\s]+$/g, "")))
    .filter(Boolean);
}

function unescapeJsonish(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .trim();
}

export function cardSummary(card: KnowledgeCard) {
  const source = card.body || card.sourceContext || "";
  return source
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function getCardSummary(card: KnowledgeCard) {
  return cardSummary(card);
}

export function cardHasContent(card: KnowledgeCard) {
  return hasText(card.term) || hasText(card.body) || hasText(card.sourceContext);
}
