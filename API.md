# Lumina API v2 调用说明

- **Base URL**: `http://localhost:8787`（自托管默认端口）
- **接口前缀**: `/api/v1`
- **鉴权**: 注册返回的 token 放入请求头 `Authorization: Bearer <token>`
- **响应包装**: 所有接口返回统一结构

```json
{
  "success": true,
  "code": "OK",
  "message": null,
  "data": { }
}
```

`success=false` 时，`code` 为错误码（`BAD_REQUEST` / `UNAUTHORIZED` / `CONFLICT` / `RATE_LIMITED` / `PROVIDER_UNAVAILABLE` / `UPSTREAM_ERROR` …），`message` 为人类可读信息。

---

## 1. 设备注册

匿名注册，`deviceId` 由客户端生成并妥善保管（uuid 即可）。同一 `deviceId` 重复注册返回既有身份并**重发 token**——deviceId 即持有凭证。

```bash
curl -X POST http://localhost:8787/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "my-device-001", "nickname": "夜行者"}'
```

```json
{
  "success": true, "code": "OK", "message": null,
  "data": {
    "userId": 1,
    "token": "1.xxxx.yyyy",
    "user": { "id": 1, "nickname": "夜行者", "createdAt": "2026-10-04T14:00:00.000Z" },
    "deviceId": "my-device-001"
  }
}
```

建议：`TOKEN="1.xxxx.yyyy"`

### 身份与互助模式

```bash
curl http://localhost:8787/api/v1/me -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:8787/api/v1/auth/aid-mode \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

## 2. 添加自有 API Key（"装子弹"）

```bash
curl -X POST http://localhost:8787/api/v1/keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider": "deepseek", "model": "deepseek-chat", "apiKey": "sk-xxxx", "label": "主力"}'
```

- `provider`：`deepseek` / `qwen` / `zhipu` / `gemini` / `orcarouter` / `openrouter` / `siliconflow` / `modelscope` / `custom`
- `custom` 时必填 `baseUrl` 与 `model`，可选 `format`：
  - `openai`（默认）：OpenAI 兼容 `/chat/completions`（绝大多数厂商与聚合路由）
  - `anthropic`：Claude 原生 Messages API（`/v1/messages`，如 baseUrl `https://api.anthropic.com`）
  - `gemini`：Google 原生 `generateContent`（如 baseUrl `https://generativelanguage.googleapis.com/v1beta`）
- 安全：`baseUrl` 会做 SSRF 校验（仅 http/https，拒绝内网/环回/保留地址；本地模型自托管设 `LUMINA_ALLOW_PRIVATE_UPSTREAM=true`）
- 明文 `apiKey` 以 AES-256-GCM 加密入库，**任何接口不回传明文**

```json
{ "success": true, "code": "OK", "message": null,
  "data": { "id": 10, "provider": "deepseek", "model": "deepseek-chat",
            "status": "private", "format": "openai", "label": "主力",
            "createdAt": "…", "donatedAt": null } }
```

### 管理钥匙

```bash
curl http://localhost:8787/api/v1/keys -H "Authorization: Bearer $TOKEN"          # 列出
curl http://localhost:8787/api/v1/keys/providers                                  # 支持的提供商
curl -X POST http://localhost:8787/api/v1/keys/10/donate  -H "Authorization: Bearer $TOKEN"  # 捐入互助池
curl -X POST http://localhost:8787/api/v1/keys/10/withdraw -H "Authorization: Bearer $TOKEN" # 撤回
curl -X DELETE http://localhost:8787/api/v1/keys/10 -H "Authorization: Bearer $TOKEN"        # 删除（池中需先撤回）
```

## 3. 互助池

```bash
curl http://localhost:8787/api/v1/pool -H "Authorization: Bearer $TOKEN"
```

```json
{ "success": true, "code": "OK", "message": null,
  "data": { "poolKeys": 3, "aidMode": true, "poolDailyLimit": 60,
            "usedToday": 2 } }
```

路由优先级（每次对话自动执行）：**自有 Key → 互助池 Key（需开互助模式，受每日配额）**。
同一提供商连续失败 5 次熔断 30 秒，期间自动跳到下一候选。

