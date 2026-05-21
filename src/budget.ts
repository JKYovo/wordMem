import type {
  AiExplainRequest,
  AiProviderId,
  AiTaskType,
  AppSettings,
  ProviderConfig,
  ReasoningEffort,
  UsageRecord,
} from "./types";

type Price = {
  input: number;
  output: number;
  source: "openai-reference" | "manual" | "unknown";
};
type TokenPrice = Pick<Price, "input" | "output">;

export type BudgetSummary = {
  dateKey: string;
  knownSpendUsd: number;
  remainingUsd: number;
  wordMemDailyBudgetUsd: number;
  reservedBudgetUsd: number;
  dailyTotalBudgetUsd: number;
  economyMode: boolean;
  blocked: boolean;
  successfulRecords: UsageRecord[];
};

export type BudgetEstimate = {
  inputTokens: number;
  expectedOutputTokens: number;
  estimatedCostUsd?: number;
  priceSource: Price["source"];
};

export type RoutedProvider = {
  providerId: AiProviderId;
  provider: ProviderConfig;
  taskType: AiTaskType;
  routeReason: string;
};

const OPENAI_REFERENCE_PRICES: Array<{
  prefix: string;
  input: number;
  output: number;
}> = [
  { prefix: "gpt-5.5-pro", input: 30, output: 180 },
  { prefix: "gpt-5.5", input: 5, output: 30 },
  { prefix: "gpt-5.4-mini", input: 0.75, output: 4.5 },
  { prefix: "gpt-5.4-nano", input: 0.2, output: 1.25 },
  { prefix: "gpt-5.4-pro", input: 15, output: 90 },
  { prefix: "gpt-5.4", input: 2.5, output: 15 },
];

const HARD_KEYWORDS = [
  "ppo",
  "trpo",
  "sac",
  "ddpg",
  "policy gradient",
  "kl",
  "gae",
  "advantage",
  "retarget",
  "gmr",
  "mujoco",
  "isaac",
  "quaternion",
  "jacobian",
  "mpc",
  "dynamics",
  "kinematics",
  "rollout",
  "reward",
  "stochastic",
  "deterministic",
  "reference motion",
  "foot slip",
  "root rmse",
  "tracking error",
];

