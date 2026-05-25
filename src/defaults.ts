import type {
  AiProviderId,
  AppSettings,
  KnowledgeCard,
  KnowledgeLibrary,
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
export const DEFAULT_BACKEND_SYNC_TOKEN =
  (import.meta.env.VITE_WORDMEM_DEFAULT_SYNC_TOKEN as string | undefined) || "";

export const EMPTY_CARD_TEXT = "";
export const DEFAULT_LIBRARY_ID = "ml-robotics";
export const QUANT_LIBRARY_ID = "quant-futures";

export const DEFAULT_PERSONAL_PREFERENCE = `我的主要使用场景是深度学习、机器学习、强化学习、机器人运动控制、仿真评测、GMR / motion retargeting、policy rollout 和 debug。

解释术语时请优先放到这些工作语境里理解，风格像一个懂项目的同事在耐心解释：先给“term = 中文理解”的等号释义，再结合训练/评测/rollout/debug 场景说明，必要时对比易混概念，最后给一句好记的总结。

不要写成考试词典或百科条目；如果上下文不足，请使用“通常 / 大概率 / 可以理解为 / 更接近”这类谨慎表达。`;

const LEGACY_QUANT_PERSONAL_PREFERENCE = `我的主要使用场景是量化交易、期货、因子研究、回测、风险管理、仓位管理、盘口/成交、套利、CTA、统计建模和时间序列分析。

解释术语时请优先放到量化研究和交易系统语境里理解：先给“term = 中文理解”的等号释义，再结合数据、信号、回测、实盘执行、风控、交易成本和期货合约机制说明。必要时区分研究口径、交易口径和风控口径。

不要写成泛泛的财经百科；如果上下文不足，请使用“通常 / 在量化里 / 在期货交易里 / 更接近”这类谨慎表达。`;

export const DEFAULT_QUANT_PERSONAL_PREFERENCE = `我是量化交易和期货方向的新手，主要目标是系统补知识、建立概念框架，而不是直接写实盘交易方案。

解释术语时请按“零基础但认真学习”的方式来写：先用一句话说明它是什么，再补必要的前置概念，然后说明它在量化研究、期货合约、因子、回测、风控、仓位、盘口/执行里的位置。不要默认我已经懂 alpha、因子、IC、CTA、基差、展期、滑点、保证金这些词；如果必须使用，请顺手解释。

风格要像一个懂量化的同事在带我入门：多用小例子、流程图式分段、常见误区和“这件事为什么重要”。避免上来就堆公式或交易黑话；公式可以有，但要先讲直觉。`;

export function createDefaultLibraries(
  legacyPersonalPreference = DEFAULT_PERSONAL_PREFERENCE
): KnowledgeLibrary[] {
  return [
    {
      id: DEFAULT_LIBRARY_ID,
      name: "深度学习/机器人",
      description: "深度学习、强化学习、机器人控制、GMR、rollout、debug",
      personalPreference: legacyPersonalPreference || DEFAULT_PERSONAL_PREFERENCE,
      defaultSourceContext:
        "深度学习、强化学习、机器人运动控制、仿真评测、GMR / motion retargeting、policy rollout、debug",
    },
    {
      id: QUANT_LIBRARY_ID,
      name: "量化/期货",
      description: "量化/期货入门、因子、回测、风控、盘口、CTA",
      personalPreference: DEFAULT_QUANT_PERSONAL_PREFERENCE,
      defaultSourceContext:
        "量化/期货入门、基础概念、期货合约、因子研究、回测、风险管理、仓位、盘口/执行、CTA、统计建模",
    },
  ];
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLibraryPersonalPreference(
  id: string,
  value: unknown,
  fallback: KnowledgeLibrary | undefined,
  legacyPersonalPreference: string
) {
  const text = clean(value);

  if (id === QUANT_LIBRARY_ID && (!text || text === LEGACY_QUANT_PERSONAL_PREFERENCE)) {
    return fallback?.personalPreference || DEFAULT_QUANT_PERSONAL_PREFERENCE;
  }

  return text || fallback?.personalPreference || legacyPersonalPreference;
}

export function normalizeLibraries(
  value: unknown,
  legacyPersonalPreference = DEFAULT_PERSONAL_PREFERENCE
): KnowledgeLibrary[] {
  const defaults = createDefaultLibraries(legacyPersonalPreference);
  const defaultMap = new Map(defaults.map((library) => [library.id, library]));
  const incoming = Array.isArray(value) ? value : [];
  const normalized = new Map<string, KnowledgeLibrary>();

  incoming.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const raw = item as Partial<KnowledgeLibrary>;
    const id = clean(raw.id);
    if (!id) {
      return;
    }
    const fallback = defaultMap.get(id);
    normalized.set(id, {
      id,
      name: clean(raw.name) || fallback?.name || id,
      description: clean(raw.description) || fallback?.description || "",
      personalPreference: normalizeLibraryPersonalPreference(
        id,
        raw.personalPreference,
        fallback,
        legacyPersonalPreference
      ),
      defaultSourceContext:
        clean(raw.defaultSourceContext) || fallback?.defaultSourceContext || "",
    });
  });

  defaults.forEach((defaultLibrary) => {
    if (!normalized.has(defaultLibrary.id)) {
      normalized.set(defaultLibrary.id, defaultLibrary);
    }
  });

  return Array.from(normalized.values());
}

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
    activeLibraryId: DEFAULT_LIBRARY_ID,
    libraries: createDefaultLibraries(),
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
      enabled: Boolean(DEFAULT_BACKEND_SYNC_BASE_URL && DEFAULT_BACKEND_SYNC_TOKEN),
      baseUrl: DEFAULT_BACKEND_SYNC_BASE_URL,
      token: DEFAULT_BACKEND_SYNC_TOKEN,
      trustedAutoSync: false,
      autoSyncOnStartup: false,
      autoSyncOnSave: false,
      lastSyncedAt: "",
      pendingChanges: false,
    },
    updatedAt: nowIso(),
  };
}

export function normalizeAppSettings(stored?: Partial<AppSettings>): AppSettings {
  const defaults = createDefaultSettings();

  if (!stored) {
    return defaults;
  }

  const personalPreference = stored.personalPreference ?? defaults.personalPreference;
  const libraries = normalizeLibraries(stored.libraries, personalPreference);
  const activeLibraryId = libraries.some((library) => library.id === stored.activeLibraryId)
    ? String(stored.activeLibraryId)
    : defaults.activeLibraryId;
  const storedBackendSync: Partial<AppSettings["backendSync"]> = stored.backendSync || {};

  return {
    ...defaults,
    ...stored,
    activeProvider:
      stored.activeProvider && defaults.providers[stored.activeProvider]
        ? stored.activeProvider
        : defaults.activeProvider,
    activeLibraryId,
    libraries,
    disableResponseStorage:
      stored.disableResponseStorage ?? defaults.disableResponseStorage,
    memoryEnabled: stored.memoryEnabled ?? defaults.memoryEnabled,
    personalPreference,
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
      ...storedBackendSync,
      baseUrl: clean(storedBackendSync.baseUrl) || defaults.backendSync.baseUrl,
      token: clean(storedBackendSync.token) || defaults.backendSync.token,
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

export function createEmptyCard(
  libraryId = DEFAULT_LIBRARY_ID,
  defaultSourceContext = EMPTY_CARD_TEXT
): KnowledgeCard {
  const stamp = nowIso();

  return {
    id: createId("card"),
    libraryId,
    term: EMPTY_CARD_TEXT,
    body: EMPTY_CARD_TEXT,
    sourceContext: defaultSourceContext,
    tags: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
}
