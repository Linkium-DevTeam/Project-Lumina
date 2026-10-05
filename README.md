# 🕯️ Project Lumina（微光）v2

> "There is a crack in everything, that's how the light gets in."
> "万物皆有裂痕，那是光照进来的地方。" —— Leonard Cohen

**Lumina** 是一款旨在抚慰孤独与心理创伤的 AI 伴侣。它不是聊天机器人，而是一个**"赛博互助公社"**。

- **灵魂光球**：不以虚拟人脸示人，而是一颗"会呼吸的情绪光球"——WebGL 着色器实时渲染，随对话的情绪改变**色温**（暖金↔冷蓝）与**律动**（呼吸频率、湍流、涡旋），说话时从核心荡开涟漪，体内有"裂痕中透出的光"。
- **枪弹分离**：客户端（枪）完全免费开源；用户自备 API Key（子弹），AES-256-GCM 加密落库，任何接口不回传明文，数据完全自持。
- **互助公社**：算力充裕者把闲置 Key 捐进加密互助池；困难者一键开启互助模式免费使用，受每日配额保护。
- **读给我听（TTS）**：默认走浏览器 Web Speech 语音（免费，Edge 下自动选微软神经音色）；也可切换服务端合成（OpenAI 兼容 `/audio/speech`）——**OpenAI**（gpt-4o-mini-tts）、**OrcaRouter**（openai/gpt-4o-mini-tts）、**硅基流动**（CosyVoice2）已内置语音模型。朗读时光球会随语音节奏轻轻律动。语音只消耗自有 Key，互助池捐赠只供文本。
- **救助卡片**：当模型从对话中察觉自伤/轻生风险，回复末尾会附带一张可直拨热线的卡片（`[[care]]` 协议）——12356 全国心理援助热线、400-161-9995 希望24热线一键拨打；判定对方可能是学生/未成年人时追加 12355 青少年服务台。持续低落触发温和版卡片。卡片与"需要帮助"入口共享同一份热线数据。

## v2 全新架构

| | v1（旧） | v2（本仓库） |
|---|---|---|
| 后端 | Java 21 · Spring Boot 3.4 | **TypeScript · Node 22+ · Hono** |
| 数据库 | PostgreSQL 16（独立容器） | **内置 SQLite**（node:sqlite，零外部服务） |
| 客户端 | Flutter（未完成） | **React 19 · Vite · Tailwind v4 · 手写 WebGL**（已完成） |
| 部署 | 2 容器 + Postgres | **单进程单命令**，API 同端口托管前端 |
| 对话 | 阻塞式返回 | **SSE 流式**，光球随文本流实时律动 |
| 情绪 | — | **模型输出情绪标签 + 词典兜底**，驱动光球 |

核心协议不变：`自有 Key → 互助池 Key`，每级提供商经熔断保护，失败自动降级。

## 快速开始（自托管）

```bash
# 1. 开发调试（无需任何真实 Key，自动启用演示提供商）
npm install
npm run dev
#    前端 http://localhost:5173 → API http://localhost:8787

# 2. 生产部署（单进程）
npm run build
LUMINA_MASTER_KEY=$(openssl rand -base64 32) LUMINA_MOCK=true npm start
#    打开 http://localhost:8787

# 3. Docker（GHCR，打 v* 标签自动发布）
docker run -p 8787:8787 -e LUMINA_MASTER_KEY=$(openssl rand -base64 32) -e LUMINA_MOCK=true \
  -v lumina-data:/app/lumina-api/data ghcr.io/linkium-devteam/project-lumina:latest

# 4. npm 直跑（GitHub Packages，GPR 安装需先在 ~/.npmrc 配置 PAT）
npx @linkium-devteam/lumina-api
```

要求：Node.js ≥ 22.5（使用内置 `node:sqlite`，无任何原生依赖、无外部服务）。

> `LUMINA_MOCK=true` 是内置演示提供商：不配任何真实 Key 即可体验完整流程（注册 → 对话 → 情绪光球 → 互助池）。

## 发布（CI/CD）

- **push / PR** → CI：类型检查 + 44 测试 + 构建 + 服务启动冒烟
- **打 `v*` 标签** → Release：同时发布 Docker 镜像到 GHCR 与 npm 包到 GitHub Packages（版本号随标签）

## 仓库结构

