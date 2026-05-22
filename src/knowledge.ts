import type { KnowledgeCard } from "./types";

export type KnowledgeView = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  cards: KnowledgeCard[];
  count: number;
};

export type RelatedCardResult = {
  card: KnowledgeCard;
  score: number;
  reasons: string[];
};

type ViewDefinition = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  keywords: string[];
};

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
  "from",
  "into",
  "this",
  "that",
  "一个",
  "这个",
  "不是",
  "可以",
  "通常",
  "如果",
  "因为",
]);

const FIXED_VIEWS: ViewDefinition[] = [
  {
    id: "rl",
    title: "强化学习",
    description: "PPO、reward、policy、stochastic / deterministic、训练机制",
    tags: ["强化学习", "RL", "reinforcement learning", "PPO", "policy", "reward"],
    keywords: ["ppo", "reward", "policy gradient", "advantage", "gae", "entropy", "stochastic", "deterministic"],
  },
  {
    id: "robot-control",
    title: "机器人控制",
    description: "机器人运动控制、关节、动力学、locomotion、控制约束",
    tags: ["机器人控制", "机器人运动控制", "运动控制", "robotics", "robot control"],
    keywords: ["humanoid", "locomotion", "joint", "torque", "control", "dynamics", "kinematics", "actuator"],
  },
  {
    id: "simulation-eval",
    title: "仿真评测",
    description: "MuJoCo / Isaac、rollout、reset、tracking error、评测指标",
    tags: ["仿真评测", "仿真", "评测", "simulation", "evaluation", "MuJoCo", "rollout"],
    keywords: ["mujoco", "isaac", "rollout", "reset", "episode return", "root rmse", "foot slip", "penetration"],
  },
  {
    id: "retargeting-gmr",
    title: "Retargeting / GMR",
    description: "motion retargeting、reference motion、GMR、动作重定向",
    tags: ["motion retargeting", "retargeting", "GMR", "重定向"],
    keywords: ["retarget", "gmr", "reference motion", "motion imitation", "pose", "trajectory"],
  },
  {
    id: "policy-rollout",
    title: "Policy / Rollout",
    description: "policy 输出、动作采样、rollout 分布、训练/评测切换",
    tags: ["policy", "rollout", "动作采样"],
    keywords: ["policy", "rollout", "action", "observation", "sample", "distribution", "log-probability"],
  },
  {
    id: "math-optim",
    title: "数学与优化",
    description: "优化目标、梯度、KL、公式、概率分布和数学基础",
    tags: ["数学基础", "优化算法", "optimization", "math", "KL"],
    keywords: ["gradient", "objective", "loss", "kl", "ratio", "constraint", "probability", "distribution"],
  },
  {
    id: "debug",
    title: "Debug",
    description: "排查、复现、确定性 seed、错误指标和实验对比",
    tags: ["debug", "deterministic seed", "复现"],
    keywords: ["debug", "seed", "deterministic", "reproduce", "error", "failed", "networkerror"],
  },
];

const TAG_ALIASES: Record<string, string> = {
  rl: "强化学习",
  "reinforcement learning": "强化学习",
  robotics: "机器人控制",
  robot: "机器人控制",
  "robot control": "机器人控制",
  机器人: "机器人控制",
  机器人运动控制: "机器人控制",
  simulation: "仿真评测",
  eval: "仿真评测",
  evaluation: "仿真评测",
  仿真: "仿真评测",
  评测: "仿真评测",
  retargeting: "motion retargeting",
  重定向: "motion retargeting",
  gmr: "GMR",
  ppo: "PPO",
};

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function canonicalTag(tag: string) {
  const normalized = normalize(tag);
  return TAG_ALIASES[normalized] || tag.trim();
}

function tokenSet(value: string) {
  return new Set(
    normalize(value)
      .match(/[a-z0-9][a-z0-9_./-]*|[\u4e00-\u9fa5]{2,}/g)
      ?.map((token) => token.replace(/^[-./_]+|[-./_]+$/g, ""))
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)) || []
  );
}

function cardText(card: KnowledgeCard) {
  return [card.term, card.tags.join(" "), card.sourceContext, card.body].join("\n");
}

function normalizedCardText(card: KnowledgeCard) {
  return normalize(cardText(card));
}

function cardTags(card: KnowledgeCard) {
  return card.tags.map(canonicalTag).filter(Boolean);
}

