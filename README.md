# WordMem

工作术语知识卡片 PWA。适合记录工作中遇到的英文单词、专业术语、缩写和概念，并把 AI 解释整理成长期可读、可搜索的 Markdown 笔记。

WordMem 当前默认面向深度学习、机器学习、强化学习、机器人运动控制、仿真评测、GMR / motion retargeting、policy rollout 和 debug 等工作语境。

## 亮点

- **本地优先**：卡片优先保存在浏览器 IndexedDB，离线也能读写。
- **Markdown 笔记**：正文支持 Markdown、GFM 表格、代码块、HTML 和 LaTeX 公式预览。
- **AI 整理**：可把术语或粘贴的 GPT / DeepSeek 回答整理成结构化工作笔记。
- **个人记忆**：AI 解释时会参考最多 3 张相关旧卡片和个人偏好，不上传整库。
- **多模型路由**：普通解释、专家审阅、后台整理可以按任务选择不同 provider / model。
- **知识视图**：按强化学习、机器人控制、仿真评测、GMR / retargeting 等视角浏览卡片。
- **标签整理**：可用本地规则或 DeepSeek flash 合并相似标签，保留一词多标签。
- **后端同步**：可用 SQLite 同步多设备数据，API Key 使用 AES-256-GCM 加密落库。
- **移动端友好**：支持 PWA、手机布局预览、Liquid Glass 风格和 Capacitor Android APK。

## 快速开始

```bash
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173/
```

`npm run dev` 会同时启动：

- Vite 前端：`http://127.0.0.1:5173`
- 本地 API 代理：`http://127.0.0.1:8787`

前端会通过 `/api/ai/explain` 调用本地代理，再由代理转发到 OpenAI、DeepSeek、BXI AI 或自定义 endpoint，避免浏览器 CORS 问题，也避免在客户端直接调用 provider。

## 功能概览

### 卡片

- 新增、编辑、删除术语卡片
- 字段保持轻量：`术语`、`标签`、`工作上下文`、`正文`
- 旧版多字段卡片会在读取和导入时自动合并进正文
- 支持一组术语卡片，例如 `native validation / deterministic seed / stochastic`
- 搜索范围包含术语、正文、工作上下文、标签、provider 和 model

### Markdown 与公式

正文编辑区是纯文本输入，预览区渲染 Markdown：

- 标题、列表、引用、表格、链接、代码块
- 行内公式：`$a_t \sim \pi(a|s_t)$`
- 块级公式：

```markdown
$$
J(\theta)=\mathbb{E}\left[\sum_t \gamma^t r_t\right]
$$
```

移动端预览会自动折叠长笔记段落，默认展开「简单理解」等核心段落。

### AI 工作流

AI 解释会生成 JSON 外壳，方便提取字段；其中 `body` 是可直接保存的 Markdown 笔记。

推荐正文结构：

- `## 简单理解`
- `## 工作语境`
- `## 典型用法`
- `## 对比理解`
- `## 例子`
- `## 记忆句`

生成风格偏向工作语境长解释：先给 `term = 中文理解`，再结合训练、评测、rollout、debug、GMR、policy、reference motion 等场景说明。

### 标签整理

标签整理不是重新给卡片分类，而是清理已有标签体系：

- 每张卡仍然可以有多个标签，例如 `强化学习`、`PPO`、`policy rollout`。
- 本地规则会合并大小写和常见中英文变体，例如 `RL` -> `强化学习`。
- AI 合并相似标签会使用 DeepSeek flash 一次性分析所有已有标签，只返回 alias map。
- 不会改正文、标题、工作上下文，也不会把 `PPO` 这类具体算法吞进 `强化学习`。

### 知识视图与相关卡片

词库页支持“知识视图 / 全部卡片”切换。知识视图第一版完全本地计算，不调用 AI：

- 固定视图覆盖强化学习、机器人控制、仿真评测、Retargeting / GMR、Policy / Rollout、数学与优化、Debug。
- 高频标签会自动补充成动态视图；同一张卡可以出现在多个视图里。
- 打开卡片时，正文下方会按术语、共同标签、上下文和正文关键词推荐相关卡片。
- 相关卡片只用于阅读跳转，不修改卡片正文、标签或同步数据。