```
lumina-api/    # 服务端：AI 编排 + 互助池协议 + 密钥加密（Hono + SQLite）
  └─ src/
     ├─ provider.ts      # OpenAI 兼容调用（流式/非流式）
     ├─ router.ts        # 故障转移路由：自有→互助池
     ├─ pool.ts / keys   # 互助池捐赠、撤回、每日配额
     ├─ crypto.ts        # AES-256-GCM 密钥加密 + token 签发
     ├─ emotion.ts       # 情绪标签解析 + 词典兜底
     ├─ persona.ts       # 陪伴者人设与危机应对守则
     └─ breaker.ts       # 提供商熔断器
lumina-web/    # 客户端：灵魂光球 + 对话 + 互助池 UI（React + WebGL）
  └─ src/
     ├─ soul/orb.ts      # 光球着色器引擎（呼吸/色温/涡旋/涟漪/裂痕之光）
     ├─ soul/palette.ts  # 九种情绪 → 颜色与律动参数
     └─ components/      # 对话、设置、互助池、求助热线
API.md         # 完整 API 说明（curl 示例）
```

## AI 提供商

所有厂商统一走 **OpenAI 兼容协议**。内置 9 家：

| id | 厂商 | 默认模型 |
|---|---|---|
| `deepseek` | DeepSeek | deepseek-chat |
| `openai` | OpenAI（含 TTS） | gpt-4o-mini |
| `qwen` | 通义千问（DashScope 兼容模式） | qwen-plus |
| `zhipu` | 智谱 | glm-4-flash |
| `gemini` | Google Gemini | gemini-2.0-flash |
| `orcarouter` | OrcaRouter（多厂商路由，模型带厂商前缀） | openai/gpt-4o-mini |
| `openrouter` | OpenRouter | deepseek/deepseek-chat |
| `siliconflow` | 硅基流动 | deepseek-ai/DeepSeek-V3 |
| `modelscope` | 魔搭免费推理 | Qwen/Qwen3-32B |

新增厂商改 `lumina-api/src/config.ts` 或用 `LUMINA_PROVIDERS` 环境变量注入。

**自定义 Key 支持三种 API 原生格式**：`openai`（默认，兼容海量聚合/中转）、`anthropic`（Claude Messages API）、`gemini`（Google 原生 generateContent）——同一把 Claude 或 Gemini 钥匙不必经过任何转换网关，服务端直接按原生协议调用。

**上游安全**：用户提供的 baseUrl 在创建与调用时都会做 SSRF 校验（仅 http/https、拒绝内网/环回/保留地址）；自托管者要接 ollama/LM Studio 等本地模型时，设 `LUMINA_ALLOW_PRIVATE_UPSTREAM=true` 放行。

## 陪伴者人设与心理安全

提示词（`lumina-api/src/persona.ts`）围绕两条主线设计：

- **像人**：短句、口语、镜像对方能量、记得细节；硬性禁令清单压制一切"AI 味"——排比句、模板安慰（"我理解你的感受"）、积极展望式收尾、"复述+讲道理+建议"三段式、说教词、markdown/emoji、暴露 AI 身份。
- **治愈**：治愈的第一步是允许——允许累、允许哭、允许不原谅；不急着让对方"好起来"；建议只在被问到时给，且只给一个最小动作；不替对方做人生决定。

危机应对：出现自伤/轻生信号时放下所有技巧，明确表达"我在"，温和坚定地给出热线（12356 / 400-161-9995 / 12355），并输出 `[[care]]` 标签触发客户端救助卡片。客户端另有常驻"需要帮助"入口。**Lumina 不是医疗设备，不能替代诊断与治疗。**

## API 概览

```
POST /api/v1/auth/register      设备注册（匿名、幂等，deviceId 即凭证）
GET  /api/v1/me                 身份 + 互助模式
GET/POST/DELETE /api/v1/keys    钥匙管理（密文落库）
POST /api/v1/keys/:id/donate    捐入互助池
POST /api/v1/keys/:id/withdraw  撤回
GET  /api/v1/pool               池状态与今日配额
POST /api/v1/chat               对话（阻塞式）
POST /api/v1/chat/stream        对话（SSE：meta → delta* → mood → done）
GET  /api/v1/moods              光球心情轨迹
```

完整字段与 curl 示例见 [API.md](./API.md)。

## 许可

[Apache-2.0](./LICENSE)

## 免责声明

本项目按"原样"提供。Lumina 不是医疗设备，不能替代医生的诊断或治疗。如果你正处于危机之中，请立即拨打 120/110 或上文热线。