## 4. 对话

`message` ≤ 4000 字符；`history` 为可选多轮上下文（不含本条消息，最多 16 轮）。

### 4.1 阻塞式

```bash
curl -X POST http://localhost:8787/api/v1/chat \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "message": "今天加班到很晚，有点累",
    "history": [
      {"role": "user", "content": "你好，能陪我聊聊天吗？"},
      {"role": "assistant", "content": "当然可以，我一直在。你今天过得怎么样？"}
    ]
  }'
```

```json
{
  "success": true, "code": "OK", "message": null,
  "data": {
    "text": "辛苦了。你已经很努力了，接下来把今晚留给自己。",
    "mood": { "emotion": "tired", "intensity": 0.62 },
    "provider": "deepseek", "model": "deepseek-chat", "source": "own",
    "usage": { "promptTokens": 45, "completionTokens": 32 }
  }
}
```

`mood` 由模型输出（服务端剥离，正文不可见），失败时退回本地词典分析——客户端用它驱动光球的色温与律动。
`source`: `own` / `pool` / `mock`。

### 4.2 流式（SSE）

```bash
curl -N -X POST http://localhost:8787/api/v1/chat/stream \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"message": "有点焦虑，明天要汇报"}'
```

事件序列：

```
event: meta   data: {"provider":"deepseek","model":"deepseek-chat","source":"own","keyId":10}
event: delta  data: {"text":"先呼"}
event: delta  data: {"text":"——吸——。"}
…
event: mood   data: {"emotion":"anxious","intensity":0.7}
event: care   data: {"level":"urgent","minor":true}          ← 仅当模型检出危机信号
event: done   data: {"provider":"deepseek","model":"deepseek-chat","source":"own","messageId":42,"text":"全文…","care":{"level":"urgent"}}
```

- `delta` 已服务端过滤：情绪/救助标签行（含未成形前缀）不会出现。
- `care`：模型输出 `[[care]]{"level":"urgent|gentle","minor":true}[[/care]]` 时触发。
  `urgent` = 自伤/轻生信号（客户端渲染醒目救助卡，一键直拨 12356 / 400-161-9995，
  `minor=true` 时追加 12355 青少年服务台）；`gentle` = 持续低落（温和版卡片）。
- `done.text` 为最终全文（含可能的词典兜底修正），以它为准落显示。
- 客户端断开即中止上游请求。

## 5. 心情轨迹与存档

```bash
curl "http://localhost:8787/api/v1/moods?limit=24" -H "Authorization: Bearer $TOKEN"
curl "http://localhost:8787/api/v1/moods/logs?limit=50" -H "Authorization: Bearer $TOKEN"
```

`emotion` 取值：`calm` / `joy` / `love` / `sad` / `anxious` / `angry` / `lonely` / `hopeful` / `tired`。

## 6. 语音合成（TTS）

```bash
curl -X POST http://localhost:8787/api/v1/tts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text": "晚安，好梦。", "voice": "alex", "model": "FunAudioLLM/CosyVoice2-0.5B"}'
```

- 返回 `audio/mpeg` 二进制流。
- **仅使用自有 Key**（互助池捐赠的 Key 不被语音消耗），沿 OpenAI 兼容 `/audio/speech` 逐候选降级。
- 支持语音的内置提供商：`openai`（gpt-4o-mini-tts）、`orcarouter`（openai/gpt-4o-mini-tts）、
  `siliconflow`（FunAudioLLM/CosyVoice2-0.5B）；请求 `model` 可覆盖；custom Key 必须显式传 `model`。
- 限流：每分钟 10 次。

## 7. 健康检查

```bash
curl http://localhost:8787/api/healthz
```

## 限流

| 维度 | 限额 |
|---|---|
| 单 IP 全局 | 240 次/分钟 |
| 单用户对话 | 20 次/分钟（突发 8） |
| 单用户语音合成 | 10 次/分钟 |
| 互助模式 | `LUMINA_POOL_DAILY_LIMIT`（默认 60 次/日） |