### 移动端体验

手机端采用 App 化的“详情 / 词库”两屏布局，减少嵌套滚动：

- 默认打开卡片预览；底部固定操作栏提供 `词库`、`详情/编辑/预览`、`AI 操作`、`保存`。
- 词库页使用全屏列表，右下角 `+` 用于新建卡片；按钮会避开底部操作栏。
- 详情页标题、音标、卡片信息、Markdown 段落和相关卡片按手机宽度优化。
- 视觉上使用浅色 Liquid Glass 风格；正文、公式、代码块和表格保持高对比可读。
- 设置页在手机端使用和词库一致的页面宽度，provider 卡片可折叠，避免表单过长。

## Provider 配置

在应用「设置」里配置 provider、API Key 和模型。

| Provider | 默认接口 | 默认模型 | 说明 |
| --- | --- | --- | --- |
| OpenAI | Responses API | `gpt-5.4-mini` | 适合格式稳定、复杂解释和专家审阅 |
| DeepSeek | Chat Completions | `deepseek-v4-flash` | 适合高频快速生成；DeepSeek 不走 `/responses` |
| BXI AI | Responses API | `gpt-5.4-mini` | OpenAI 风格接口 |
| Custom | 可选 | `gpt-5.4` | OpenAI-compatible 自定义 endpoint |

设置页的高级区域可以修改：

- Base URL
- Wire API：`responses` 或 `chat_completions`
- Reasoning effort
- 输入 / 输出 `$ / 1M tokens` 单价
- Responses API 的 `store: false`

Provider 卡片默认只展开当前正在使用的 provider；其它 provider 会折叠，只显示名称、当前模型、接口类型和 `使用` 按钮。点击卡片标题可以展开 API Key、模型选择和高级设置。

> 提示：DeepSeek 的 OpenAI-compatible 主要指 Chat Completions 格式，不代表支持 OpenAI 的 Responses API。WordMem 后端会强制 DeepSeek 走 `chat/completions`，避免误配成 `/responses` 后返回 404。

## 高级调试：用量记录

设置页的「高级 / 调试」里保留 token 和费用估算，主要用于排查模型调用与导出用量记录。它不再作为主界面重点，也不会拦截日常 AI 使用。

| 项目 | 默认值 |
| --- | --- |
| 每日总额度 | `$500` |
| 保留给手动使用 | `$200` |
| WordMem 自动上限 | `$300/day` |
| 省钱模式阈值 | `$250/day` |
| 单次请求上限 | `$25` |
| 后台整理任务 | 默认关闭 |

OpenAI 和 DeepSeek 系模型使用内置参考价；BXI 和自定义 provider 可以在高级设置里手动填写单价。DeepSeek 估算按缓存未命中输入价计算；`deepseek-v4-pro` 会按官方优惠截止时间自动切换当前优惠价 / 原价。provider 返回真实 token usage 时会优先记录真实值，拿不到时回退本地估算。

## 后端同步

不开启后端同步时，卡片和设置只保存在当前浏览器。开启后端同步后，卡片、设置、用量记录和加密后的 provider API Key 会保存到本地 SQLite。

### 环境变量

可以把下面配置写到 `.env.local`，不要提交到仓库。

```bash
WORDMEM_SYNC_TOKEN="换成一个长随机 token"
WORDMEM_DATA_KEY="换成至少 32 位的本地加密密钥"
WORDMEM_TRUSTED_SYNC=1
WORDMEM_DB_PATH="data/wordmem.sqlite"
```

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `WORDMEM_SYNC_TOKEN` | 推荐 | 同步 API 的 Bearer token |
| `WORDMEM_DATA_KEY` | 后端保存 API Key 时必填 | AES-256-GCM 加密密钥 |
| `WORDMEM_TRUSTED_SYNC` | 可选 | 私有网络内自动信任当前后端，不需要每个浏览器手动填 token |
| `WORDMEM_DB_PATH` | 可选 | SQLite 文件路径，默认 `data/wordmem.sqlite` |
| `WORDMEM_BXI_API_KEY` | 可选 | 后端环境变量 provider key |
| `WORDMEM_DEEPSEEK_API_KEY` | 可选 | 后端环境变量 provider key |
| `VITE_WORDMEM_DEFAULT_BACKEND_URL` | 可选 | 打包时写入默认后端地址，例如 Tailscale URL |

