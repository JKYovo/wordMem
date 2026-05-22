import type {
  AiExplainRequest,
  AiExplainResult,
  AiProviderId,
  AiTaskType,
  AppSettings,
  ProviderConfig,
  StructuredDraft,
} from "../types";
import { DEFAULT_BACKEND_SYNC_BASE_URL } from "../defaults";

const SYSTEM_PROMPT = `你是一个工作术语知识卡片助手。你的任务是把英文术语、缩写、短语或一组相关概念，解释成中文为主、中英混排的工作知识卡片。

用户的主要工作领域：
- 深度学习、机器学习、强化学习
- 机器人运动控制、仿真、policy 训练和评测
- motion retargeting / GMR / reference motion / rollout / debug
- 可能涉及 PPO、reward、reset、observation、action、MuJoCo、foot slip、penetration、root RMSE、episode return 等概念

当用户没有提供额外上下文时，优先把术语放到这些领域里解释；但不要把不相关的通用术语强行解释成机器人方向。

如果请求里提供了“个人偏好”和“相关旧卡片”：
- 优先遵守个人偏好里的领域和表达风格。
- 相关旧卡片只作为术语一致性、上下文和表达风格参考，不要大段照抄。
- 如果新术语与旧卡片相似，尽量保持定义口径一致，并指出差异。
- 如果旧卡片明显不相关，忽略它，不要强行关联。

回答必须是一个 JSON 对象，不要使用 Markdown 代码块。字段如下：
{
  "term": "术语或术语组标题",
  "pronunciation": "只填写真实 IPA 音标，例如 /ˈstɑːkæstɪk/；不知道可留空字符串。不要写中文近似读音、拼音、解释，也绝不要返回 /ipa/、/pronunciation/、IPA 这类占位符",
  "sourceContext": "如果用户给了工作上下文，提炼成一句；没有就留空",
  "tags": ["标签1", "标签2"],
  "body": "完整 Markdown 笔记正文，必须使用下面定义的解释风格"
}

解释风格要求：
1. 外层必须是纯 JSON 对象；不要用 Markdown 代码块包住 JSON；不要把 JSON 外壳写进 body。
2. body 必须是清爽 Markdown 笔记，不要写成挤在一起的大段纯文本。优先使用这些二级标题：
   - ## 简单理解
   - ## 工作语境
   - ## 典型用法
   - ## 对比理解
   - ## 例子
   - ## 记忆句
3. body 里的重点术语用加粗，例如 **stochastic policy**；英文命令、变量、指标和工作流词用 Markdown 反引号，例如 \`rollout\`、\`episode return\`、\`root RMSE\`。
4. 列表必须使用 Markdown 的 - 或 1. 2. 3.，不要把多条信息塞进同一行；每个段落之间保留空行。
5. 像一个懂用户项目的同事在耐心解释，不要像词典、考试单词书或百科条目。先给“term = 中文理解”的等号释义，再结合训练 / 评测 / rollout / debug / GMR / policy / reference motion 等语境解释。
6. 如果是一组术语，先逐个解释，再增加“三者放在一起理解”或“放到工作流里看”的对比段。
7. 解释要有工作味：可以出现 PPO、reward、reset、observation、action pipeline、reference motion、retargeting、first reset step、episode return、root RMSE、foot slip、penetration、MuJoCo replay、deterministic rollout、stochastic rollout 等用户上下文中的表达。
8. 不要过度简短。只要上下文足够，body 应该是一篇可以直接保存的 Markdown 技术笔记。
9. 不要编造用户没有给出的项目事实；如果上下文不足，就用“通常 / 大概率 / 可以理解为 / 更接近”这类谨慎表达。
10. 涉及 RL/ML 公式时使用 LaTeX。短变量用行内公式 $a_t \\sim \\pi(a|s_t)$；独立展示的公式必须用块级公式，并且 $$ 要独占一行：
$$
J(\\theta)=\\mathbb{E}[\\sum_t \\gamma^t r_t]
$$
不要把整行公式写成单个 $...$，也不要把独立公式挤在中文句子后面。不要为了炫技过度写公式。`;

