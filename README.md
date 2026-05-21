# WordMem 工作术语知识卡片

本项目是一个本地优先的 PWA，用来记录工作中遇到的英文词、专业术语、缩写和概念。当前默认面向深度学习、机器学习、强化学习、机器人运动控制和 motion retargeting / GMR 等工作语境。数据优先缓存在浏览器 IndexedDB，也可以启用后端 SQLite 同步，让电脑和手机共用同一个词库。

## 运行

```bash
npm install
npm run dev
```

访问：

```text
http://127.0.0.1:5173/
```

`npm run dev` 会同时启动前端和本地 AI 代理，前端请求 `/api/ai/explain`，由代理转发到 OpenAI、DeepSeek 或自定义 endpoint，避免浏览器 CORS 拦截。

## 后端同步

启用后端同步后，卡片、设置、用量记录和 provider API Key 会保存到后端 SQLite：

```bash
export WORDMEM_SYNC_TOKEN="换成一个长随机 token"
export WORDMEM_DATA_KEY="换成至少 32 位的本地加密密钥"
export WORDMEM_TRUSTED_SYNC=1 # 可选：Tailscale 私有访问时，打开网站自动同步
export WORDMEM_DB_PATH="data/wordmem.sqlite" # 可选，默认就是这个路径
npm run dev
```

也可以把这些变量写进 `.env.local`。`WORDMEM_SYNC_TOKEN` 用来保护同步接口；`WORDMEM_DATA_KEY` 只用于 AES-256-GCM 加密后端保存的 API Key。两者要分开设置，且不要提交到仓库。

如果设置 `WORDMEM_TRUSTED_SYNC=1`，前端会在打开网页时自动使用后端同步，不需要每个新浏览器手动填写 token。这个模式只适合 Tailscale 这类私有网络：能打开这个 WordMem 地址的设备，也就能读写你的词库。

同步接口：

- `GET /api/sync/snapshot`
- `POST /api/sync/cards`
- `DELETE /api/sync/cards/:id`
- `POST /api/sync/settings`
- `POST /api/sync/usage`

所有同步接口都需要请求头：

```text
Authorization: Bearer <WORDMEM_SYNC_TOKEN>
```

前端设置页里打开「后端同步」，填服务地址和同步 token。服务地址留空表示使用当前页面同源后端；如果手机通过 Tailscale 访问电脑，可以填类似：

```text
http://100.x.x.x:5173
```

如果要让手机直接访问开发服务：

```bash
HOST=0.0.0.0 npm run dev
```

然后在手机浏览器打开：

```text
http://你的-tailscale-ip:5173/
```

首次启用时，如果后端是空库且当前浏览器已有卡片，WordMem 不会自动覆盖后端；需要你在设置页点击「上传本机数据到后端」。后端有数据后，启动和手动拉取时以后端为准。

## 可用功能

- 新增、编辑、删除工作术语卡片
- 使用简化卡片结构：术语、标签、工作上下文、正文解释
- 正文编辑保持纯文本；预览模式渲染 Markdown、GFM 表格、HTML 和 LaTeX 公式
- 独立公式建议写成块级 `$$...$$`，预览会用更大的 KaTeX 样式渲染
- 旧版多字段卡片会在读取和导入时自动合并进正文
- 按术语、正文、工作上下文、标签和模型信息全文搜索
- 粘贴 GPT / DeepSeek 回答后，让 AI 整理成结构化卡片
- AI 原始回答默认写入 Markdown 正文：分节标题、列表、加粗重点词、行内代码和 LaTeX 公式
- AI 默认使用“工作语境长解释”风格：等号释义、项目场景、对比例子、价值说明和一句话总结
- AI 默认按深度学习、强化学习、机器人运动控制、policy rollout、MuJoCo、GMR、motion retargeting 等语境解释术语
- 个人记忆：AI 解释时自动参考最多 3 张相关旧卡片和你的个人偏好；只发送短摘录，不上传整库
- 预算中心：默认每天 `$500` 总额度，其中 `$200` 保留给你，WordMem 自动 AI 最多使用 `$300/day`
- 模型路由：普通解释优先便宜模型，复杂概念用更强模型，专家审阅优先高质量模型
- 本地用量记录：保存 provider、model、任务类型、估算 token、估算费用和请求状态，可单独导出
- 后端同步：可用 SQLite 文件同步卡片、设置、用量记录和加密后的 API Key
- 设置 OpenAI、DeepSeek、BXI AI 或自定义 OpenAI-compatible provider
- 每个 provider 可选择 Responses API 或 Chat Completions，并设置 reasoning effort
- 导入/导出 JSON 备份；导出不包含 API Key
- PWA manifest 和生产环境 service worker