### 同步接口

- `GET /api/sync/status`
- `GET /api/sync/snapshot`
- `POST /api/sync/cards`
- `DELETE /api/sync/cards/:id`
- `POST /api/sync/settings`
- `POST /api/sync/usage`

默认需要请求头：

```text
Authorization: Bearer <WORDMEM_SYNC_TOKEN>
```

如果启用 `WORDMEM_TRUSTED_SYNC=1`，后端会允许同一私有网络内的 WordMem 前端自动同步。这个模式只适合 Tailscale、局域网或其他可信私有网络，不建议直接暴露公网。

## 多设备访问

### 本机生产预览

```bash
npm run serve
```

打开：

```text
http://127.0.0.1:4173/
```

### 手机预览

```bash
npm run preview:mobile
```

电脑上预览手机布局：

```text
http://127.0.0.1:4173/?mobilePreview=1
```

如果电脑和手机在同一个 Tailscale / 局域网里，可以用终端打印的网络地址在手机浏览器访问。

### Android APK

同步 Web 资源到 Capacitor：

```bash
npm run android:sync
```

构建 debug APK：

```bash
npm run android:build
```

生成路径：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

如果缺少 Android SDK，Gradle 会提示配置 `ANDROID_HOME` 或 `android/local.properties`。安装 Android SDK 后重试即可。

## 数据与隐私

- JSON 导出不包含 API Key。
- `.env.local`、`data/wordmem.sqlite`、`dist/`、`node_modules/`、APK 和 Android 本地配置都被 `.gitignore` 忽略。
- 后端同步保存 API Key 时会使用 `WORDMEM_DATA_KEY` 加密。
- AI 个人记忆只把最多 3 张相关卡片的短摘录放进本次请求，不上传整个词库。
- 本项目按单用户个人工具设计。公开部署前建议改成后端鉴权、HTTPS 和更严格的 HTML 清理策略。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动前端和本地 API 代理 |
| `npm run api` | 只启动 API 代理 |
| `npm run build` | 类型检查并构建前端 |
| `npm run serve` | 构建并启动生产预览服务 |
| `npm run preview:mobile` | 构建并启动手机布局预览服务 |
| `npm run android:sync` | 构建前端并同步到 Capacitor Android |
| `npm run android:build` | 构建 Android debug APK |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 类型检查 + 前端构建 |

## 项目结构

```text
server/          本地 AI 代理、同步 API、SQLite 存储
src/             React 前端源码
src/ai/          Provider 调用和 prompt
src/data/        IndexedDB 与同步客户端
public/          PWA manifest、service worker、图标
android/         Capacitor Android 工程
```

## 常见问题

### DeepSeek 为什么必须用 Chat Completions？

DeepSeek 的 OpenAI-compatible 接口主要兼容 `chat/completions`。如果误配成 OpenAI `responses`，请求会打到 `/responses` 并返回 404。WordMem 后端已经对 DeepSeek 做了保护，会强制使用 `chat/completions`。

### 手机端为什么需要后端地址？

PWA 或 APK 里的静态页面不等于后端服务。AI 调用、同步和加密保存 API Key 都需要连到 WordMem 后端。可以在设置页填写后端服务地址，也可以在构建时通过 `VITE_WORDMEM_DEFAULT_BACKEND_URL` 写入默认地址。

### 为什么构建产物不提交？

`dist/`、APK、SQLite 数据库和本地环境文件都属于机器本地状态。公开仓库只提交源码和 Android 工程，构建产物由脚本生成。

## 运行环境

当前依赖锁定在 Vite 2.9 / Capacitor 4，兼容较旧 Node 环境。新项目环境建议使用较新的 Node LTS；如果升级 Vite / Capacitor，需要同步检查 Android 工程和构建脚本。
