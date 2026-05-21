export type AiProviderId = "openai" | "deepseek" | "bxi" | "custom";
export type WireApi = "responses" | "chat_completions";
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type AiTaskType = "explain" | "review" | "summarize" | "tag" | "memory_profile";
export type UsageStatus = "success" | "failed" | "blocked";

export type KnowledgeCard = {
  id: string;
  term: string;
  body: string;
  sourceContext: string;
  tags: string[];
  providerId?: AiProviderId;
  model?: string;
  createdAt: string;
  updatedAt: string;
  pronunciation?: string;
  shortMeaning?: string;
  detailedExplanation?: string;
  workUsage?: string;
  examples?: string;
  confusingConcepts?: string;
  memorySentence?: string;
  rawAiAnswer?: string;
};

export type StructuredDraft = {
  term?: string;
  body?: string;
  sourceContext?: string;
  tags?: string[];
  pronunciation?: string;
  shortMeaning?: string;
  detailedExplanation?: string;
  workUsage?: string;
  examples?: string;
  confusingConcepts?: string;
  memorySentence?: string;
  rawAnswerMarkdown?: string;
};

export type ProviderConfig = {
  id: AiProviderId;
  label: string;
  apiKey: string;
  apiKeySaved?: boolean;
  baseUrl: string;
  wireApi: WireApi;
  defaultModel: string;
  reasoningEffort: ReasoningEffort;
  models: string[];
  inputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
};

export type BackendSyncConfig = {
  enabled: boolean;
  baseUrl: string;
  token: string;
  trustedAutoSync?: boolean;
  lastSyncedAt?: string;
  pendingChanges?: boolean;
};

export type AppSettings = {
  id: "app";
  activeProvider: AiProviderId;
  providers: Record<AiProviderId, ProviderConfig>;
  disableResponseStorage: boolean;
  memoryEnabled: boolean;
  personalPreference: string;
  dailyTotalBudgetUsd: number;
  reservedBudgetUsd: number;
  wordMemDailyBudgetUsd: number;
  economyModeThresholdUsd: number;
  perRequestBudgetUsd: number;
  enableBackgroundAiTasks: boolean;
  backendSync: BackendSyncConfig;
  updatedAt: string;
};

export type RelatedMemoryCard = {
  id: string;
  term: string;
  tags: string[];
  sourceContext: string;
  bodyExcerpt: string;
};

export type AiMemoryContext = {
  personalPreference: string;
  relatedCards: RelatedMemoryCard[];
};

export type AiExplainRequest = {
  term: string;
  sourceContext: string;
  pastedRawAnswer: string;
  taskType?: AiTaskType;
  memoryContext?: AiMemoryContext;
};

export type AiExplainResult = {
  rawAnswer: string;
  structuredDraft?: StructuredDraft;
  providerId: AiProviderId;
  model: string;
};

export type UsageRecord = {
  id: string;
  dateKey: string;
  createdAt: string;
  providerId: AiProviderId;
  providerLabel: string;
  model: string;
  taskType: AiTaskType;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
  status: UsageStatus;
  routeReason?: string;
  error?: string;
};

export type ExportPayload = {
  app: "wordmem";
  version: 1 | 2;
  exportedAt: string;
  cards: KnowledgeCard[];
};

export type UsageExportPayload = {
  app: "wordmem";
  version: 1;
  exportedAt: string;
  usageRecords: UsageRecord[];
};