function matchesView(card: KnowledgeCard, definition: ViewDefinition) {
  const haystack = normalizedCardText(card);
  const normalizedTags = cardTags(card).map(normalize);
  const viewTags = definition.tags.map(canonicalTag).map(normalize);

  if (normalizedTags.some((tag) => viewTags.includes(tag))) {
    return true;
  }

  return definition.keywords.some((keyword) => haystack.includes(normalize(keyword)));
}

function sortByUpdated(cards: KnowledgeCard[]) {
  return [...cards].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function uniqueTags(tags: string[]) {
  return Array.from(new Set(tags.map(canonicalTag).map((tag) => tag.trim()).filter(Boolean)));
}

export function buildKnowledgeViews(cards: KnowledgeCard[]): KnowledgeView[] {
  const fixedViews = FIXED_VIEWS.map((definition) => {
    const viewCards = sortByUpdated(cards.filter((card) => matchesView(card, definition)));
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      tags: uniqueTags(definition.tags),
      cards: viewCards,
      count: viewCards.length,
    };
  });

  const fixedTagKeys = new Set(
    FIXED_VIEWS.flatMap((view) => view.tags).map(canonicalTag).map(normalize)
  );
  const tagStats = new Map<string, { tag: string; cards: KnowledgeCard[] }>();

  cards.forEach((card) => {
    uniqueTags(card.tags).forEach((tag) => {
      const key = normalize(tag);
      if (!key || fixedTagKeys.has(key)) {
        return;
      }
      const stat = tagStats.get(key) || { tag, cards: [] };
      if (!stat.cards.some((existing) => existing.id === card.id)) {
        stat.cards.push(card);
      }
      tagStats.set(key, stat);
    });
  });

  const dynamicViews = Array.from(tagStats.values())
    .filter((stat) => stat.cards.length >= 2)
    .sort(
      (left, right) =>
        right.cards.length - left.cards.length ||
        (right.cards[0]?.updatedAt || "").localeCompare(left.cards[0]?.updatedAt || "") ||
        left.tag.localeCompare(right.tag)
    )
    .slice(0, 8)
    .map((stat) => {
      const viewCards = sortByUpdated(stat.cards);
      return {
        id: `tag:${normalize(stat.tag)}`,
        title: stat.tag,
        description: "从已有标签自动生成的高频主题",
        tags: [stat.tag],
        cards: viewCards,
        count: viewCards.length,
      };
    });

  return [...fixedViews.filter((view) => view.count > 0), ...dynamicViews];
}

export function findRelatedCards(
  current: KnowledgeCard,
  cards: KnowledgeCard[],
  limit = 5
): RelatedCardResult[] {
  const currentTerm = normalize(current.term);
  const currentTags = cardTags(current);
  const currentTagKeys = new Set(currentTags.map(normalize));
  const currentTokens = tokenSet(cardText(current));

  return cards
    .filter((card) => card.id !== current.id && (card.term.trim() || card.body.trim()))
    .map((card) => {
      const reasons: string[] = [];
      let score = 0;
      const term = normalize(card.term);
      const haystack = normalizedCardText(card);
      const tags = cardTags(card);
      const sharedTags = tags.filter((tag) => currentTagKeys.has(normalize(tag)));

      if (currentTerm && term && (term.includes(currentTerm) || currentTerm.includes(term))) {
        score += 30;
        reasons.push("术语相近");
      }

      if (sharedTags.length) {
        score += 12 + sharedTags.length * 4;
        reasons.push(`共同标签：${sharedTags.slice(0, 3).join(" / ")}`);
      }

      let matchedContext = 0;
      tokenSet([current.term, current.sourceContext, current.tags.join(" ")].join("\n")).forEach(
        (token) => {
          if (haystack.includes(token)) {
            matchedContext += 1;
          }
        }
      );
      if (matchedContext) {
        score += Math.min(18, matchedContext * 3);
        reasons.push("上下文相近");
      }

      let matchedBody = 0;
      currentTokens.forEach((token) => {
        if (haystack.includes(token)) {
          matchedBody += 1;
        }
      });
      if (matchedBody >= 3) {
        score += Math.min(12, matchedBody);
        reasons.push("正文关键词相近");
      }

      return {
        card,
        score,
        reasons: reasons.slice(0, 2),
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.card.updatedAt.localeCompare(left.card.updatedAt)
    )
    .slice(0, limit);
}
