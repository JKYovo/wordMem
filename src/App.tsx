import {
  BookOpen,
  Brain,
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  Eye,
  FileUp,
  KeyRound,
  Library,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  Tags,
  Trash2,
  RefreshCw,
  Share2,
  Smartphone,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  draftBodyFromStructured,
  getCardSummary,
  normalizeKnowledgeCard,
  structuredDraftFromText,
  unwrapAiWrappedBody,
} from "./cardModel";
import { explainWithActiveProvider } from "./ai/providers";
import { createEmptyCard, createId, nowIso } from "./defaults";
import {
  deleteCard as deleteCardFromDb,
  clearPendingDelete,
  listCards,
  listPendingDeletes,
  listUsageRecords,
  loadSettings,
  replaceCards,
  saveCard as saveCardToDb,
  saveCards,
  savePendingDelete,
  saveSettings,
  saveUsageRecord,
  saveUsageRecords as saveUsageRecordsToDb,
} from "./data/db";
import {
  canUseBackendSync,
  deleteCardFromSync,
  fetchSyncSnapshot,
  fetchSyncStatus,
  mergeRemoteSettings,
  pushCardsToSync,
  pushSettingsToSync,
  pushUsageToSync,
} from "./data/sync";
import { buildExport, buildUsageExport, downloadJson, parseImportedCards } from "./importExport";
import { collectTags, searchCards } from "./search";
import { findRelatedMemoryCards, memoryHint } from "./memory";
import { buildKnowledgeViews, findRelatedCards } from "./knowledge";
import {
  budgetDateKey,
  estimateAiRequest,
  estimateCostFromTokens,
  estimateTokens,
  formatUsd,
  getBudgetSummary,
  priceForProvider,
  routeProviderForTask,
  taskLabel,
  usageRecordCost,
} from "./budget";
import type {
  AiExplainRequest,
  AiProviderId,
  AiTaskType,
  AppSettings,
  KnowledgeCard,
  ProviderConfig,
  ReasoningEffort,
  UsageRecord,
  WireApi,
} from "./types";

type View = "library" | "settings";
type LibraryMode = "views" | "all";
type EditorMode = "edit" | "preview";
type MobilePane = "detail" | "library";
type AiActionKind = "quick" | "polish" | "review_section" | "review_full" | "tag";
type AiRouteDisplay = {
  providerId: AiProviderId;
  providerLabel: string;
  model: string;
  taskType?: AiTaskType;
};
type MarkdownSection = {
  id: string;
  title: string;
  content: string;
  defaultOpen: boolean;
};
type TagAliasMap = Record<string, string>;
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const providerOrder: AiProviderId[] = ["openai", "deepseek", "bxi", "custom"];
const reasoningEfforts: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
const CUSTOM_MODEL_VALUE = "__custom_model__";
const INSTALL_HINT_DISMISSED_KEY = "wordmem-install-hint-dismissed";
const AUTO_CLASSIFY_PROVIDER_ID: AiProviderId = "deepseek";
const PREFERRED_TAG_ORDER = [
  "深度学习",
  "机器学习",
  "强化学习",
  "PPO",
  "policy",
  "rollout",
  "机器人控制",
  "运动控制",
  "仿真评测",
  "GMR",
  "motion retargeting",
  "数学基础",
  "优化算法",
  "debug",
];
const PROTECTED_DISTINCT_TAGS = new Set([
  "PPO",
  "GMR",
  "policy",
  "rollout",
  "debug",
  "MuJoCo",
]);

function hasMobilePreviewParam() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("mobilePreview") === "1";
}

function launchParam(name: string) {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get(name) || "";
}

function isStandaloneDisplay() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function isIosLikeDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isMobileLayoutPreferred(forceMobilePreview: boolean) {
  if (forceMobilePreview || typeof window === "undefined") {
    return forceMobilePreview;
  }

  return window.matchMedia("(max-width: 860px), (pointer: coarse)").matches;
}

function cloneCard(card: KnowledgeCard) {
  return normalizeKnowledgeCard(card);
}