function datePartsInShanghai(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function budgetDateKey(date = new Date()) {
  return datePartsInShanghai(date);
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function priceForProvider(provider: ProviderConfig): Price {
  if (
    validPrice(provider.inputCostPerMillionTokens) &&
    validPrice(provider.outputCostPerMillionTokens)
  ) {
    return {
      input: provider.inputCostPerMillionTokens,
      output: provider.outputCostPerMillionTokens,
      source: "manual",
    };
  }

  const openAiModelMatch = openAiReferencePriceForModel(provider.defaultModel);
  if (openAiModelMatch) {
    return {
      input: openAiModelMatch.input,
      output: openAiModelMatch.output,
      source: "openai-reference",
    };
  }

  return { input: 0, output: 0, source: "unknown" };
}

function openAiReferencePriceForModel(modelName: string) {
  const model = modelName.toLowerCase();
  return OPENAI_REFERENCE_PRICES.find((price) => model.startsWith(price.prefix));
}

export function estimateTokens(text: string) {
  if (!text.trim()) {
    return 0;
  }

  const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const nonCjkCount = Math.max(text.length - cjkCount, 0);
  return Math.max(1, Math.ceil(cjkCount * 0.9 + nonCjkCount / 3.5));
}

function expectedOutputTokens(taskType: AiTaskType, request: AiExplainRequest) {
  const pastedTokens = estimateTokens(request.pastedRawAnswer || "");

  if (taskType === "review") {
    return Math.min(3600, Math.max(1800, Math.ceil(pastedTokens * 0.9)));
  }
  if (taskType === "summarize") {
    return Math.min(1800, Math.max(800, Math.ceil(pastedTokens * 0.55)));
  }
  if (taskType === "tag") {
    return 320;
  }
  if (taskType === "memory_profile") {
    return 700;
  }

  return Math.min(3200, Math.max(1600, Math.ceil(pastedTokens * 0.8)));
}

export function estimateAiRequest(
  provider: ProviderConfig,
  request: AiExplainRequest
): BudgetEstimate {
  const taskType = request.taskType || "explain";
  const relatedText = (request.memoryContext?.relatedCards || [])
    .map((card) => `${card.term}\n${card.tags.join(", ")}\n${card.sourceContext}\n${card.bodyExcerpt}`)
    .join("\n\n");
  const inputTokens =
    1800 +
    estimateTokens(request.term || "") +
    estimateTokens(request.sourceContext || "") +
    estimateTokens(request.pastedRawAnswer || "") +
    estimateTokens(request.memoryContext?.personalPreference || "") +
    estimateTokens(relatedText);
  const outputTokens = expectedOutputTokens(taskType, request);
  const price = priceForProvider(provider);

  return {
    inputTokens,
    expectedOutputTokens: outputTokens,
    estimatedCostUsd:
      price.source === "unknown"
        ? undefined
        : costFromTokens(inputTokens, outputTokens, price),
    priceSource: price.source,
  };
}

export function estimateActualCost(
  provider: ProviderConfig,
  inputTokens: number,
  outputText: string
) {
  const price = priceForProvider(provider);
  if (price.source === "unknown") {
    return undefined;
  }

  return costFromTokens(inputTokens, estimateTokens(outputText), price);
}

export function usageRecordCost(record: UsageRecord) {
  if (record.estimatedCostUsd !== undefined) {
    return record.estimatedCostUsd;
  }

  const price = openAiReferencePriceForModel(record.model);
  if (!price) {
    return undefined;
  }

  return costFromTokens(record.inputTokens, record.outputTokens, price);
}

function costFromTokens(inputTokens: number, outputTokens: number, price: TokenPrice) {
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export function getBudgetSummary(
  settings: AppSettings,
  records: UsageRecord[],
  dateKey = budgetDateKey()
): BudgetSummary {
  const successfulRecords = records.filter(
    (record) => record.dateKey === dateKey && record.status === "success"
  );
  const knownSpendUsd = successfulRecords.reduce(
    (total, record) => total + (usageRecordCost(record) || 0),
    0
  );
  const wordMemDailyBudgetUsd = Math.max(0, settings.wordMemDailyBudgetUsd || 0);
  const remainingUsd = Math.max(0, wordMemDailyBudgetUsd - knownSpendUsd);

  return {
    dateKey,
    knownSpendUsd,
    remainingUsd,
    wordMemDailyBudgetUsd,
    reservedBudgetUsd: Math.max(0, settings.reservedBudgetUsd || 0),
    dailyTotalBudgetUsd: Math.max(0, settings.dailyTotalBudgetUsd || 0),
    economyMode: knownSpendUsd >= Math.max(0, settings.economyModeThresholdUsd || 0),
    blocked: knownSpendUsd >= wordMemDailyBudgetUsd,
    successfulRecords,
  };
}

export function validateBudgetForRequest(
  settings: AppSettings,
  summary: BudgetSummary,
  estimate: BudgetEstimate
) {
  if (summary.blocked) {
    return "今日 WordMem AI 预算已到上限，已停止自动模型调用。";
  }

  if (estimate.estimatedCostUsd === undefined) {
    return "";
  }

  if (estimate.estimatedCostUsd > Math.max(0, settings.perRequestBudgetUsd || 0)) {
    return `本次预计 $${formatUsd(estimate.estimatedCostUsd)}，超过单次上限 $${formatUsd(
      settings.perRequestBudgetUsd
    )}。`;
  }

  if (summary.knownSpendUsd + estimate.estimatedCostUsd > summary.wordMemDailyBudgetUsd) {
    return `本次预计会超过今日 WordMem 上限 $${formatUsd(summary.wordMemDailyBudgetUsd)}。`;
  }

  return "";
}

export function routeProviderForTask(
  settings: AppSettings,
  request: AiExplainRequest,
  economyMode: boolean
): RoutedProvider {
  const taskType = request.taskType || "explain";
  const baseProvider = settings.providers[settings.activeProvider];
  const hard = isHardRequest(request);
  const model = chooseModel(baseProvider, taskType, hard, economyMode);
  const reasoningEffort = chooseReasoningEffort(baseProvider, taskType, hard, economyMode);
  const reasonParts = [
    taskLabel(taskType),
    hard ? "复杂概念" : "普通术语",
    economyMode ? "省钱模式" : "标准模式",
  ];

  return {
    providerId: settings.activeProvider,
    provider: {
      ...baseProvider,
      defaultModel: model,
      reasoningEffort,
    },
    taskType,
    routeReason: reasonParts.join(" / "),
  };
}

function isHardRequest(request: AiExplainRequest) {
  const text = `${request.term}\n${request.sourceContext}\n${request.pastedRawAnswer}`.toLowerCase();
  const hasFormula = /(\$\$?|\\theta|\\pi|\\gamma|θ|π|∑|√|≤|≥|≈|=)/.test(text);
  const hasHardKeyword = HARD_KEYWORDS.some((keyword) => text.includes(keyword));
  const looksLikeGroup = /[,，/、;]/.test(request.term || "");
  const isLong = estimateTokens(request.pastedRawAnswer || "") > 900;

  return hasFormula || hasHardKeyword || looksLikeGroup || isLong;
}

function uniqueModels(provider: ProviderConfig) {
  return Array.from(new Set([provider.defaultModel, ...provider.models].filter(Boolean)));
}

function firstAvailable(models: string[], candidates: string[]) {
  return candidates.find((candidate) => models.includes(candidate));
}

function chooseModel(
  provider: ProviderConfig,
  taskType: AiTaskType,
  hard: boolean,
  economyMode: boolean
) {
  const models = uniqueModels(provider);

  if (provider.id === "deepseek") {
    const flash = firstAvailable(models, ["deepseek-v4-flash", "deepseek-chat"]);
    const pro = firstAvailable(models, ["deepseek-v4-pro", "deepseek-reasoner"]);
    if (taskType === "review") {
      return pro || flash || provider.defaultModel;
    }
    if (taskType === "summarize" || taskType === "tag" || taskType === "memory_profile") {
      return flash || provider.defaultModel;
    }
    return economyMode || !hard ? flash || provider.defaultModel : pro || flash || provider.defaultModel;
  }

  const cheap = firstAvailable(models, ["gpt-5.4-mini", "gpt-5-mini", "gpt-4o-mini"]);
  const balanced = firstAvailable(models, ["gpt-5.4", "gpt-5", "gpt-4.1"]);
  const frontier = firstAvailable(models, ["gpt-5.5", "gpt-5.5-pro"]);

  if (taskType === "review") {
    return frontier || balanced || cheap || provider.defaultModel;
  }
  if (taskType === "summarize" || taskType === "tag" || taskType === "memory_profile") {
    return cheap || balanced || provider.defaultModel;
  }
  if (economyMode) {
    return cheap || balanced || provider.defaultModel;
  }

  return hard ? balanced || frontier || cheap || provider.defaultModel : cheap || balanced || provider.defaultModel;
}

function chooseReasoningEffort(
  provider: ProviderConfig,
  taskType: AiTaskType,
  hard: boolean,
  economyMode: boolean
): ReasoningEffort {
  if (provider.wireApi === "chat_completions" || provider.id === "deepseek") {
    return provider.reasoningEffort;
  }
  if (taskType === "review") {
    return "xhigh";
  }
  if (taskType === "summarize" || taskType === "tag" || taskType === "memory_profile") {
    return "low";
  }
  if (economyMode) {
    return "low";
  }
  return hard ? "high" : "medium";
}

export function taskLabel(taskType: AiTaskType) {
  if (taskType === "review") {
    return "专家审阅";
  }
  if (taskType === "summarize") {
    return "后台整理";
  }
  if (taskType === "tag") {
    return "标签摘要";
  }
  if (taskType === "memory_profile") {
    return "记忆偏好";
  }
  return "术语解释";
}

export function formatUsd(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) {
    return "未知";
  }

  if (value < 0.01) {
    return value.toFixed(4);
  }

  return value.toFixed(2);
}
