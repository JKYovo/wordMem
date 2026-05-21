import type {
  AiProviderId,
  AppSettings,
  KnowledgeCard,
  ProviderConfig,
  ReasoningEffort,
  WireApi,
} from "./types";

export const DEFAULT_OPENAI_MODELS = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"];

export const DEFAULT_DEEPSEEK_MODELS = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "deepseek-chat",
  "deepseek-reasoner",
];

export const DEFAULT_BXI_MODELS = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"];
export const DEFAULT_BACKEND_SYNC_BASE_URL =
  (import.meta.env.VITE_WORDMEM_DEFAULT_BACKEND_URL as string | undefined) || "";

export const EMPTY_CARD_TEXT = "";

export const DEFAULT_PERSONAL_PREFERENCE = `我的主要使用场景是深度学习、机器学习、强化学习、机器人运动控制、仿真评测、GMR / motion retargeting、policy rollout 和 debug。

解释术语时请优先放到这些工作语境里理解，风格像一个懂项目的同事在耐心解释：先给“term = 中文理解”的等号释义，再结合训练/评测/rollout/debug 场景说明，必要时对比易混概念，最后给一句好记的总结。

不要写成考试词典或百科条目；如果上下文不足，请使用“通常 / 大概率 / 可以理解为 / 更接近”这类谨慎表达。`;

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function providerConfig(
  id: AiProviderId,
  label: string,
  baseUrl: string,
  wireApi: WireApi,
  defaultModel: string,
  reasoningEffort: ReasoningEffort,
  models: string[]
): ProviderConfig {
  return {
    id,
    label,
    apiKey: "",
    baseUrl,
    wireApi,
    defaultModel,
    reasoningEffort,
    models,
  };
}

export function createDefaultSettings(): AppSettings {
  return {
    id: "app",
    activeProvider: "openai",
    providers: {
      openai: providerConfig(
        "openai",
        "OpenAI 中转",
        "https://api.openai.com/v1",
        "responses",
        "gpt-5.4-mini",
        "medium",
        DEFAULT_OPENAI_MODELS
      ),
      deepseek: providerConfig(
        "deepseek",
        "DeepSeek",
        "https://api.deepseek.com",
        "chat_completions",
        "deepseek-v4-flash",
        "none",
        DEFAULT_DEEPSEEK_MODELS
      ),
      bxi: providerConfig(
        "bxi",
        "BXI AI",
        "https://ai.bxirobotics.cn/v1",
        "responses",
        "gpt-5.4-mini",
        "medium",
        DEFAULT_BXI_MODELS
      ),
      custom: providerConfig(
        "custom",
        "OpenAI-compatible",
        "https://api.86gamestore.com",
        "responses",
        "gpt-5.4",
        "xhigh",
        ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5"]
      ),
    },
    disableResponseStorage: true,
    memoryEnabled: true,
    personalPreference: DEFAULT_PERSONAL_PREFERENCE,
    dailyTotalBudgetUsd: 500,
    reservedBudgetUsd: 200,
    wordMemDailyBudgetUsd: 300,
    economyModeThresholdUsd: 250,
    perRequestBudgetUsd: 25,
    enableBackgroundAiTasks: false,
    backendSync: {
      enabled: false,
      baseUrl: DEFAULT_BACKEND_SYNC_BASE_URL,
      token: "",
      trustedAutoSync: false,
      lastSyncedAt: "",
      pendingChanges: false,
    },
    updatedAt: nowIso(),
  };
}

export function createEmptyCard(): KnowledgeCard {
  const stamp = nowIso();

  return {
    id: createId("card"),
    term: EMPTY_CARD_TEXT,
    body: EMPTY_CARD_TEXT,
    sourceContext: EMPTY_CARD_TEXT,
    tags: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
}