function sortCardsByUpdatedAt(cards: KnowledgeCard[]) {
  return [...cards].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function normalizeTags(value: string) {
  return value
    .split(/[,，;；\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function cleanPronunciation(value: string | undefined) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const placeholderPattern =
    /^\/?\s*(ipa|i\.p\.a\.|pronunciation|phonetic|音标|读音)\s*\/?$/i;
  if (placeholderPattern.test(text)) {
    return "";
  }

  const slashMatch = text.match(/\/\s*([^/，,;；()（）]{1,80})\s*(?:\/|$)/);
  if (slashMatch) {
    const inner = slashMatch[1].trim();
    return placeholderPattern.test(inner) ? "" : `/${inner}/`;
  }

  const bracketMatch = text.match(/\[\s*([^\]，,;；()（）]{1,80})\s*\]/);
  if (bracketMatch) {
    const inner = bracketMatch[1].trim();
    return placeholderPattern.test(inner) ? "" : `/${inner}/`;
  }

  const cleaned = text
    .replace(/（?近似读音[:：]?.*$/i, "")
    .replace(/\(?近似读音[:：]?.*$/i, "")
    .replace(/[，,;；].*$/, "")
    .trim();
  return placeholderPattern.test(cleaned) ? "" : cleaned;
}

function wireApiLabel(wireApi: WireApi) {
  return wireApi === "responses" ? "Responses API" : "Chat Completions";
}

function selectedModelValue(provider: ProviderConfig) {
  return provider.models.includes(provider.defaultModel)
    ? provider.defaultModel
    : CUSTOM_MODEL_VALUE;
}

function optionalNumberInput(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseBudgetNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function shortUsageStatus(record: UsageRecord) {
  if (record.status === "success") {
    return "成功";
  }
  if (record.status === "blocked") {
    return "拦截";
  }
  return "失败";
}

function formatDate(value: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isFetchLikeError(error: unknown) {
  return error instanceof TypeError && /fetch/i.test(error.message);
}

function toDisplayMathBlock(indent: string, formula: string) {
  return `${indent}$$\n${formula.trim()}\n${indent}$$`;
}

function normalizeMathDelimiters(body: string) {
  return body
    .replace(/\\\[\s*([\s\S]+?)\s*\\\]/g, (_match, formula: string) =>
      `$$\n${formula.trim()}\n$$`
    )
    .replace(/\\\(\s*([^\n]+?)\s*\\\)/g, (_match, formula: string) =>
      `$${formula.trim()}$`
    );
}

function normalizeStandaloneMath(body: string) {
  return normalizeMathDelimiters(body)
    .split("\n")
    .map((line) => {
      const blockMatch = line.match(/^(\s*)\$\$\s*([^$\n]+?)\s*\$\$(\s*)$/);
      if (blockMatch) {
        return toDisplayMathBlock(blockMatch[1], blockMatch[2]);
      }

      const inlineMatch = line.match(/^(\s*)\$\s*([^$\n]+?)\s*\$(\s*)$/);
      if (inlineMatch) {
        return toDisplayMathBlock(inlineMatch[1], inlineMatch[2]);
      }

      const bracketMatch = line.match(/^(\s*)\\\[\s*(.+?)\s*\\\](\s*)$/);
      if (bracketMatch) {
        return toDisplayMathBlock(bracketMatch[1], bracketMatch[2]);
      }

      const parenMatch = line.match(/^(\s*)\\\(\s*(.+?)\s*\\\)(\s*)$/);
      if (parenMatch) {
        return toDisplayMathBlock(parenMatch[1], parenMatch[2]);
      }

      const labeledInlineMatch = line.match(/^(\s*)([^$]{1,28}[:：])\s*\$\s*([^$\n]+?)\s*\$(\s*)$/);
      if (labeledInlineMatch) {
        return `${labeledInlineMatch[1]}${labeledInlineMatch[2]}\n\n${toDisplayMathBlock(
          labeledInlineMatch[1],
          labeledInlineMatch[3]
        )}`;
      }

      return line;
    })
    .join("\n");
}

function plainMarkdownText(value: string) {
  return value
    .replace(/[`*_~#[\]()>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldOpenSectionByDefault(title: string) {
  return /简单理解|简单来说|简单说|简短解释|简短含义|一句话|核心理解|记忆句/.test(
    title
  );
}

function sectionMatchesQuery(section: MarkdownSection, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return false;
  }

  return `${section.title}\n${section.content}`.toLowerCase().includes(normalizedQuery);
}

function splitMarkdownSections(body: string) {
  const lines = body.split("\n");
  const intro: string[] = [];
  const sections: MarkdownSection[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (!headingMatch) {
      if (current) {
        current.lines.push(line);
      } else {
        intro.push(line);
      }
      continue;
    }

    if (current) {
      const title = plainMarkdownText(current.title);
      sections.push({
        id: `${sections.length}-${title}`,
        title,
        content: current.lines.join("\n").trim(),
        defaultOpen: shouldOpenSectionByDefault(title),
      });
    }

    current = {
      title: headingMatch[1],
      lines: [],
    };
  }

  if (current) {
    const title = plainMarkdownText(current.title);
    sections.push({
      id: `${sections.length}-${title}`,
      title,
      content: current.lines.join("\n").trim(),
      defaultOpen: shouldOpenSectionByDefault(title),
    });
  }

  return {
    intro: intro.join("\n").trim(),
    sections,
  };
}

function buildDraftFromAi(
  card: KnowledgeCard,
  result: Awaited<ReturnType<typeof explainWithActiveProvider>>
): KnowledgeCard {
  const structuredDraft = result.structuredDraft || structuredDraftFromText(result.rawAnswer);
  const body = normalizeStandaloneMath(
    draftBodyFromStructured(structuredDraft, result.rawAnswer)
  );
  const nextTags = structuredDraft?.tags?.length
    ? Array.from(new Set([...card.tags, ...structuredDraft.tags]))
    : card.tags;

  return {
    ...card,
    term: structuredDraft?.term || card.term,
    pronunciation:
      cleanPronunciation(structuredDraft?.pronunciation) ||
      cleanPronunciation(card.pronunciation),
    sourceContext: structuredDraft?.sourceContext || card.sourceContext,
    body: body || card.body,
    tags: nextTags,
    providerId: result.providerId,
    model: result.model,
    updatedAt: nowIso(),
  };
}

function MarkdownPreview({
  body,
  compactSections = false,
  searchQuery = "",
  onSectionFocus,
}: {
  body: string;
  compactSections?: boolean;
  searchQuery?: string;
  onSectionFocus?: (sectionId: string) => void;
}) {
  const normalizedBody = useMemo(
    () => normalizeStandaloneMath(unwrapAiWrappedBody(body)),
    [body]
  );
  const sectionedBody = useMemo(
    () => splitMarkdownSections(normalizedBody),
    [normalizedBody]
  );
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!compactSections) {
      return;
    }

    const nextOpenSections: Record<string, boolean> = {};
    sectionedBody.sections.forEach((section) => {
      nextOpenSections[section.id] =
        section.defaultOpen || sectionMatchesQuery(section, searchQuery);
    });
    setOpenSections(nextOpenSections);
  }, [compactSections, normalizedBody, searchQuery, sectionedBody.sections]);

  if (!body.trim()) {
    return (
      <div className="preview-empty">
        <BookOpen size={22} />
        <span>正文为空。切到编辑写一点，或者让 AI 先解释。</span>
      </div>
    );
  }

  const markdownComponents = {
    a: ({
      children,
      ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) => (
      <a {...props} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),
  };

  if (!compactSections || sectionedBody.sections.length < 2) {
    return (
      <ReactMarkdown
        className="markdown-preview"
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={markdownComponents}
      >
        {normalizedBody}
      </ReactMarkdown>
    );
  }

  const allOpen = sectionedBody.sections.every(
    (section) => openSections[section.id] ?? section.defaultOpen
  );

  function setAllSections(open: boolean) {
    const nextOpenSections: Record<string, boolean> = {};
    sectionedBody.sections.forEach((section) => {
      nextOpenSections[section.id] = open;
    });
    setOpenSections(nextOpenSections);
  }

  return (
    <div className="markdown-preview markdown-preview-compact">
      <div className="section-preview-toolbar">
        <span>{sectionedBody.sections.length} 个段落</span>
        <button type="button" onClick={() => setAllSections(!allOpen)}>
          {allOpen ? "收起全部" : "展开全部"}
        </button>
      </div>

      {sectionedBody.intro && (
        <ReactMarkdown
          className="markdown-preview-intro"
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeRaw, rehypeKatex]}
          components={markdownComponents}
        >
          {sectionedBody.intro}
        </ReactMarkdown>
      )}

      <div className="markdown-sections">
        {sectionedBody.sections.map((section) => {
          const isOpen = openSections[section.id] ?? section.defaultOpen;
          const matched = sectionMatchesQuery(section, searchQuery);

          return (
            <section
              key={section.id}
              className={`markdown-section ${isOpen ? "open" : ""} ${
                matched ? "matched" : ""
              }`}
            >
              <button
                type="button"
                className="markdown-section-toggle"
                onClick={() => {
                  onSectionFocus?.(section.id);
                  setOpenSections((current) => ({
                    ...current,
                    [section.id]: !isOpen,
                  }));
                }}
                aria-expanded={isOpen}
              >
                {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span>{section.title}</span>
              </button>

              {isOpen && (
                <div onClick={() => onSectionFocus?.(section.id)}>
                  <ReactMarkdown
                    className="markdown-section-body"
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeRaw, rehypeKatex]}
                    components={markdownComponents}
                  >
                    {section.content || " "}
                  </ReactMarkdown>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function titleVisualLength(value: string) {
  return Array.from(value.trim().replace(/\s+/g, " ")).reduce((total, char) => {
    return total + (char.charCodeAt(0) > 255 ? 1.8 : 1);
  }, 0);
}

function mobileTitleFontSize(term: string) {
  const length = titleVisualLength(term);

  if (length <= 13) {
    return undefined;
  }
  if (length <= 17) {
    return "36px";
  }
  if (length <= 22) {
    return "31px";
  }
  if (length <= 28) {
    return "27px";
  }
  return "23px";
}

function modelRouteText(route: AiRouteDisplay, includeTask = false) {
  const prefix = includeTask && route.taskType ? `${taskLabel(route.taskType)}：` : "";
  return `${prefix}${route.providerLabel} / ${route.model}`;
}

function stripLeadingSectionHeading(body: string, title: string) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body
    .replace(new RegExp(`^\\s*##\\s+${escapedTitle}\\s*\\n+`, "i"), "")
    .trim();
}

function sectionForReview(body: string, activeSectionId: string) {
  const parsed = splitMarkdownSections(normalizeStandaloneMath(unwrapAiWrappedBody(body)));
  const selected =
    parsed.sections.find((section) => section.id === activeSectionId) ||
    parsed.sections.find((section) => section.defaultOpen) ||
    parsed.sections[0] ||
    (parsed.intro
      ? {
          id: "intro",
          title: "正文开头",
          content: parsed.intro,
          defaultOpen: true,
        }
      : undefined);

  return {
    parsed,
    selected,
  };
}

function replaceMarkdownSection(
  body: string,
  targetSection: MarkdownSection,
  nextSectionBody: string
) {
  const parsed = splitMarkdownSections(normalizeStandaloneMath(unwrapAiWrappedBody(body)));
  const cleanedNextBody = stripLeadingSectionHeading(
    normalizeStandaloneMath(unwrapAiWrappedBody(nextSectionBody)),
    targetSection.title
  );
  if (targetSection.id === "intro" && !parsed.sections.length) {
    return cleanedNextBody;
  }
  const sectionBlocks = parsed.sections.map((section) => {
    const content = section.id === targetSection.id ? cleanedNextBody : section.content;
    return `## ${section.title}\n\n${content}`.trim();
  });

  const intro = targetSection.id === "intro" ? cleanedNextBody : parsed.intro;
  return [intro, ...sectionBlocks].filter(Boolean).join("\n\n").trim();
}

function aiActionLabel(action: AiActionKind) {
  if (action === "quick") {
    return "快速解释";
  }
  if (action === "polish") {
    return "高质量整理";
  }
  if (action === "review_section") {
    return "专家审阅当前段落";
  }
  if (action === "review_full") {
    return "专家审阅全文";
  }
  return "补标签和相关词";
}

function canonicalTag(tag: string) {
  const normalized = normalizeTagKey(tag);
  const map: Record<string, string> = {
    dl: "深度学习",
    "deep learning": "深度学习",
    深度学习: "深度学习",
    ml: "机器学习",
    "machine learning": "机器学习",
    机器学习: "机器学习",
    rl: "强化学习",
    "reinforcement learning": "强化学习",
    强化学习: "强化学习",
    robotics: "机器人控制",
    robot: "机器人控制",
    "robot control": "机器人控制",
    "robotics control": "机器人控制",
    机器人: "机器人控制",
    机器人控制: "机器人控制",
    机器人运动控制: "机器人控制",
    simulation: "仿真评测",
    eval: "仿真评测",
    evaluation: "仿真评测",
    仿真: "仿真评测",
    评测: "仿真评测",
    仿真评测: "仿真评测",
    retargeting: "motion retargeting",
    "motion retargeting": "motion retargeting",
    重定向: "motion retargeting",
    gmr: "GMR",
    ppo: "PPO",
    policy: "policy",
    rollout: "rollout",
    debug: "debug",
  };

  return map[normalized] || tag.trim();
}

function normalizeTagKey(tag: string) {
  return tag.trim().replace(/\s+/g, " ").toLowerCase();
}

function isAllCapsTag(tag: string) {
  return /^[A-Z0-9][A-Z0-9.+#-]{1,9}$/.test(tag.trim());
}

function safeAliasTarget(target: string) {
  const canonical = canonicalTag(target).trim();
  if (!canonical || canonical.length > 36 || /[,，;；/、\n]/.test(canonical)) {
    return "";
  }
  return canonical;
}

function shouldAcceptAlias(source: string, target: string) {
  const sourceCanonical = canonicalTag(source);
  const targetCanonical = safeAliasTarget(target);
  if (!sourceCanonical || !targetCanonical) {
    return false;
  }
  if (normalizeTagKey(sourceCanonical) === normalizeTagKey(targetCanonical)) {
    return true;
  }
  if (PROTECTED_DISTINCT_TAGS.has(sourceCanonical)) {
    return false;
  }
  if (
    isAllCapsTag(sourceCanonical) &&
    ["深度学习", "机器学习", "强化学习", "机器人控制", "仿真评测"].includes(targetCanonical)
  ) {
    return false;
  }
  return true;
}

function parseTagAliasMap(rawAnswer: string) {
  const withoutFence = rawAnswer
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const jsonText =
    firstBrace >= 0 && lastBrace > firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;

  try {
    const parsed = JSON.parse(jsonText);
    const aliases = parsed?.aliases && typeof parsed.aliases === "object" ? parsed.aliases : parsed;
    const nextAliases: TagAliasMap = {};
    Object.entries(aliases || {}).forEach(([source, target]) => {
      if (typeof target !== "string") {
        return;
      }
      if (!shouldAcceptAlias(source, target)) {
        return;
      }
      const canonicalSource = canonicalTag(source);
      const canonicalTarget = safeAliasTarget(target);
      if (canonicalSource && canonicalTarget) {
        nextAliases[normalizeTagKey(source)] = canonicalTarget;
        nextAliases[normalizeTagKey(canonicalSource)] = canonicalTarget;
      }
    });
    return nextAliases;
  } catch {
    throw new Error("模型没有返回可识别的标签别名 JSON。");
  }
}

function sortTags(tags: string[]) {
  return [...tags].sort((left, right) => {
    const leftIndex = PREFERRED_TAG_ORDER.indexOf(left);
    const rightIndex = PREFERRED_TAG_ORDER.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) {
      return (leftIndex >= 0 ? leftIndex : 999) - (rightIndex >= 0 ? rightIndex : 999);
    }
    return left.localeCompare(right);
  });
}

function mergeExistingTags(existingTags: string[], aliasMap: TagAliasMap = {}) {
  const unique = new Map<string, string>();
  existingTags.forEach((tag) => {
    const localCanonical = canonicalTag(tag);
    const aliased =
      aliasMap[normalizeTagKey(tag)] ||
      aliasMap[normalizeTagKey(localCanonical)] ||
      localCanonical;
    const target = safeAliasTarget(aliased);
    if (target) {
      unique.set(normalizeTagKey(target), target);
    }
  });
  return sortTags(Array.from(unique.values()));
}

function sameTagList(left: string[], right: string[]) {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function buildTagMergeInventory(cards: KnowledgeCard[]) {
  const inventory = new Map<string, { tag: string; terms: string[] }>();
  cards.forEach((card) => {
    card.tags.forEach((tag) => {
      const trimmed = tag.trim();
      if (!trimmed) {
        return;
      }
      const key = normalizeTagKey(trimmed);
      const item = inventory.get(key) || { tag: trimmed, terms: [] };
      if (card.term.trim() && item.terms.length < 3 && !item.terms.includes(card.term.trim())) {
        item.terms.push(card.term.trim());
      }
      inventory.set(key, item);
    });
  });

  return Array.from(inventory.values()).sort((left, right) => left.tag.localeCompare(right.tag));
}

function applyTagAliasesToCards(cards: KnowledgeCard[], aliasMap: TagAliasMap = {}) {
  return cards
    .map((card) => {
      const nextTags = mergeExistingTags(card.tags, aliasMap);
      if (sameTagList(card.tags, nextTags)) {
        return null;
      }
      return normalizeKnowledgeCard({
        ...card,
        tags: nextTags,
        updatedAt: nowIso(),
      });
    })
    .filter((card): card is KnowledgeCard => Boolean(card));
}

function preferredActionModel(provider: ProviderConfig, preference: "balanced" | "cheap" | "frontier") {
  const models = Array.from(new Set([provider.defaultModel, ...provider.models].filter(Boolean)));
  const candidates =
    preference === "cheap"
      ? provider.id === "deepseek"
        ? ["deepseek-v4-flash", "deepseek-chat"]
        : ["gpt-5.4-mini", "gpt-5-mini", "gpt-4o-mini"]
      : preference === "frontier"
        ? provider.id === "deepseek"
          ? ["deepseek-v4-pro", "deepseek-reasoner", "deepseek-v4-flash"]
          : ["gpt-5.5", "gpt-5.5-pro", "gpt-5.4"]
        : provider.id === "deepseek"
          ? ["deepseek-v4-pro", "deepseek-reasoner", "deepseek-v4-flash"]
          : ["gpt-5.4", "gpt-5", "gpt-4.1", "gpt-5.4-mini"];

  return candidates.find((model) => models.includes(model)) || provider.defaultModel;
}

function App() {
  const forceMobilePreview = useMemo(() => hasMobilePreviewParam(), []);
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<KnowledgeCard>(createEmptyCard());
  const [selectedId, setSelectedId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState("");
  const [view, setView] = useState<View>("library");
  const [libraryMode, setLibraryMode] = useState<LibraryMode>("views");
  const [activeKnowledgeViewId, setActiveKnowledgeViewId] = useState("");
  const [editorMode, setEditorMode] = useState<EditorMode>("edit");
  const [mobilePane, setMobilePane] = useState<MobilePane>("detail");
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [mobileAiOpen, setMobileAiOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState("");
  const [mobileLayout, setMobileLayout] = useState(() =>
    isMobileLayoutPreferred(forceMobilePreview)
  );
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standaloneDisplay, setStandaloneDisplay] = useState(() => isStandaloneDisplay());
  const [installHintDismissed, setInstallHintDismissed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === "1";
  });
  const [loading, setLoading] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [memoryStatus, setMemoryStatus] = useState("");
  const [aiRouteDisplay, setAiRouteDisplay] = useState<AiRouteDisplay | null>(null);
  const [syncStatus, setSyncStatus] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 860px), (pointer: coarse)");
    const updateLayout = () => setMobileLayout(forceMobilePreview || mediaQuery.matches);
    updateLayout();

    if ("addEventListener" in mediaQuery) {
      mediaQuery.addEventListener("change", updateLayout);
      return () => mediaQuery.removeEventListener("change", updateLayout);
    }

    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener: (listener: () => void) => void;
      removeListener: (listener: () => void) => void;
    };
    legacyMediaQuery.addListener(updateLayout);
    return () => legacyMediaQuery.removeListener(updateLayout);
  }, [forceMobilePreview]);

  useEffect(() => {
    document.documentElement.classList.toggle("mobile-preview", forceMobilePreview);
    return () => document.documentElement.classList.remove("mobile-preview");
  }, [forceMobilePreview]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setStandaloneDisplay(true);
      setInstallPrompt(null);
      setInstallHintDismissed(true);
      window.localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, "1");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function openLocalAndSync() {
      try {
        const [storedCards, storedSettings, storedUsageRecords] = await Promise.all([
          listCards(),
          loadSettings(),
          listUsageRecords(),
        ]);
        let nextCards = storedCards;
        let nextSettings = storedSettings;
        let nextUsageRecords = storedUsageRecords;
        let nextStatus = "";
        let nextSyncStatus = "";

        try {
          const detectedBaseUrl = storedSettings.backendSync.baseUrl || "";
          const serverSyncStatus = await fetchSyncStatus(detectedBaseUrl);
          if (serverSyncStatus.trustedAutoSync) {
            nextSettings = {
              ...storedSettings,
              backendSync: {
                ...storedSettings.backendSync,
                enabled: true,
                baseUrl: detectedBaseUrl,
                trustedAutoSync: true,
                pendingChanges: false,
              },
            };
          }
        } catch (_syncStatusError) {
          // Sync status is best-effort; local-only mode still works.
        }

        if (canUseBackendSync(nextSettings)) {
          try {
            const snapshot = await fetchSyncSnapshot(nextSettings);
            const syncedAt = nowIso();
            const backendHasContent = !snapshot.syncMeta.isEmpty;

            if (snapshot.settings) {
              nextSettings = mergeRemoteSettings(snapshot.settings, nextSettings, {
                lastSyncedAt: syncedAt,
                pendingChanges: false,
                trustedAutoSync: nextSettings.backendSync.trustedAutoSync,
              });
            } else {
              nextSettings = {
                ...nextSettings,
                backendSync: {
                  ...nextSettings.backendSync,
                  lastSyncedAt: syncedAt,
                  pendingChanges: false,
                },
              };
            }
            await saveSettings(nextSettings);

            if (backendHasContent || !storedCards.length) {
              nextCards = sortCardsByUpdatedAt(snapshot.cards);
              await replaceCards(nextCards);
            } else if (nextSettings.backendSync.trustedAutoSync) {
              await pushCardsToSync(nextSettings, storedCards);
              await pushSettingsToSync(nextSettings);
              if (storedUsageRecords.length) {
                await pushUsageToSync(nextSettings, storedUsageRecords);
              }
              nextCards = sortCardsByUpdatedAt(storedCards);
              nextStatus = `已自动把本机 ${storedCards.length} 张卡片上传到后端。`;
              nextSyncStatus = "可信自动同步已启用。";
            } else {
              nextStatus = "后端词库还是空的。确认首次同步后，可以在设置里上传本机数据到后端。";
            }

            if (snapshot.usageRecords.length) {
              await saveUsageRecordsToDb(snapshot.usageRecords);
              nextUsageRecords = await listUsageRecords();
            }

            nextSyncStatus =
              nextStatus || `已从后端同步：${snapshot.cards.length} 张卡片。`;
          } catch (syncError) {
            nextSettings = {
              ...nextSettings,
              backendSync: {
                ...nextSettings.backendSync,
                pendingChanges: true,
              },
            };
            await saveSettings(nextSettings);
            nextSyncStatus = `后端暂不可用，已打开本地缓存：${
              syncError instanceof Error ? syncError.message : "同步失败"
            }`;
          }
        }

        if (cancelled) {
          return;
        }

        setCards(nextCards);
        setSettings(nextSettings);
        setUsageRecords(nextUsageRecords);
        setSyncStatus(nextSyncStatus);
        if (nextStatus) {
          setStatus(nextStatus);
        }
        if (launchParam("pane") === "library") {
          setMobilePane("library");
        }
        if (launchParam("action") === "new") {
          setSelectedId("");
          setDraft(createEmptyCard());
          setEditorMode("edit");
          setMobilePane("detail");
          setStatus("已准备一张新卡片。");
        } else if (nextCards[0]) {
          setSelectedId(nextCards[0].id);
          setDraft(cloneCard(nextCards[0]));
          setEditorMode("preview");
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "加载本地数据失败。");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    openLocalAndSync();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cleanedBody = unwrapAiWrappedBody(draft.body);
    if (cleanedBody && cleanedBody !== draft.body) {
      setDraft((current) =>
        current.id === draft.id
          ? normalizeKnowledgeCard({
              ...current,
              body: cleanedBody,
            })
          : current
      );
      setStatus("已自动清理这张卡片里的 AI JSON 外壳，确认后保存即可。");
      setError("");
    }
  }, [draft.id, draft.body]);

  useEffect(() => {
    const cleanedPronunciation = cleanPronunciation(draft.pronunciation);
    if (draft.pronunciation && cleanedPronunciation !== draft.pronunciation) {
      setDraft((current) =>
        current.id === draft.id
          ? {
              ...current,
              pronunciation: cleanedPronunciation,
            }
          : current
      );
    }
  }, [draft.id, draft.pronunciation]);

  const knowledgeViews = useMemo(() => buildKnowledgeViews(cards), [cards]);
  const activeKnowledgeView = useMemo(() => {
    if (libraryMode !== "views") {
      return undefined;
    }
    return (
      knowledgeViews.find((knowledgeView) => knowledgeView.id === activeKnowledgeViewId) ||
      knowledgeViews[0]
    );
  }, [activeKnowledgeViewId, knowledgeViews, libraryMode]);
  const libraryCards = useMemo(
    () => (libraryMode === "views" && activeKnowledgeView ? activeKnowledgeView.cards : cards),
    [activeKnowledgeView, cards, libraryMode]
  );
  const tags = useMemo(() => collectTags(libraryCards), [libraryCards]);
  const filteredCards = useMemo(
    () => searchCards(libraryCards, query, activeTag),
    [activeTag, libraryCards, query]
  );
  const relatedCards = useMemo(
    () => findRelatedCards(draft, cards, 5),
    [cards, draft]
  );
  const activeProvider = settings ? settings.providers[settings.activeProvider] : null;
  const shownProvider = draft.providerId && settings ? settings.providers[draft.providerId] : null;
  const fallbackModelDisplay: AiRouteDisplay = aiBusy
    ? {
        providerId: settings?.activeProvider || "openai",
        providerLabel: activeProvider?.label || "AI",
        model: activeProvider?.defaultModel || "准备中",
        taskType: undefined,
      }
    : {
        providerId: draft.providerId || settings?.activeProvider || "openai",
        providerLabel: shownProvider?.label || activeProvider?.label || "AI",
        model: draft.model || activeProvider?.defaultModel || "未配置",
        taskType: undefined,
      };
  const modelDisplay = aiRouteDisplay || fallbackModelDisplay;
  const budgetSummary = useMemo(
    () => (settings ? getBudgetSummary(settings, usageRecords) : null),
    [settings, usageRecords]
  );
  const recentUsageRecords = useMemo(
    () => usageRecords.slice(0, 8),
    [usageRecords]
  );
  const persistedDraft = cards.some((card) => card.id === draft.id);
  const showInstallHint =
    mobileLayout &&
    !standaloneDisplay &&
    !installHintDismissed &&
    (Boolean(installPrompt) || isIosLikeDevice());

  function syncErrorMessage(syncError: unknown) {
    return syncError instanceof Error ? syncError.message : "同步失败";
  }

  async function applyBackendSyncPatch(
    patch: Partial<AppSettings["backendSync"]>,
    baseSettings = settings
  ) {
    if (!baseSettings) {
      return undefined;
    }

    const nextSettings = {
      ...baseSettings,
      backendSync: {
        ...baseSettings.backendSync,
        ...patch,
      },
    };

    await saveSettings(nextSettings);
    setSettings(nextSettings);
    return nextSettings;
  }

  function updateDraft<K extends keyof KnowledgeCard>(key: K, value: KnowledgeCard[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function selectCard(card: KnowledgeCard) {
    setSelectedId(card.id);
    setDraft(cloneCard(card));
    setEditorMode("preview");
    setMobilePane("detail");
    setMobileMoreOpen(false);
    setMobileAiOpen(false);
    setActiveSectionId("");
    setStatus("");
    setError("");
    setMemoryStatus("");
    setAiRouteDisplay(null);
  }

  function startNewCard() {
    const next = createEmptyCard();
    setSelectedId("");
    setDraft(next);
    setEditorMode("edit");
    setMobilePane("detail");
    setMobileMoreOpen(false);
    setMobileAiOpen(false);
    setActiveSectionId("");
    setStatus("已准备一张新卡片。");
    setError("");
    setMemoryStatus("");
    setAiRouteDisplay(null);
    setView("library");
  }

  function showMobileLibrary() {
    setMobilePane("library");
    setMobileMoreOpen(false);
    setMobileAiOpen(false);
  }

  function showMobileDetail() {
    setMobilePane("detail");
    setMobileMoreOpen(false);
    setMobileAiOpen(false);
  }

  function showAllLibraryCards() {
    setLibraryMode("all");
    setActiveTag("");
  }

  function selectKnowledgeView(viewId: string) {
    setLibraryMode("views");
    setActiveKnowledgeViewId(viewId);
    setActiveTag("");
  }

  function toggleEditorMode() {
    setEditorMode((current) => (current === "edit" ? "preview" : "edit"));
    setMobileMoreOpen(false);
    setMobileAiOpen(false);
  }

  function toggleMobileAiPanel() {
    setMobileAiOpen((current) => !current);
    setMobileMoreOpen(false);
  }

  function cancelAiRequest() {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setAiBusy(false);
    setStatus("已取消本次 AI 请求；当前正文没有被覆盖。");
    setError("");
  }

  function openModelSettings() {
    setMobileMoreOpen(false);
    setMobileAiOpen(false);
    setView("settings");
  }

  function openImportPicker() {
    setMobileMoreOpen(false);
    setMobileAiOpen(false);
    importInputRef.current?.click();
  }

  function exportFromMobileMenu() {
    setMobileMoreOpen(false);
    setMobileAiOpen(false);
    handleExport();
  }

  function dismissInstallHint() {
    setInstallHintDismissed(true);
    window.localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, "1");
  }

  async function handleInstallApp() {
    if (!installPrompt) {
      dismissInstallHint();
      return;
    }

    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => undefined);
    setInstallPrompt(null);
    dismissInstallHint();
  }

  async function handleSaveCard() {
    const term = draft.term.trim();
    const body = draft.body.trim();

    if (!term) {
      setError("请至少填写术语或术语组标题。");
      return;
    }

    if (!body) {
      setError("请填写正文解释，或先用 AI 生成一段解释。");
      return;
    }

    const stamp = nowIso();
    const nextCard = normalizeKnowledgeCard({
      ...draft,
      term,
      body,
      pronunciation: cleanPronunciation(draft.pronunciation),
      tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
      updatedAt: stamp,
      createdAt: draft.createdAt || stamp,
    });

    await saveCardToDb(nextCard);
    setCards((current) =>
      [nextCard, ...current.filter((card) => card.id !== nextCard.id)].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      )
    );
    setDraft(cloneCard(nextCard));
    setSelectedId(nextCard.id);
    setEditorMode("preview");
    setStatus("卡片已保存。");
    setError("");

    const syncSettings = settings;
    if (canUseBackendSync(syncSettings)) {
      try {
        await pushCardsToSync(syncSettings, [nextCard]);
        await applyBackendSyncPatch({
          lastSyncedAt: nowIso(),
          pendingChanges: false,
        });
        setStatus("卡片已保存并同步到后端。");
        setSyncStatus("后端同步正常。");
      } catch (syncError) {
        await applyBackendSyncPatch({ pendingChanges: true });
        setStatus("卡片已保存到本地，后端暂不可用，稍后可手动同步。");
        setSyncStatus(`本地待同步：${syncErrorMessage(syncError)}`);
      }
    }
  }

  async function handleDeleteCard() {
    if (!persistedDraft) {
      startNewCard();
      return;
    }

    const confirmed = window.confirm(`删除「${draft.term}」这张卡片？`);
    if (!confirmed) {
      return;
    }

    const deletedId = draft.id;
    const deletedAt = nowIso();
    await deleteCardFromDb(draft.id);
    const remaining = cards.filter((card) => card.id !== draft.id);
    setCards(remaining);
    if (remaining[0]) {
      setSelectedId(remaining[0].id);
      setDraft(cloneCard(remaining[0]));
      setEditorMode("preview");
    } else {
      startNewCard();
    }
    setStatus("卡片已删除。");
    setError("");

    const syncSettings = settings;
    if (canUseBackendSync(syncSettings)) {
      try {
        await deleteCardFromSync(syncSettings, deletedId, deletedAt);
        await clearPendingDelete(deletedId);
        await applyBackendSyncPatch({
          lastSyncedAt: nowIso(),
          pendingChanges: false,
        });
        setStatus("卡片已删除并同步到后端。");
        setSyncStatus("后端同步正常。");
      } catch (syncError) {
        await savePendingDelete({ id: deletedId, deletedAt });
        await applyBackendSyncPatch({ pendingChanges: true });
        setStatus("卡片已从本地删除，后端暂不可用，稍后可手动同步。");
        setSyncStatus(`本地待同步：${syncErrorMessage(syncError)}`);
      }
    }
  }

  async function persistUsageRecord(record: UsageRecord) {
    await saveUsageRecord(record);
    const nextRecords = await listUsageRecords();
    setUsageRecords(nextRecords);

    const syncSettings = settings;
    if (canUseBackendSync(syncSettings)) {
      try {
        await pushUsageToSync(syncSettings, [record]);
        await applyBackendSyncPatch({
          lastSyncedAt: nowIso(),
          pendingChanges: false,
        });
      } catch (syncError) {
        await applyBackendSyncPatch({ pendingChanges: true });
        setSyncStatus(`用量记录已保存在本地，后端待同步：${syncErrorMessage(syncError)}`);
      }
    }
  }

  function buildAiRequestForCard(
    card: KnowledgeCard,
    taskType: AiTaskType,
    relatedCards = settings?.memoryEnabled ? findRelatedMemoryCards(card, cards, 3) : [],
    pastedRawAnswer = card.body
  ): AiExplainRequest {
    return {
      term: card.term,
      sourceContext: card.sourceContext,
      pastedRawAnswer,
      taskType,
      memoryContext: settings?.memoryEnabled
        ? {
            personalPreference: settings.personalPreference,
            relatedCards,
          }
        : undefined,
    };
  }

  async function runAiTaskForCard(
    card: KnowledgeCard,
    taskType: AiTaskType,
    options: {
      signal?: AbortSignal;
      pastedRawAnswer?: string;
      forceEconomy?: boolean;
      statusLabel?: string;
      modelPreference?: "balanced" | "cheap" | "frontier";
      providerId?: AiProviderId;
    } = {}
  ) {
    if (!settings) {
      throw new Error("设置还没有加载完成。");
    }

    if (!card.term.trim() && !card.body.trim()) {
      throw new Error("请先输入术语，或粘贴一段 GPT/DeepSeek 回答到正文。");
    }

    const relatedCards = settings.memoryEnabled
      ? findRelatedMemoryCards(card, cards, 3)
      : [];
    const request = buildAiRequestForCard(
      card,
      taskType,
      relatedCards,
      options.pastedRawAnswer ?? card.body
    );
    const routeSettings =
      options.providerId && settings.providers[options.providerId]
        ? {
            ...settings,
            activeProvider: options.providerId,
          }
        : settings;
    let routed = routeProviderForTask(
      routeSettings,
      request,
      Boolean(options.forceEconomy)
    );
    if (options.modelPreference) {
      routed = {
        ...routed,
        provider: {
          ...routed.provider,
          defaultModel: preferredActionModel(routed.provider, options.modelPreference),
        },
        routeReason: `${routed.routeReason} / ${options.modelPreference}`,
      };
    }
    const estimate = estimateAiRequest(routed.provider, request);
    const dateKey = budgetDateKey();
    const routedDisplay: AiRouteDisplay = {
      providerId: routed.providerId,
      providerLabel: routed.provider.label,
      model: routed.provider.defaultModel,
      taskType,
    };
    setAiRouteDisplay(routedDisplay);
    setStatus(
      `正在用 ${modelRouteText(routedDisplay)} ${
        options.statusLabel ||
        (taskType === "review" ? "专家审阅" : taskType === "summarize" ? "后台整理" : "解释/整理")
      }...`
    );

    const startedAt = performance.now();
    try {
      const result = await explainWithActiveProvider(settings, request, routed.provider, {
        signal: options.signal,
      });
      const actualDisplay: AiRouteDisplay = {
        providerId: routed.providerId,
        providerLabel: routed.provider.label,
        model: result.model,
        taskType,
      };
      setAiRouteDisplay(actualDisplay);
      const inputTokens = result.usage?.inputTokens || estimate.inputTokens;
      const outputTokens = result.usage?.outputTokens || estimateTokens(result.rawAnswer);
      const usageSource = result.usage?.source || "estimate";
      const durationMs = result.durationMs || Math.round(performance.now() - startedAt);
      const nextCard = buildDraftFromAi(card, result);
      await persistUsageRecord({
        id: createId("usage"),
        dateKey,
        createdAt: nowIso(),
        providerId: routed.providerId,
        providerLabel: routed.provider.label,
        model: result.model,
        taskType,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCostFromTokens(
          {
            ...routed.provider,
            defaultModel: result.model,
          },
          inputTokens,
          outputTokens
        ),
        usageSource,
        durationMs,
        status: "success",
        routeReason: routed.routeReason,
      });

      return {
        nextCard,
        memoryStatus: memoryHint(relatedCards, settings.memoryEnabled),
        routed,
      };
    } catch (aiError) {
      const aborted =
        (aiError instanceof DOMException && aiError.name === "AbortError") ||
        (aiError instanceof Error && /abort/i.test(aiError.name || aiError.message));
      await persistUsageRecord({
        id: createId("usage"),
        dateKey,
        createdAt: nowIso(),
        providerId: routed.providerId,
        providerLabel: routed.provider.label,
        model: routed.provider.defaultModel,
        taskType,
        inputTokens: estimate.inputTokens,
        outputTokens: 0,
        estimatedCostUsd: estimate.estimatedCostUsd,
        usageSource: "estimate",
        durationMs: Math.round(performance.now() - startedAt),
        status: "failed",
        routeReason: routed.routeReason,
        error: aborted
          ? "用户取消了本次请求。"
          : aiError instanceof Error
            ? aiError.message
            : "AI 请求失败。",
      });
      if (aborted) {
        throw new Error("AI 请求已取消，当前正文没有被覆盖。");
      }
      throw aiError;
    }
  }

  async function handleAiExplain() {
    setAiBusy(true);
    setError("");
    setAiRouteDisplay(null);
    setMobileAiOpen(false);
    const controller = new AbortController();
    aiAbortRef.current = controller;

    const relatedCards = settings?.memoryEnabled
      ? findRelatedMemoryCards(draft, cards, 3)
      : [];
    const nextMemoryStatus = memoryHint(relatedCards, Boolean(settings?.memoryEnabled));
    setMemoryStatus(nextMemoryStatus);
    setStatus(`正在准备 AI 请求... ${nextMemoryStatus}`);

    try {
      const result = await runAiTaskForCard(draft, "explain", {
        signal: controller.signal,
      });
      setDraft(cloneCard(result.nextCard));
      setEditorMode("preview");
      setStatus(
        `AI 已写入正文，确认后保存。${result.memoryStatus ? ` ${result.memoryStatus}` : ""}`
      );
    } catch (aiError) {
      const message = aiError instanceof Error ? aiError.message : "AI 请求失败。";
      if (message.includes("已取消")) {
        setStatus(message);
        setError("");
        return;
      }
      const hint = isFetchLikeError(aiError)
        ? "请求没有完成，请确认本地 AI 代理正在运行；使用 npm run dev 会同时启动前端和代理。"
        : "";
      setError(
        `${message}${hint ? ` ${hint}` : ""}`
      );
      setStatus("");
    } finally {
      setAiBusy(false);
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
      }
    }
  }

  async function handleAiReview() {
    if (!draft.body.trim()) {
      setError("请先有正文内容，再做专家审阅。");
      return;
    }

    setAiBusy(true);
    setError("");
    setAiRouteDisplay(null);
    setStatus("正在准备专家审阅请求...");
    setMobileAiOpen(false);
    const controller = new AbortController();
    aiAbortRef.current = controller;

    try {
      const result = await runAiTaskForCard(draft, "review", {
        signal: controller.signal,
      });
      setDraft(cloneCard(result.nextCard));
      setEditorMode("preview");
      setStatus("专家审阅已写入正文，确认后保存。");
    } catch (aiError) {
      const message = aiError instanceof Error ? aiError.message : "专家审阅失败。";
      if (message.includes("已取消")) {
        setStatus(message);
        setError("");
        return;
      }
      const hint = isFetchLikeError(aiError)
        ? "请求没有完成，请确认本地 AI 代理正在运行；使用 npm run dev 会同时启动前端和代理。"
        : "";
      setError(
        `${message}${hint ? ` ${hint}` : ""}`
      );
      setStatus("");
    } finally {
      setAiBusy(false);
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
      }
    }
  }

  async function handleAiAction(action: AiActionKind) {
    if (action === "review_full") {
      await handleAiReview();
      return;
    }

    if (action === "review_section" && !draft.body.trim()) {
      setError("请先有正文内容，再审阅当前段落。");
      return;
    }

    setAiBusy(true);
    setError("");
    setAiRouteDisplay(null);
    setMobileAiOpen(false);
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const label = aiActionLabel(action);

    try {
      if (action === "review_section") {
        const { selected } = sectionForReview(draft.body, activeSectionId);
        if (!selected) {
          throw new Error("没有找到可审阅的 Markdown 段落。");
        }
        setActiveSectionId(selected.id);
        setStatus(`正在准备${label}：${selected.title}...`);
        const result = await runAiTaskForCard(draft, "review", {
          signal: controller.signal,
          pastedRawAnswer: selected.content,
          statusLabel: label,
          modelPreference: "frontier",
        });
        const nextBody = replaceMarkdownSection(draft.body, selected, result.nextCard.body);
        setDraft(
          cloneCard({
            ...draft,
            body: nextBody,
            providerId: result.nextCard.providerId,
            model: result.nextCard.model,
            updatedAt: nowIso(),
          })
        );
        setEditorMode("preview");
        setStatus(`已审阅「${selected.title}」段落，确认后保存。`);
        return;
      }

      const taskType: AiTaskType = action === "tag" ? "tag" : "explain";
      const result = await runAiTaskForCard(draft, taskType, {
        signal: controller.signal,
        forceEconomy: action === "quick" || action === "tag",
        statusLabel: label,
        modelPreference:
          action === "quick" || action === "tag"
            ? "cheap"
            : action === "polish"
              ? "balanced"
              : undefined,
      });
      setDraft(
        cloneCard(
          action === "tag"
            ? {
                ...draft,
                tags: result.nextCard.tags.length ? result.nextCard.tags : draft.tags,
                sourceContext: result.nextCard.sourceContext || draft.sourceContext,
                pronunciation: result.nextCard.pronunciation || draft.pronunciation,
                providerId: result.nextCard.providerId,
                model: result.nextCard.model,
                updatedAt: nowIso(),
              }
            : result.nextCard
        )
      );
      setEditorMode("preview");
      setStatus(`${label}已写入草稿，确认后保存。`);
    } catch (aiError) {
      const message = aiError instanceof Error ? aiError.message : `${label}失败。`;
      if (message.includes("已取消")) {
        setStatus(message);
        setError("");
        return;
      }
      const hint = isFetchLikeError(aiError)
        ? "请求没有完成，请确认本地 AI 代理正在运行；使用 npm run dev 会同时启动前端和代理。"
        : "";
      setError(
        `${message}${hint ? ` ${hint}` : ""}`
      );
      setStatus("");
    } finally {
      setAiBusy(false);
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
      }
    }
  }

  async function handleBackgroundOrganize() {
    if (!settings?.enableBackgroundAiTasks) {
      setError("后台整理任务还没有开启。可以在设置的高级 / 调试里打开开关。");
      return;
    }

    const candidates = cards
      .filter((card) => card.body.trim())
      .slice(0, 3);

    if (!candidates.length) {
      setError("还没有可整理的旧卡片。");
      return;
    }

    setAiBusy(true);
    setError("");
    setAiRouteDisplay(null);
    setStatus(`正在后台整理 ${candidates.length} 张最近卡片...`);

    try {
      const updatedCards: KnowledgeCard[] = [];
      for (const card of candidates) {
        const result = await runAiTaskForCard(card, "summarize");
        const nextCard = normalizeKnowledgeCard({
          ...result.nextCard,
          updatedAt: nowIso(),
        });
        await saveCardToDb(nextCard);
        updatedCards.push(nextCard);
      }

      const nextCards = await listCards();
      setCards(nextCards);
      const selected = nextCards.find((card) => card.id === draft.id);
      if (selected) {
        setDraft(cloneCard(selected));
      }
      setStatus(`后台整理完成：${updatedCards.length} 张卡片已更新。`);

      if (canUseBackendSync(settings)) {
        try {
          await pushCardsToSync(settings, updatedCards);
          await applyBackendSyncPatch({
            lastSyncedAt: nowIso(),
            pendingChanges: false,
          });
          setSyncStatus("后台整理结果已同步到后端。");
        } catch (syncError) {
          await applyBackendSyncPatch({ pendingChanges: true });
          setSyncStatus(`后台整理结果已保存在本地，后端待同步：${syncErrorMessage(syncError)}`);
        }
      }
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "后台整理失败。");
      setStatus("");
    } finally {
      setAiBusy(false);
    }
  }

  async function runAiTagMerge(inventory: ReturnType<typeof buildTagMergeInventory>, signal: AbortSignal) {
    if (!settings) {
      throw new Error("设置还没有加载完成。");
    }

    const provider = settings.providers[AUTO_CLASSIFY_PROVIDER_ID];
    if (!provider) {
      throw new Error("DeepSeek provider 配置不存在。");
    }

    const routedProvider: ProviderConfig = {
      ...provider,
      defaultModel: preferredActionModel(provider, "cheap"),
      reasoningEffort: provider.id === "deepseek" ? "none" : provider.reasoningEffort,
    };
    const request: AiExplainRequest = {
      term: "WordMem 标签归并",
      sourceContext: "只合并已有标签的同义写法，保留一词多标签。",
      pastedRawAnswer: JSON.stringify(inventory, null, 2),
      taskType: "tag_merge",
    };
    const estimate = estimateAiRequest(routedProvider, request);
    const dateKey = budgetDateKey();
    const display: AiRouteDisplay = {
      providerId: AUTO_CLASSIFY_PROVIDER_ID,
      providerLabel: provider.label,
      model: routedProvider.defaultModel,
      taskType: "tag_merge",
    };
    setAiRouteDisplay(display);
    setStatus(`正在用 ${modelRouteText(display)} 合并 ${inventory.length} 个已有标签...`);

    const startedAt = performance.now();
    try {
      const result = await explainWithActiveProvider(settings, request, routedProvider, {
        signal,
      });
      const inputTokens = result.usage?.inputTokens || estimate.inputTokens;
      const outputTokens = result.usage?.outputTokens || estimateTokens(result.rawAnswer);
      const usageSource = result.usage?.source || "estimate";
      const durationMs = result.durationMs || Math.round(performance.now() - startedAt);
      await persistUsageRecord({
        id: createId("usage"),
        dateKey,
        createdAt: nowIso(),
        providerId: AUTO_CLASSIFY_PROVIDER_ID,
        providerLabel: provider.label,
        model: result.model,
        taskType: "tag_merge",
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCostFromTokens(
          {
            ...routedProvider,
            defaultModel: result.model,
          },
          inputTokens,
          outputTokens
        ),
        usageSource,
        durationMs,
        status: "success",
        routeReason: "标签归并 / DeepSeek flash / 不重新生成标签",
      });
      return parseTagAliasMap(result.rawAnswer);
    } catch (tagMergeError) {
      const aborted =
        (tagMergeError instanceof DOMException && tagMergeError.name === "AbortError") ||
        (tagMergeError instanceof Error && /abort/i.test(tagMergeError.name || tagMergeError.message));
      await persistUsageRecord({
        id: createId("usage"),
        dateKey,
        createdAt: nowIso(),
        providerId: AUTO_CLASSIFY_PROVIDER_ID,
        providerLabel: provider.label,
        model: routedProvider.defaultModel,
        taskType: "tag_merge",
        inputTokens: estimate.inputTokens,
        outputTokens: 0,
        estimatedCostUsd: estimate.estimatedCostUsd,
        usageSource: "estimate",
        durationMs: Math.round(performance.now() - startedAt),
        status: "failed",
        routeReason: "标签归并 / DeepSeek flash / 不重新生成标签",
        error: aborted
          ? "用户取消了本次请求。"
          : tagMergeError instanceof Error
            ? tagMergeError.message
            : "标签归并失败。",
      });
      if (aborted) {
        throw new Error("AI 请求已取消，已有标签没有继续修改。");
      }
      throw tagMergeError;
    }
  }

  async function handleMergeCardTags(mode: "local" | "ai") {
    if (!settings) {
      return;
    }

    const inventory = buildTagMergeInventory(cards);
    if (!inventory.length) {
      setStatus("还没有可整理的标签。");
      setError("");
      return;
    }

    setError("");
    setMemoryStatus("");
    setMobileAiOpen(false);
    const controller = new AbortController();
    if (mode === "ai") {
      setAiBusy(true);
      aiAbortRef.current = controller;
    } else {
      setStatus("正在用本地规则整理已有标签...");
    }

    try {
      const aliasMap = mode === "ai" ? await runAiTagMerge(inventory, controller.signal) : {};
      const updatedCards = applyTagAliasesToCards(cards, aliasMap);

      if (!updatedCards.length) {
        setStatus(
          mode === "ai"
            ? `标签归并完成：分析 ${inventory.length} 个标签，没有需要修改的卡片。`
            : `本地规则整理完成：${inventory.length} 个标签已经是干净的。`
        );
        return;
      }

      await saveCards(updatedCards);
      const nextCards = await listCards();
      setCards(nextCards);
      const selected = nextCards.find((card) => card.id === draft.id);
      if (selected) {
        setDraft(cloneCard(selected));
      }

      if (canUseBackendSync(settings)) {
        try {
          await pushCardsToSync(settings, updatedCards);
          await applyBackendSyncPatch({
            lastSyncedAt: nowIso(),
            pendingChanges: false,
          });
          setSyncStatus("标签整理结果已同步到后端。");
        } catch (syncError) {
          await applyBackendSyncPatch({ pendingChanges: true });
          setSyncStatus(`标签整理结果已保存在本地，后端待同步：${syncErrorMessage(syncError)}`);
        }
      }

      const aliasCount = Object.keys(aliasMap).length;
      setStatus(
        mode === "ai"
          ? `标签归并完成：合并 ${aliasCount} 个别名，更新 ${updatedCards.length} 张卡片；每张卡仍保留多个标签。`
          : `本地规则整理完成：更新 ${updatedCards.length} 张卡片；每张卡仍保留多个标签。`
      );
    } catch (mergeError) {
      const message = mergeError instanceof Error ? mergeError.message : "标签整理失败。";
      if (message.includes("已取消") || controller.signal.aborted) {
        setStatus("已取消标签归并；已有标签没有继续修改。");
        setError("");
      } else {
        setError(message);
        setStatus("");
      }
    } finally {
      if (mode === "ai") {
        setAiBusy(false);
        if (aiAbortRef.current === controller) {
          aiAbortRef.current = null;
        }
      }
      setAiRouteDisplay(null);
    }
  }

  async function handleAutoClassifyCards(mode: "todo" | "all") {
    await handleMergeCardTags(mode === "all" ? "ai" : "local");
  }

  async function handleSaveSettings() {
    if (!settings) {
      return;
    }

    const nextSettings = {
      ...settings,
      updatedAt: nowIso(),
    };

    await saveSettings(nextSettings);
    setSettings(nextSettings);
    setStatus("设置已保存。");
    setError("");

    if (canUseBackendSync(nextSettings)) {
      try {
        const result = await pushSettingsToSync(nextSettings);
        const syncedAt = nowIso();
        const remoteSettings = result.settings
          ? mergeRemoteSettings(result.settings, nextSettings, {
              lastSyncedAt: syncedAt,
              pendingChanges: false,
            })
          : {
              ...nextSettings,
              backendSync: {
                ...nextSettings.backendSync,
                lastSyncedAt: syncedAt,
                pendingChanges: false,
              },
            };
        await saveSettings(remoteSettings);
        setSettings(remoteSettings);
        setStatus("设置已保存并同步到后端。API Key 已由后端加密保存。");
        setSyncStatus("后端同步正常。");
      } catch (syncError) {
        await applyBackendSyncPatch({ pendingChanges: true }, nextSettings);
        setStatus("设置已保存到本地，后端暂不可用，稍后可手动同步。");
        setSyncStatus(`本地待同步：${syncErrorMessage(syncError)}`);
      }
    }
  }

  async function handlePullFromSync() {
    if (!settings) {
      return;
    }
    if (!canUseBackendSync(settings)) {
      setError("请先启用后端同步，并填写同步 token。");
      return;
    }

    setError("");
    setSyncStatus("正在从后端拉取 snapshot...");

    try {
      const snapshot = await fetchSyncSnapshot(settings);
      const syncedAt = nowIso();
      const backendHasContent = !snapshot.syncMeta.isEmpty;
      let nextSettings = settings;

      if (snapshot.settings) {
        nextSettings = mergeRemoteSettings(snapshot.settings, settings, {
          lastSyncedAt: syncedAt,
          pendingChanges: false,
        });
      } else {
        nextSettings = {
          ...settings,
          backendSync: {
            ...settings.backendSync,
            lastSyncedAt: syncedAt,
            pendingChanges: false,
          },
        };
      }

      if (backendHasContent || !cards.length) {
        const remoteCards = sortCardsByUpdatedAt(snapshot.cards);
        await replaceCards(remoteCards);
        setCards(remoteCards);
        if (remoteCards[0]) {
          selectCard(remoteCards[0]);
        } else {
          startNewCard();
        }
      } else {
        setStatus("后端词库为空；如果这是第一次同步，请点击“上传本机数据到后端”。");
      }

      if (snapshot.usageRecords.length) {
        await saveUsageRecordsToDb(snapshot.usageRecords);
        setUsageRecords(await listUsageRecords());
      }

      await saveSettings(nextSettings);
      setSettings(nextSettings);
      setSyncStatus(`已刷新后端数据：${snapshot.cards.length} 张卡片。`);
      setError("");
    } catch (syncError) {
      await applyBackendSyncPatch({ pendingChanges: true });
      setSyncStatus(`拉取失败：${syncErrorMessage(syncError)}`);
      setError(syncErrorMessage(syncError));
    }
  }

  async function handleUploadLocalToSync() {
    if (!settings) {
      return;
    }
    if (!canUseBackendSync(settings)) {
      setError("请先启用后端同步，并填写同步 token。");
      return;
    }

    setError("");
    setSyncStatus("正在上传本机数据到后端...");

    try {
      const settingsForSync = {
        ...settings,
        updatedAt: nowIso(),
      };
      await pushCardsToSync(settingsForSync, cards);

      const pendingDeletes = await listPendingDeletes();
      for (const tombstone of pendingDeletes) {
        await deleteCardFromSync(settingsForSync, tombstone.id, tombstone.deletedAt);
        await clearPendingDelete(tombstone.id);
      }

      const settingsResult = await pushSettingsToSync(settingsForSync);
      if (usageRecords.length) {
        await pushUsageToSync(settingsForSync, usageRecords);
      }

      const syncedAt = nowIso();
      const nextSettings = settingsResult.settings
        ? mergeRemoteSettings(settingsResult.settings, settingsForSync, {
            lastSyncedAt: syncedAt,
            pendingChanges: false,
          })
        : {
            ...settingsForSync,
            backendSync: {
              ...settingsForSync.backendSync,
              lastSyncedAt: syncedAt,
              pendingChanges: false,
            },
          };

      await saveSettings(nextSettings);
      setSettings(nextSettings);
      setStatus(`已上传 ${cards.length} 张卡片、${usageRecords.length} 条用量记录到后端。`);
      setSyncStatus("后端同步正常。");
    } catch (syncError) {
      await applyBackendSyncPatch({ pendingChanges: true });
      setSyncStatus(`上传失败：${syncErrorMessage(syncError)}`);
      setError(syncErrorMessage(syncError));
    }
  }

  function updateProvider(providerId: AiProviderId, changes: Partial<ProviderConfig>) {
    setSettings((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        providers: {
          ...current.providers,
          [providerId]: {
            ...current.providers[providerId],
            ...changes,
          },
        },
      };
    });
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const importedCards = parseImportedCards(text);
      await saveCards(importedCards);
      const nextCards = await listCards();
      setCards(nextCards);
      if (nextCards[0]) {
        selectCard(nextCards[0]);
      }
      setStatus(`已导入 ${importedCards.length} 张卡片。`);
      setError("");

      const syncSettings = settings;
      if (canUseBackendSync(syncSettings)) {
        try {
          await pushCardsToSync(syncSettings, importedCards);
          await applyBackendSyncPatch({
            lastSyncedAt: nowIso(),
            pendingChanges: false,
          });
          setStatus(`已导入并同步 ${importedCards.length} 张卡片。`);
          setSyncStatus("后端同步正常。");
        } catch (syncError) {
          await applyBackendSyncPatch({ pendingChanges: true });
          setStatus(`已导入 ${importedCards.length} 张卡片到本地，后端暂不可用。`);
          setSyncStatus(`本地待同步：${syncErrorMessage(syncError)}`);
        }
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "导入失败。");
    } finally {
      event.target.value = "";
    }
  }

  function handleExport() {
    downloadJson(`wordmem-${new Date().toISOString().slice(0, 10)}.json`, buildExport(cards));
    setStatus("已导出 JSON 备份，不包含 API Key。");
    setError("");
  }

  function handleUsageExport() {
    downloadJson(
      `wordmem-usage-${new Date().toISOString().slice(0, 10)}.json`,
      buildUsageExport(usageRecords)
    );
    setStatus("已导出用量记录 JSON，不包含 API Key。");
    setError("");
  }

  if (loading || !settings) {
    return (
      <main className="loading-screen">
        <Loader2 className="spin" size={24} />
        <span>正在打开本地词库...</span>
      </main>
    );
  }

  return (
    <div
      className={`app-shell ${mobileLayout ? "mobile-layout" : ""} ${
        forceMobilePreview ? "mobile-preview" : ""
      } ${standaloneDisplay ? "app-standalone" : ""}`}
    >
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <BookOpen size={20} />
          </div>
          <div>
            <strong>WordMem</strong>
            <span>工作术语知识卡片</span>
          </div>
        </div>

        <nav className="view-tabs" aria-label="主视图">
          <button
            className={view === "library" ? "active" : ""}
            onClick={() => setView("library")}
            title="词库"
          >
            <Library size={18} />
            <span>词库</span>
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => setView("settings")}
            title="设置"
          >
            <Settings size={18} />
            <span>设置</span>
          </button>
        </nav>
      </header>

      {(status || error) && (
        <div className={`notice ${error ? "error" : ""}`} role="status">
          {error || status}
        </div>
      )}

      {showInstallHint && (
        <div className="install-banner" role="status">
          <div className="install-copy">
            <Smartphone size={18} />
            <span>
              {installPrompt
                ? "可以把 WordMem 安装到手机主屏，像 App 一样打开。"
                : "iPhone 可以用分享菜单里的“添加到主屏幕”安装 WordMem。"}
            </span>
          </div>
          <div className="install-actions">
            {installPrompt ? (
              <button className="primary-action" onClick={handleInstallApp}>
                <Download size={16} />
                <span>安装</span>
              </button>
            ) : (
              <span className="ios-install-hint">
                <Share2 size={15} />
                {"分享 -> 添加到主屏幕"}
              </span>
            )}
            <button onClick={dismissInstallHint} title="关闭安装提示">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {view === "library" ? (
        <main className={`workspace mobile-pane-${mobilePane}`}>
          <aside className="sidebar" aria-label="卡片列表">
            <div className="mobile-library-head">
              <div>
                <strong>词库</strong>
                <span>
                  {filteredCards.length} / {libraryCards.length} 张卡片
                </span>
              </div>
              <button onClick={showMobileDetail}>
                <BookOpen size={17} />
                <span>详情</span>
              </button>
            </div>

            <div className="toolbar">
              <button className="primary-action" onClick={startNewCard}>
                <Plus size={18} />
                <span>新卡片</span>
              </button>
              <button onClick={handleExport} disabled={!cards.length} title="导出 JSON">
                <Download size={18} />
              </button>
              <button onClick={() => importInputRef.current?.click()} title="导入 JSON">
                <FileUp size={18} />
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden-input"
                onChange={handleImport}
              />
            </div>

            <label className="search-box">
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索术语、正文、标签"
              />
            </label>

            <div className="library-mode-tabs" aria-label="词库浏览模式">
              <button
                className={libraryMode === "views" ? "active" : ""}
                onClick={() => {
                  setLibraryMode("views");
                  setActiveTag("");
                }}
                disabled={!knowledgeViews.length}
              >
                知识视图
              </button>
              <button
                className={libraryMode === "all" ? "active" : ""}
                onClick={showAllLibraryCards}
              >
                全部卡片
              </button>
            </div>

            {libraryMode === "views" && (
              <div className="knowledge-view-panel">
                {knowledgeViews.length ? (
                  <>
                    <div className="knowledge-view-list" aria-label="知识视图">
                      {knowledgeViews.map((knowledgeView) => (
                        <button
                          key={knowledgeView.id}
                          className={
                            activeKnowledgeView?.id === knowledgeView.id ? "selected" : ""
                          }
                          onClick={() => selectKnowledgeView(knowledgeView.id)}
                        >
                          <strong>{knowledgeView.title}</strong>
                          <span>{knowledgeView.description}</span>
                          <small>
                            {knowledgeView.count} 张 · {knowledgeView.tags.slice(0, 3).join(" / ")}
                          </small>
                        </button>
                      ))}
                    </div>

                    {activeKnowledgeView && (
                      <div className="knowledge-view-summary">
                        <strong>{activeKnowledgeView.title}</strong>
                        <span>
                          {activeKnowledgeView.count} 张卡片
                          {activeKnowledgeView.cards[0]
                            ? ` · 最近：${activeKnowledgeView.cards[0].term}`
                            : ""}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="knowledge-view-empty">
                    还没有足够标签生成知识视图。
                  </div>
                )}
              </div>
            )}

            <div className="tag-filter" aria-label="标签筛选">
              <button className={!activeTag ? "active" : ""} onClick={() => setActiveTag("")}>
                全部
              </button>
              {tags.map((tag) => (
                <button
                  key={tag}
                  className={activeTag === tag ? "active" : ""}
                  onClick={() => setActiveTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>

            <div className="card-count">
              <Tags size={16} />
              <span>
                {filteredCards.length} / {libraryCards.length} 张卡片
                {libraryMode === "views" && activeKnowledgeView
                  ? ` · ${activeKnowledgeView.title}`
                  : ""}
              </span>
            </div>

            <div className="card-list">
              {filteredCards.length ? (
                filteredCards.map((card) => (
                  <button
                    key={card.id}
                    className={`card-list-item ${card.id === selectedId ? "selected" : ""}`}
                    onClick={() => selectCard(card)}
                  >
                    <strong>{card.term}</strong>
                    <span>{getCardSummary(card) || "没有正文内容"}</span>
                    <small>{formatDate(card.updatedAt)}</small>
                  </button>
                ))
              ) : (
                <div className="empty-list">
                  <BookOpen size={24} />
                  <span>还没有匹配的卡片</span>
                </div>
              )}
            </div>

            <button className="mobile-fab" onClick={startNewCard} title="新卡片">
              <Plus size={24} />
            </button>
          </aside>

          <section className="editor" aria-label="卡片编辑器">
            <div className="editor-topbar">
              <div className="provider-pill">
                <Brain size={16} />
                <span>{modelRouteText(modelDisplay, aiBusy)}</span>
              </div>
              <button onClick={() => setView("settings")}>
                <Settings size={16} />
                <span>模型设置</span>
              </button>
              <button
                className="mobile-top-more"
                onClick={() => {
                  setMobileMoreOpen((current) => !current);
                  setMobileAiOpen(false);
                }}
                aria-expanded={mobileMoreOpen}
                title="更多"
              >
                <MoreHorizontal size={18} />
              </button>
            </div>

            <div className="document-head">
              <span className="eyebrow">
                {persistedDraft ? (editorMode === "preview" ? "正在预览" : "正在编辑") : "新卡片"}
              </span>
              <div className="title-row">
                <textarea
                  className="title-input"
                  style={
                    mobileLayout ? { fontSize: mobileTitleFontSize(draft.term) } : undefined
                  }
                  rows={1}
                  value={draft.term}
                  onChange={(event) => updateDraft("term", event.target.value)}
                  placeholder="输入术语或术语组"
                  title={draft.term}
                  wrap="soft"
                />
                <textarea
                  className="pronunciation-input"
                  rows={1}
                  value={cleanPronunciation(draft.pronunciation)}
                  onChange={(event) =>
                    updateDraft("pronunciation", cleanPronunciation(event.target.value))
                  }
                  placeholder="音标可选"
                  aria-label="读音"
                  wrap="soft"
                />
              </div>

              <details
                className="card-info-details"
                open={!mobileLayout || editorMode === "edit"}
              >
                <summary>
                  <span>卡片信息</span>
                  <small>
                    {draft.tags.length ? draft.tags.slice(0, 3).join("，") : "标签 / 工作上下文"}
                  </small>
                </summary>
                <div className="meta-row">
                  <label>
                    <span>标签</span>
                    <input
                      value={draft.tags.join(", ")}
                      onChange={(event) => updateDraft("tags", normalizeTags(event.target.value))}
                      placeholder="RL, PPO, robotics, retargeting, MuJoCo"
                    />
                  </label>
                  <label>
                    <span>工作上下文</span>
                    <input
                      value={draft.sourceContext}
                      onChange={(event) => updateDraft("sourceContext", event.target.value)}
                      placeholder="例如：PPO 训练日志、MuJoCo replay、GMR retargeting、policy rollout"
                    />
                  </label>
                </div>
              </details>
            </div>

            <div className="editor-toolbar">
              <div className="mode-tabs" aria-label="编辑模式">
                <button
                  className={editorMode === "edit" ? "active" : ""}
                  onClick={() => setEditorMode("edit")}
                >
                  <Pencil size={16} />
                  <span>编辑</span>
                </button>
                <button
                  className={editorMode === "preview" ? "active" : ""}
                  onClick={() => setEditorMode("preview")}
                >
                  <Eye size={16} />
                  <span>预览</span>
                </button>
              </div>

              <div className="editor-actions">
                <button onClick={handleAiExplain} disabled={aiBusy}>
                  {aiBusy ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
                  <span>{draft.body.trim() ? "整理正文" : "AI 解释"}</span>
                </button>
                <button onClick={handleAiReview} disabled={aiBusy || !draft.body.trim()}>
                  <Brain size={18} />
                  <span>专家审阅</span>
                </button>
                {aiBusy && (
                  <button onClick={cancelAiRequest}>
                    <X size={18} />
                    <span>取消</span>
                  </button>
                )}
                <button className="primary-action" onClick={handleSaveCard}>
                  <Save size={18} />
                  <span>保存</span>
                </button>
                <button className="danger-action" onClick={handleDeleteCard} title="删除卡片">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>

            {memoryStatus && (
              <div className="memory-note">
                <Brain size={15} />
                <span>{memoryStatus}</span>
              </div>
            )}

            {editorMode === "edit" ? (
              <textarea
                className="body-editor"
                value={draft.body}
                onChange={(event) => updateDraft("body", event.target.value)}
                placeholder="直接粘贴 GPT 回答，或写下这个术语在训练、评测、rollout、机器人运动控制、motion retargeting 里的含义。AI 生成后也会直接写在这里。"
              />
            ) : (
              <MarkdownPreview
                body={draft.body}
                compactSections={mobileLayout}
                searchQuery={query}
                onSectionFocus={setActiveSectionId}
              />
            )}

            {editorMode === "preview" && relatedCards.length > 0 && (
              <section className="related-cards-section" aria-label="相关卡片">
                <div className="related-cards-head">
                  <div>
                    <strong>相关卡片</strong>
                    <span>根据术语、标签、上下文和正文关键词本地匹配</span>
                  </div>
                  <small>{relatedCards.length} 张</small>
                </div>
                <div className="related-card-list">
                  {relatedCards.map((item) => (
                    <button
                      key={item.card.id}
                      className="related-card-item"
                      onClick={() => selectCard(item.card)}
                    >
                      <div>
                        <strong>{item.card.term || "未命名卡片"}</strong>
                        <span>{getCardSummary(item.card) || "没有正文内容"}</span>
                      </div>
                      <small>{item.reasons.join(" · ") || "内容相近"}</small>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div
              className={`mobile-ai-backdrop ${mobileAiOpen ? "open" : ""}`}
              onClick={() => setMobileAiOpen(false)}
              aria-hidden="true"
            />
            <div className={`mobile-ai-menu ${mobileAiOpen ? "open" : ""}`}>
              <div className="mobile-ai-menu-head">
                <strong>AI 操作</strong>
                <span>{modelRouteText(modelDisplay, aiBusy)}</span>
              </div>
              {aiBusy ? (
                <button className="danger-action" onClick={cancelAiRequest}>
                  <X size={18} />
                  <span>取消当前请求</span>
                </button>
              ) : (
                <>
                  <button onClick={() => handleAiAction("quick")}>
                    <Sparkles size={18} />
                    <span>快速解释</span>
                    <small>优先快模型</small>
                  </button>
                  <button onClick={() => handleAiAction("polish")}>
                    <Pencil size={18} />
                    <span>高质量整理</span>
                    <small>把正文整理成 Markdown</small>
                  </button>
                  <button onClick={() => handleAiAction("review_section")} disabled={!draft.body.trim()}>
                    <Brain size={18} />
                    <span>专家审阅当前段落</span>
                    <small>更快，适合手机端</small>
                  </button>
                  <button onClick={() => handleAiAction("review_full")} disabled={!draft.body.trim()}>
                    <Brain size={18} />
                    <span>专家审阅全文</span>
                    <small>更慢，费用更高</small>
                  </button>
                  <button onClick={() => handleAiAction("tag")} disabled={!draft.body.trim()}>
                    <Tags size={18} />
                    <span>补标签和相关词</span>
                    <small>便宜模型或本地估算</small>
                  </button>
                </>
              )}
            </div>

            <div
              className={`mobile-more-backdrop ${mobileMoreOpen ? "open" : ""}`}
              onClick={() => setMobileMoreOpen(false)}
              aria-hidden="true"
            />
            <div className={`mobile-more-menu ${mobileMoreOpen ? "open" : ""}`}>
              <button onClick={openModelSettings}>
                <Settings size={18} />
                <span>模型设置</span>
              </button>
              <button onClick={exportFromMobileMenu} disabled={!cards.length}>
                <Download size={18} />
                <span>导出卡片</span>
              </button>
              <button onClick={openImportPicker}>
                <FileUp size={18} />
                <span>导入卡片</span>
              </button>
              <button
                className="danger-action"
                onClick={() => {
                  setMobileMoreOpen(false);
                  handleDeleteCard();
                }}
              >
                <Trash2 size={18} />
                <span>删除卡片</span>
              </button>
            </div>

            <nav className="mobile-bottom-actions" aria-label="手机快捷操作">
              <button onClick={showMobileLibrary}>
                <Library size={19} />
                <span>词库</span>
              </button>
              <button onClick={toggleEditorMode}>
                {editorMode === "edit" ? <Eye size={19} /> : <Pencil size={19} />}
                <span>{editorMode === "edit" ? "预览" : "编辑"}</span>
              </button>
              <button onClick={toggleMobileAiPanel}>
                {aiBusy ? <Loader2 className="spin" size={19} /> : <Sparkles size={19} />}
                <span>AI 操作</span>
              </button>
              <button className="primary-action" onClick={handleSaveCard}>
                <Save size={19} />
                <span>保存</span>
              </button>
            </nav>
          </section>
        </main>
      ) : (
        <main className="settings-page">
          <section className="settings-panel">
            <div className="settings-title">
              <KeyRound size={22} />
              <div>
                <h1>AI Provider 设置</h1>
                <p>默认只露出常用项；接口细节收在高级设置里。</p>
              </div>
            </div>

            <div className="security-note">
              未启用后端同步时，API Key 会保存在当前浏览器本地。启用同步并保存设置后，Key 会加密写入后端 SQLite，前端只显示“已保存”。
            </div>

            <section className="sync-settings">
              <div className="sync-settings-head">
                <div>
                  <strong>后端同步</strong>
                  <span>电脑和手机共用同一个后端；通过 Tailscale 访问时也需要同步 token。</span>
                </div>
                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    checked={settings.backendSync.enabled}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        backendSync: {
                          ...settings.backendSync,
                          enabled: event.target.checked,
                        },
                      })
                    }
                  />
                  <span>启用</span>
                </label>
              </div>

              <div className="sync-grid">
                <label className="field">
                  <span>服务地址</span>
                  <input
                    value={settings.backendSync.baseUrl}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        backendSync: {
                          ...settings.backendSync,
                          baseUrl: event.target.value,
                        },
                      })
                    }
                    placeholder="留空使用当前服务；也可填 http://100.x.x.x:4173"
                  />
                </label>
                <label className="field">
                  <span>同步 Token</span>
                  <input
                    type="password"
                    value={settings.backendSync.token}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        backendSync: {
                          ...settings.backendSync,
                          token: event.target.value,
                        },
                      })
                    }
                    placeholder="WORDMEM_SYNC_TOKEN"
                  />
                </label>
              </div>

              <div className="sync-state-row">
                <div className={`sync-state ${settings.backendSync.pendingChanges ? "pending" : ""}`}>
                  <Cloud size={16} />
                  <span>
                    {settings.backendSync.enabled
                      ? settings.backendSync.pendingChanges
                        ? "本地待同步"
                        : "同步已启用"
                      : "未启用"}
                  </span>
                </div>
                <span className="sync-meta">
                  上次同步：
                  {settings.backendSync.lastSyncedAt
                    ? formatDate(settings.backendSync.lastSyncedAt)
                    : "无"}
                </span>
                {syncStatus && <span className="sync-meta">{syncStatus}</span>}
              </div>

              <div className="sync-actions">
                <button onClick={handlePullFromSync}>
                  <RefreshCw size={18} />
                  <span>拉取后端</span>
                </button>
                <button onClick={handleUploadLocalToSync}>
                  <FileUp size={18} />
                  <span>上传本机数据到后端</span>
                </button>
              </div>
            </section>

            {budgetSummary && (
              <details className="budget-settings">
                <summary className="budget-settings-head">
                  <div>
                    <strong>高级 / 调试</strong>
                    <span>
                      用量记录、预算估算和后台整理开关。默认不影响主界面，也不拦截日常 AI。
                    </span>
                  </div>
                  <div className="budget-state">
                    调试信息
                  </div>
                </summary>

                <div className="budget-stats">
                  <div>
                    <span>今日已用</span>
                    <strong>${formatUsd(budgetSummary.knownSpendUsd)}</strong>
                  </div>
                  <div>
                    <span>WordMem 剩余</span>
                    <strong>${formatUsd(budgetSummary.remainingUsd)}</strong>
                  </div>
                  <div>
                    <span>总额度</span>
                    <strong>${formatUsd(budgetSummary.dailyTotalBudgetUsd)}</strong>
                  </div>
                  <div>
                    <span>预留给你</span>
                    <strong>${formatUsd(budgetSummary.reservedBudgetUsd)}</strong>
                  </div>
                </div>

                <div className="budget-grid">
                  <label className="field">
                    <span>每日总额度 $</span>
                    <input
                      type="number"
                      min="0"
                      value={settings.dailyTotalBudgetUsd}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          dailyTotalBudgetUsd: parseBudgetNumber(
                            event.target.value,
                            settings.dailyTotalBudgetUsd
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>保留给你 $</span>
                    <input
                      type="number"
                      min="0"
                      value={settings.reservedBudgetUsd}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          reservedBudgetUsd: parseBudgetNumber(
                            event.target.value,
                            settings.reservedBudgetUsd
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>WordMem 日上限 $</span>
                    <input
                      type="number"
                      min="0"
                      value={settings.wordMemDailyBudgetUsd}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          wordMemDailyBudgetUsd: parseBudgetNumber(
                            event.target.value,
                            settings.wordMemDailyBudgetUsd
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>省钱模式阈值 $</span>
                    <input
                      type="number"
                      min="0"
                      value={settings.economyModeThresholdUsd}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          economyModeThresholdUsd: parseBudgetNumber(
                            event.target.value,
                            settings.economyModeThresholdUsd
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>单次请求上限 $</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={settings.perRequestBudgetUsd}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          perRequestBudgetUsd: parseBudgetNumber(
                            event.target.value,
                            settings.perRequestBudgetUsd
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="inline-toggle budget-toggle">
                    <input
                      type="checkbox"
                      checked={settings.enableBackgroundAiTasks}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          enableBackgroundAiTasks: event.target.checked,
                        })
                      }
                    />
                    <span>允许后台整理任务</span>
                  </label>
                </div>

                <div className="budget-actions">
                  <button onClick={handleBackgroundOrganize} disabled={aiBusy || !settings.enableBackgroundAiTasks}>
                    {aiBusy ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
                    <span>整理最近 3 张</span>
                  </button>
                  <button onClick={handleUsageExport} disabled={!usageRecords.length}>
                    <Download size={18} />
                    <span>导出用量</span>
                  </button>
                </div>

                <details className="usage-details">
                  <summary>
                    <span>用量明细</span>
                    <small>{recentUsageRecords.length} 条最近记录</small>
                  </summary>

                  <div className="budget-allocation">
                    <span>默认分配：解释 $140 / 审阅 $70 / 后台整理 $50 / 记忆增强 $25 / 缓冲 $15。</span>
                    <span>
                      当前 provider 计价：
                      {activeProvider
                        ? priceForProvider(activeProvider).source === "unknown"
                          ? "未知，需手动填写单价"
                          : priceForProvider(activeProvider).source === "manual"
                            ? "手动单价"
                            : priceForProvider(activeProvider).source === "deepseek-reference"
                              ? "DeepSeek 官方参考价"
                              : "OpenAI 参考价"
                        : "未选择"}
                    </span>
                  </div>

                  {recentUsageRecords.length > 0 ? (
                    <div className="usage-list">
                      {recentUsageRecords.map((record) => (
                        <div className="usage-row" key={record.id}>
                          <span>{taskLabel(record.taskType)}</span>
                          <strong>{record.model}</strong>
                          <small>
                            {shortUsageStatus(record)} / $
                            {usageRecordCost(record) === undefined
                              ? "未知"
                              : formatUsd(usageRecordCost(record))}
                            {record.usageSource ? ` / ${record.usageSource}` : ""}
                            {record.durationMs ? ` / ${(record.durationMs / 1000).toFixed(1)}s` : ""}
                          </small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-usage">今天还没有 AI 用量记录。</div>
                  )}
                </details>
              </details>
            )}

            <section className="classification-settings">
              <div className="classification-settings-head">
                <div>
                  <strong>标签整理中心</strong>
                  <span>
                    合并已有相似标签；保留一词多标签，不重新生成分类，不改正文。
                  </span>
                </div>
                <div className="classification-state">
                  {buildTagMergeInventory(cards).length} 个标签
                </div>
              </div>

              <div className="classification-actions">
                <button onClick={() => handleAutoClassifyCards("todo")} disabled={aiBusy || !cards.length}>
                  {aiBusy ? <Loader2 className="spin" size={18} /> : <Tags size={18} />}
                  <span>本地规则整理标签</span>
                </button>
                <button onClick={() => handleAutoClassifyCards("all")} disabled={aiBusy || !cards.length}>
                  <Sparkles size={18} />
                  <span>AI 合并相似标签</span>
                </button>
                {aiBusy && (
                  <button className="danger-action" onClick={cancelAiRequest}>
                    <X size={18} />
                    <span>取消</span>
                  </button>
                )}
              </div>
            </section>

            <section className="memory-settings">
              <div className="memory-settings-head">
                <div>
                  <strong>个人记忆</strong>
                  <span>AI 解释时自动参考你的旧卡片和表达偏好。</span>
                </div>
                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    checked={settings.memoryEnabled}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        memoryEnabled: event.target.checked,
                      })
                    }
                  />
                  <span>启用</span>
                </label>
              </div>

              <label className="field">
                <span>个人偏好</span>
                <textarea
                  value={settings.personalPreference}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      personalPreference: event.target.value,
                    })
                  }
                  rows={7}
                  placeholder="写下你希望 AI 长期遵守的领域、解释风格和术语口径。"
                />
              </label>
            </section>

            <label className="field">
              <span>当前使用的 Provider</span>
              <select
                value={settings.activeProvider}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    activeProvider: event.target.value as AiProviderId,
                  })
                }
              >
                {providerOrder.map((providerId) => (
                  <option key={providerId} value={providerId}>
                    {settings.providers[providerId].label}
                  </option>
                ))}
              </select>
            </label>

            <div className="provider-cards">
              {providerOrder.map((providerId) => {
                const provider = settings.providers[providerId];
                const isCustomModel = selectedModelValue(provider) === CUSTOM_MODEL_VALUE;

                return (
                  <section className="provider-card" key={providerId}>
                    <div className="provider-card-head">
                      <div>
                        <strong>{provider.label}</strong>
                        <span>
                          {provider.defaultModel || "未设置模型"} / {wireApiLabel(provider.wireApi)}
                        </span>
                      </div>
                      <button
                        className={settings.activeProvider === providerId ? "active" : ""}
                        onClick={() => setSettings({ ...settings, activeProvider: providerId })}
                      >
                        使用
                      </button>
                    </div>

                    <div className="provider-basic">
                      <label className="field">
                        <span>API Key</span>
                        <input
                          type="password"
                          value={provider.apiKey}
                          onChange={(event) =>
                            updateProvider(providerId, { apiKey: event.target.value })
                          }
                          placeholder={
                            provider.apiKeySaved
                              ? "后端已保存；输入新 key 可覆盖"
                              : "sk-..."
                          }
                        />
                        {provider.apiKeySaved && !provider.apiKey && (
                          <small className="field-hint">后端已加密保存这个 provider 的 API Key。</small>
                        )}
                      </label>
                      <label className="field">
                        <span>模型</span>
                        <div className="model-picker">
                          <select
                            value={selectedModelValue(provider)}
                            onChange={(event) =>
                              updateProvider(providerId, {
                                defaultModel:
                                  event.target.value === CUSTOM_MODEL_VALUE
                                    ? ""
                                    : event.target.value,
                              })
                            }
                          >
                            {provider.models.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                            <option value={CUSTOM_MODEL_VALUE}>自定义模型...</option>
                          </select>
                          {isCustomModel && (
                            <input
                              value={provider.defaultModel}
                              onChange={(event) =>
                                updateProvider(providerId, { defaultModel: event.target.value })
                              }
                              placeholder="输入 model id，例如 gpt-5.4"
                            />
                          )}
                        </div>
                      </label>
                    </div>

                    <details className="advanced-settings">
                      <summary>高级设置</summary>
                      <div className="advanced-grid">
                        <label className="field">
                          <span>Base URL</span>
                          <input
                            value={provider.baseUrl}
                            onChange={(event) =>
                              updateProvider(providerId, { baseUrl: event.target.value })
                            }
                            placeholder="https://api.example.com"
                          />
                        </label>
                        <label className="field">
                          <span>Wire API</span>
                          <select
                            value={provider.wireApi}
                            onChange={(event) =>
                              updateProvider(providerId, {
                                wireApi: event.target.value as WireApi,
                              })
                            }
                          >
                            <option value="responses">Responses API</option>
                            <option value="chat_completions">Chat Completions</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Reasoning effort</span>
                          <select
                            value={provider.reasoningEffort}
                            onChange={(event) =>
                              updateProvider(providerId, {
                                reasoningEffort: event.target.value as ReasoningEffort,
                              })
                            }
                          >
                            {reasoningEfforts.map((effort) => (
                              <option key={effort} value={effort}>
                                {effort}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>输入单价 $/1M tokens</span>
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={optionalNumberInput(provider.inputCostPerMillionTokens)}
                            onChange={(event) =>
                              updateProvider(providerId, {
                                inputCostPerMillionTokens: parseOptionalNumber(
                                  event.target.value
                                ),
                              })
                            }
                            placeholder="未知时留空"
                          />
                        </label>
                        <label className="field">
                          <span>输出单价 $/1M tokens</span>
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={optionalNumberInput(provider.outputCostPerMillionTokens)}
                            onChange={(event) =>
                              updateProvider(providerId, {
                                outputCostPerMillionTokens: parseOptionalNumber(
                                  event.target.value
                                ),
                              })
                            }
                            placeholder="未知时留空"
                          />
                        </label>
                      </div>
                    </details>

                    {providerId === "bxi" && (
                      <p className="provider-hint">
                        公司中转默认使用 `https://ai.bxirobotics.cn/v1` + Responses API。
                        这个 endpoint 需要流式 Responses；本地代理会自动处理。
                      </p>
                    )}

                    {providerId === "custom" && (
                      <p className="provider-hint">
                        你的自定义接口可以使用 `https://api.86gamestore.com` + `gpt-5.4` +
                        Responses API。如果请求返回 404，再尝试把 Base URL 改成带 `/v1` 的地址。
                      </p>
                    )}
                  </section>
                );
              })}
            </div>

            <details className="advanced-settings global-advanced">
              <summary>响应存储</summary>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={settings.disableResponseStorage}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      disableResponseStorage: event.target.checked,
                    })
                  }
                />
                <span>Responses API 请求默认设置 `store: false`，尽量不在 provider 侧保存响应。</span>
              </label>
            </details>

            <div className="settings-actions">
              <button className="primary-action" onClick={handleSaveSettings}>
                <Save size={18} />
                <span>保存设置</span>
              </button>
              <button onClick={handleExport} disabled={!cards.length}>
                <Download size={18} />
                <span>导出卡片 JSON</span>
              </button>
              <button onClick={() => importInputRef.current?.click()}>
                <FileUp size={18} />
                <span>导入 JSON</span>
              </button>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