function buildUserPrompt(request: AiExplainRequest) {
  const memoryContext = request.memoryContext;
  const relatedCards = memoryContext?.relatedCards || [];
  const taskType = request.taskType || "explain";
  if (taskType === "tag_merge") {
    return `本次任务：
标签归并。只分析用户已经存在的标签，把明显同义、大小写差异、中英文变体或近义写法合并为统一标签。

重要规则：
- 每张卡允许保留多个标签；不要设计单一分类。
- 只返回标签别名映射，不要重新生成卡片标签列表，不要改正文。
- 只合并明显同义或写法变体，例如 RL / reinforcement learning / 强化学习。
- 不要把不同层级或不同维度的标签吞掉，例如 PPO、policy、rollout、强化学习、机器人控制、仿真评测应该能同时存在。
- 如果不确定两个标签是否同义，不要合并。

必须只返回 JSON 对象，不要 Markdown 代码块，格式如下：
{
  "aliases": {
    "RL": "强化学习",
    "reinforcement learning": "强化学习",
    "robotics": "机器人控制"
  }
}

已有标签和示例术语：
${request.pastedRawAnswer || "[]"}

请只返回 aliases。`;
  }
  const relatedCardsText = relatedCards.length
    ? relatedCards
        .map(
          (card, index) => `${index + 1}. ${card.term}
标签：${card.tags.join(", ") || "无"}
上下文：${card.sourceContext || "无"}
摘录：${card.bodyExcerpt || "无"}`
        )
        .join("\n\n")
    : "无";

  return `本次任务：
${taskInstruction(taskType)}

术语或术语组：
${request.term || "用户没有填写术语，请从粘贴内容中提取"}

默认工作领域：
深度学习 / 机器学习 / 强化学习 / 机器人运动控制 / motion retargeting / GMR / policy rollout / 仿真评测 / debug

用户填写的具体工作上下文：
${request.sourceContext || "无"}

个人偏好：
${memoryContext?.personalPreference || "无"}

相关旧卡片：
${relatedCardsText}

用户粘贴的原始 AI/GPT 回答或资料：
${request.pastedRawAnswer || "无"}

请整理成适合长期保存和搜索的工作术语知识卡片。尤其注意：外层仍然返回 JSON，但 body 字段必须是干净 Markdown 笔记；原始回答要写成用户喜欢的“工作语境长解释”风格，而不是简短词典释义。参考旧卡片时要吸收风格和定义口径，但不要复制旧卡片正文。`;
}

function taskInstruction(taskType: AiTaskType) {
  if (taskType === "review") {
    return "专家审阅并润色当前正文：检查定义、公式、领域语境和表达清晰度；保留用户原意，直接返回一版更准确、更好读、可保存的 Markdown 正文。必须保留并改善已有 Markdown 结构，不要改回大段纯文本。保持已有块级公式格式；如果看到独立公式被写成 $...$ 或 \\(...\\)，必须改成 $$ 独占一行的块级公式。";
  }
  if (taskType === "summarize") {
    return "后台整理旧卡片：保留核心内容，补齐 Markdown 结构、标签、易混概念和简短记忆句；不要删掉重要工作细节。";
  }
  if (taskType === "tag") {
    return "给当前卡片补充搜索标签和相关词：只根据术语、上下文和正文返回 3-6 个稳定标签。优先使用这些统一标签：深度学习、机器学习、强化学习、PPO、policy、rollout、机器人控制、运动控制、仿真评测、GMR、motion retargeting、数学基础、优化算法、debug。不要重写正文；body 可以原样保留或给极短摘要。";
  }
  if (taskType === "tag_merge") {
    return "标签归并：只合并已有标签中的同义、大小写和中英文变体，返回 aliases 映射；不要把一张卡压成单一分类。";
  }
  if (taskType === "memory_profile") {
    return "从用户已有卡片中提炼个人偏好和常用领域词，输出可放进个人偏好的简短说明。";
  }
  return "解释或整理术语：生成适合保存的工作语境长解释。";
}

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function endpoint(baseUrl: string, path: string) {
  return `${trimTrailingSlash(baseUrl)}${path}`;
}

function responsesInput(text: string) {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text,
        },
      ],
    },
  ];
}

function authHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

