import { config, providerDefault } from "./config.js";
import { Errors } from "./errors.js";

export type ApiFormat = "openai" | "anthropic" | "gemini";

export const API_FORMATS: readonly ApiFormat[] = ["openai", "anthropic", "gemini"];

export function isApiFormat(v: unknown): v is ApiFormat {
  return typeof v === "string" && (API_FORMATS as readonly string[]).includes(v);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  format: ApiFormat;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

// ── SSRF 防护：上游 URL 白名单校验（创建 Key 与每次调用时都执行）──

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\]|\[fc[0-9a-f]{2}:|\[fd[0-9a-f]{2}:|\[fe80:)/i;

export function validateUpstreamUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Errors.badRequest("baseUrl 不是合法 URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw Errors.badRequest("baseUrl 只允许 http/https 协议");
  }
  if (!config.allowPrivateUpstream && PRIVATE_HOST.test(url.hostname)) {
    throw Errors.badRequest("baseUrl 指向内网/环回地址（自托管本地模型请设 LUMINA_ALLOW_PRIVATE_UPSTREAM=true）");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function resolveBaseUrl(provider: string, baseUrlOverride?: string | null): string {
  if (baseUrlOverride) return validateUpstreamUrl(baseUrlOverride);
  const def = providerDefault(provider);
  if (!def) throw Errors.badRequest(`未知的提供商：${provider}`);
  return def.baseUrl;
}

// ── 各格式的端点 / 请求体 / 认证头 / 响应解析 ──

function openaiEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function anthropicEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/messages`;
}

function geminiEndpoint(baseUrl: string, model: string, stream: boolean): string {
  const b = baseUrl.replace(/\/+$/, "");
  // baseUrl 期望形如 https://generativelanguage.googleapis.com/v1beta
  const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
  return `${b}/models/${encodeURIComponent(model)}:${action}`;
}

interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function buildOpenAI(o: CallOptions, stream: boolean): WireRequest {
  return {
    url: openaiEndpoint(o.baseUrl),
    headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
    body: {
      model: o.model,
      messages: o.messages,
      temperature: o.temperature ?? 0.9,
      max_tokens: o.maxTokens ?? 1024,
      stream,
    },
  };
}

function buildAnthropic(o: CallOptions, stream: boolean): WireRequest {
  const system = o.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  return {
    url: anthropicEndpoint(o.baseUrl),
    headers: {
      "content-type": "application/json",
      "x-api-key": o.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: o.model,
      ...(system ? { system } : {}),
      messages: o.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
      max_tokens: o.maxTokens ?? 1024,
      temperature: o.temperature ?? 0.9,
      ...(stream ? { stream: true } : {}),
    },
  };
}

function buildGemini(o: CallOptions, stream: boolean): WireRequest {
  const system = o.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  return {
    url: geminiEndpoint(o.baseUrl, o.model, stream),
    headers: { "content-type": "application/json", "x-goog-api-key": o.apiKey },
    body: {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: o.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      generationConfig: {
        temperature: o.temperature ?? 0.9,
        maxOutputTokens: o.maxTokens ?? 1024,
      },
    },
  };
}

function buildRequest(o: CallOptions, stream: boolean): WireRequest {
  switch (o.format) {
    case "anthropic":
      return buildAnthropic(o, stream);
    case "gemini":
      return buildGemini(o, stream);
    default:
      return buildOpenAI(o, stream);
  }
}

function openaiDelta(json: unknown): string {
  const j = json as { choices?: Array<{ delta?: { content?: string } }> };
  return j.choices?.[0]?.delta?.content ?? "";
}

function openaiText(json: unknown): string {
  const j = json as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content ?? "";
}

function anthropicDelta(json: unknown): string {
  const j = json as { type?: string; delta?: { type?: string; text?: string } };
  return j.type === "content_block_delta" && j.delta?.type === "text_delta"
    ? (j.delta.text ?? "")
    : "";
}

function anthropicText(json: unknown): string {
  const j = json as { content?: Array<{ type?: string; text?: string }> };
  return (j.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

function geminiDelta(json: unknown): string {
  const j = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return (j.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");
}

const geminiText = geminiDelta;

function deltaOf(format: ApiFormat, json: unknown): string {
  switch (format) {
    case "anthropic":
      return anthropicDelta(json);
    case "gemini":
      return geminiDelta(json);
    default:
      return openaiDelta(json);
  }
}

function textOf(format: ApiFormat, json: unknown): string {
  switch (format) {
    case "anthropic":
      return anthropicText(json);
    case "gemini":
      return geminiText(json);
    default:
      return openaiText(json);
  }
}

async function readError(format: ApiFormat, res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Record<string, unknown>;
    if (format === "anthropic" && typeof body.error === "object" && body.error) {
      const e = body.error as { message?: string };
      if (e.message) return e.message;
    }
    if (format === "gemini" && typeof body.error === "object" && body.error) {
      const e = body.error as { message?: string };
      if (e.message) return e.message;
    }
    const generic = body as {
      error?: { message?: string } | string;
      message?: string;
      msg?: string;
    };
    if (typeof generic.error === "object" && generic.error?.message) return generic.error.message;
    if (typeof generic.error === "string") return generic.error;
    return generic.message ?? generic.msg ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** 非流式调用（按 format 适配）。失败抛 BizError，由路由层决定降级。 */
export async function callChat(
  opts: CallOptions,
): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number } | null }> {
  const wire = buildRequest(opts, false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(wire.url, {
      method: "POST",
      headers: wire.headers,
      body: JSON.stringify(wire.body),
      signal: controller.signal,
    });
    if (!res.ok) throw Errors.upstream(await readError(opts.format, res));
    const json = await res.json();
    return { text: textOf(opts.format, json), usage: null };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw Errors.upstream("上游响应超时");
    if (e && typeof e === "object" && "code" in e) throw e; // BizError
    throw Errors.upstream(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** 流式调用：统一产出文本增量，SSE 事件格式差异在各自解析器内消化。 */
export async function* callChatStream(opts: CallOptions): AsyncGenerator<string> {
  const wire = buildRequest(opts, true);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(wire.url, {
      method: "POST",
      headers: wire.headers,
      body: JSON.stringify(wire.body),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw Errors.upstream(await readError(opts.format, res));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const delta = deltaOf(opts.format, JSON.parse(payload));
          if (delta) yield delta;
        } catch {
          // 忽略无法解析的心跳/杂项行
        }
      }
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw Errors.upstream("上游响应超时");
    if (e && typeof e === "object" && "code" in e) throw e;
    throw Errors.upstream(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