## AI 配置

在应用右上角进入「设置」：

- OpenAI 中转默认 Base URL：`https://api.openai.com/v1`
- DeepSeek 默认 Base URL：`https://api.deepseek.com`
- DeepSeek 默认模型：`deepseek-v4-flash`
- OpenAI 默认模型：`gpt-5.4-mini`
- BXI AI 默认预填：`https://ai.bxirobotics.cn/v1`、`gpt-5.4-mini`、`Responses API`、`medium`
- 自定义 provider 默认预填：`https://api.86gamestore.com`、`gpt-5.4`、`Responses API`、`xhigh`
- 设置页默认只显示 Provider、API Key 和模型；Base URL、Wire API、Reasoning effort 和响应存储在高级设置里
- 非 OpenAI provider 可以在高级设置中手动填写输入/输出 `$ / 1M tokens` 单价；留空时费用显示为未知，不做美元级预算拦截
- Responses API 请求默认带 `store: false`，可在设置页高级区域关闭
- 个人偏好可以在设置页编辑；JSON 导出只包含卡片，不包含 API Key 或个人偏好

## AI 正文格式

模型调用仍要求返回 JSON 对象，便于提取 `term`、`pronunciation`、`tags` 和 `body`。其中 `body` 会被写入卡片正文，并要求是 Markdown 笔记：

- 使用 `## 简单理解`、`## 工作语境`、`## 典型用法`、`## 对比理解`、`## 例子`、`## 记忆句` 等分节
- 重点术语用 `**加粗**`
- 工作流词、变量和指标用行内代码，例如 `rollout`、`episode return`、`root RMSE`
- 短公式用行内 LaTeX：`$a_t \sim \pi(a|s_t)$`
- 独立公式用块级 LaTeX，并让 `$$` 独占一行

## 预算策略

- 默认每日总额度：`$500`
- 默认保留给你手动使用：`$200`
- WordMem 自动功能每日硬上限：`$300`
- 默认到 `$250` 进入省钱模式，到 `$300` 停止自动 AI 调用
- 默认单次请求上限：`$25`
- 后台整理任务默认关闭，需要在「预算中心」手动打开

第一版使用本地 token 估算，不读取 provider 真实账单。OpenAI 模型会使用内置参考价估算；DeepSeek、BXI 和自定义 endpoint 如果没有填写手动单价，会显示“费用未知”。

未启用后端同步时，API Key 仍保存在浏览器本地。启用同步并保存设置后，API Key 会用 `WORDMEM_DATA_KEY` 加密写入 `data/wordmem.sqlite`，同步 snapshot 和 JSON 导出不会包含明文 Key。这个版本仍按单用户个人工具设计，建议只通过 Tailscale 暴露，不要直接面向公网。

## 检查

```bash
npm test
```

如果想用一个服务运行构建后的版本：

```bash
npm run serve
```

访问：

```text
http://127.0.0.1:4173/
```

## 手机端 App 预览

轻量预览手机布局，不需要安装 Android 模拟器：

```bash
npm run preview:mobile
```

电脑浏览器打开：

```text
http://127.0.0.1:4173/?mobilePreview=1
```

手机通过 Tailscale 打开终端打印的 `http://100.x.x.x:4173/` 地址。普通 HTTP 的 Tailscale 地址不一定能触发浏览器 PWA 安装；后续 Android APK 会用 Capacitor 打包本地静态页面，再连接这个 Tailscale 后端。

Android 项目入口：

```bash
npm run android:sync
npm run android:build
```

如果本机还没有 Android SDK/adb，`android:build` 会提示缺少 `ANDROID_HOME` 或 `android/local.properties`；安装 Android SDK 后再执行即可生成 debug APK。

当前环境使用 Node 12，因此 Vite 固定在兼容旧 Node 的版本。`npm audit` 会提示旧 Vite/rollup/esbuild 的开发服务器相关告警；默认 dev/preview 只监听 `127.0.0.1`。升级到新版 Node 后，可以再升级 Vite 来消除这些告警。