async function readError(response: Response) {
  try {
    const payload = await response.json();
    return payload?.error?.message || payload?.error || payload?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

function extractOpenAIText(payload: any): string {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }
  if (typeof payload.text === "string") {
    return payload.text;
  }

  const parts: string[] = [];
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  choices.forEach((choice: any) => {
    collectText(choice?.message?.content, parts);
    collectText(choice?.delta?.content, parts);
    collectText(choice?.text, parts);
  });

  const output = Array.isArray(payload.output) ? payload.output : [];

  output.forEach((item: any) => {
    collectText(item?.content, parts);
    collectText(item?.text, parts);
    collectText(item?.output_text, parts);
  });

  return parts.join("\n").trim();
}

function collectText(value: any, parts: string[]) {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, parts));
    return;
  }
  if (typeof value === "object") {
    collectText(value.text, parts);
    collectText(value.output_text, parts);
    collectText(value.content, parts);
  }
}

function extractResponsesStreamText(raw: string) {
  const deltas: string[] = [];
  let completedText = "";

  raw.split(/\r?\n/).forEach((line) => {
    if (!line.startsWith("data:")) {
      return;
    }

    const data = line.slice("data:".length).trim();
    if (!data || data === "[DONE]") {
      return;
    }

    try {
      const payload = JSON.parse(data);
      if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") {
        deltas.push(payload.delta);
      }
      if (payload.type === "response.output_text.done" && typeof payload.text === "string") {
        completedText = payload.text;
      }
      if (payload.type === "response.completed" && payload.response) {
        const text = extractOpenAIText(payload.response);
        if (text) {
          completedText = text;
        }
      }
      if (Array.isArray(payload.choices)) {
        payload.choices.forEach((choice: any) => {
          collectText(choice?.delta?.content, deltas);
          if (choice?.message?.content) {
            completedText = extractOpenAIText({ choices: [choice] });
          }
        });
      }
      if (typeof payload.output_text === "string") {
        completedText = payload.output_text;
      }
    } catch {
      // Ignore non-JSON SSE data lines.
    }
  });

  return (completedText || deltas.join("")).trim();
}

function extractJsonObject(text: string): StructuredDraft | undefined {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const direct = tryParseJson(withoutFence);
  if (direct) {
    return direct;
  }

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return tryParseJson(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  return undefined;
}

function tryParseJson(value: string): StructuredDraft | undefined {
  try {
    const parsed = JSON.parse(value);
    return {
      term: stringOrUndefined(parsed.term),
      body: stringOrUndefined(parsed.body),
      sourceContext: stringOrUndefined(parsed.sourceContext),
      pronunciation: stringOrUndefined(parsed.pronunciation),
      shortMeaning: stringOrUndefined(parsed.shortMeaning),
      detailedExplanation: stringOrUndefined(parsed.detailedExplanation),
      workUsage: stringOrUndefined(parsed.workUsage),
      examples: stringOrUndefined(parsed.examples),
      confusingConcepts: stringOrUndefined(parsed.confusingConcepts),
      memorySentence: stringOrUndefined(parsed.memorySentence),
      rawAnswerMarkdown: stringOrUndefined(parsed.rawAnswerMarkdown),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.map(String).map((tag: string) => tag.trim()).filter(Boolean)
        : undefined,
    };
  } catch {
    return undefined;
  }
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function requireConfig(settings: AppSettings): ProviderConfig {
  const provider = settings.providers[settings.activeProvider];

  if (!provider) {
    throw new Error("当前 AI provider 配置不存在。");
  }

  requireUsableProvider(settings, provider);

  return provider;
}

function requireUsableProvider(_settings: AppSettings, provider: ProviderConfig) {
  if (!provider.baseUrl.trim()) {
    throw new Error(`请先在设置里填写 ${provider.label} 的 Base URL。`);
  }

  if (!provider.defaultModel.trim()) {
    throw new Error(`请先在设置里填写 ${provider.label} 的默认模型。`);
  }

}

function isHttpPageOrigin() {
  if (typeof window === "undefined") {
    return true;
  }

  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function pushUnique(values: string[], value: string) {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function localProxyUrls(settings: AppSettings) {
  const configuredBaseUrl = trimTrailingSlash(settings.backendSync?.baseUrl || "");
  const defaultBaseUrl = trimTrailingSlash(DEFAULT_BACKEND_SYNC_BASE_URL);
  const backendUrls: string[] = [];
  const urls: string[] = [];

  pushUnique(backendUrls, configuredBaseUrl ? `${configuredBaseUrl}/api/ai/explain` : "");
  pushUnique(backendUrls, defaultBaseUrl ? `${defaultBaseUrl}/api/ai/explain` : "");
  backendUrls.forEach((url) => pushUnique(urls, url));
  if (isHttpPageOrigin()) {
    pushUnique(urls, "/api/ai/explain");
  }
  return urls;
}

async function callLocalProxy(
  settings: AppSettings,
  provider: ProviderConfig,
  request: AiExplainRequest,
  signal?: AbortSignal
): Promise<AiExplainResult> {
  const authToken = settings.backendSync?.token.trim();
  const urls = localProxyUrls(settings);
  let lastError = "";

  for (let index = 0; index < urls.length; index += 1) {
    const proxyUrl = urls[index];
    let response: Response;

    try {
      response = await fetch(proxyUrl, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          providerId: provider.id || settings.activeProvider,
          provider,
          disableResponseStorage: settings.disableResponseStorage,
          request,
        }),
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new Error("AI 请求已取消。");
      }
      lastError = `${proxyUrl}：${error instanceof Error ? error.message : "请求失败"}`;
      if (index < urls.length - 1) {
        continue;
      }
      throw new Error(`本地 AI 代理请求失败：${lastError}`);
    }

    if (signal?.aborted) {
      throw new Error("AI 请求已取消。");
    }

    if (!response.ok) {
      lastError = `${proxyUrl}：${response.status}: ${await readError(response)}`;
      if ((response.status === 404 || response.status === 405) && index < urls.length - 1) {
        continue;
      }
      throw new Error(`本地 AI 代理请求失败：${lastError}`);
    }

    const payload = await response.json();
    const rawAnswer = String(payload.rawAnswer || "");

    return {
      rawAnswer,
      structuredDraft: payload.structuredDraft || extractJsonObject(rawAnswer),
      providerId: (payload.providerId || provider.id || settings.activeProvider) as AiProviderId,
      model: payload.model || provider.defaultModel,
      usage: payload.usage,
      durationMs: payload.durationMs,
    };
  }

  throw new Error(`本地 AI 代理请求失败：${lastError || "没有可用代理地址"}`);
}

async function callResponses(
  provider: ProviderConfig,
  request: AiExplainRequest,
  disableResponseStorage: boolean
) {
  const response = await fetch(endpoint(provider.baseUrl, "/responses"), {
    method: "POST",
    headers: authHeaders(provider.apiKey),
    body: JSON.stringify({
      model: provider.defaultModel,
      instructions: SYSTEM_PROMPT,
      input: responsesInput(buildUserPrompt(request)),
      temperature: 0.2,
      stream: true,
      store: disableResponseStorage ? false : undefined,
      reasoning:
        provider.reasoningEffort && provider.reasoningEffort !== "none"
          ? { effort: provider.reasoningEffort }
          : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Responses API 请求失败：${await readError(response)}`);
  }

  const raw = await response.text();
  const streamedText = extractResponsesStreamText(raw);
  if (streamedText) {
    return streamedText;
  }

  return extractOpenAIText(JSON.parse(raw));
}

async function callChatCompletions(provider: ProviderConfig, request: AiExplainRequest) {
  const response = await fetch(endpoint(provider.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: authHeaders(provider.apiKey),
    body: JSON.stringify({
      model: provider.defaultModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(request) },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Chat Completions 请求失败：${await readError(response)}`);
  }

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content || "";
}

export async function explainWithActiveProvider(
  settings: AppSettings,
  request: AiExplainRequest,
  routedProvider?: ProviderConfig,
  options: { signal?: AbortSignal } = {}
): Promise<AiExplainResult> {
  const provider = routedProvider || requireConfig(settings);
  requireUsableProvider(settings, provider);
  const proxied = await callLocalProxy(settings, provider, request, options.signal);

  if (!proxied.rawAnswer.trim()) {
    throw new Error("模型没有返回可保存的文本。");
  }

  return proxied;
}
