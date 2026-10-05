import { config } from "./config.js";
import { decryptSecret } from "./crypto.js";
import {
  bumpPoolUsage,
  getPoolUsage,
  listKeys,
  listPoolKeys,
  markKeyUsed,
  today,
  type KeyRow,
} from "./db.js";
import { BizError, Errors } from "./errors.js";
import { CircuitBreaker } from "./breaker.js";
import { MockProvider } from "./mock.js";
import {
  callChat,
  callChatStream,
  isApiFormat,
  resolveBaseUrl,
  type ApiFormat,
  type ChatMessage,
} from "./provider.js";
import type { RouteSource, Usage } from "./types.js";

const mockProvider = new MockProvider();
const breakers = new Map<string, CircuitBreaker>();

function breakerFor(provider: string): CircuitBreaker {
  let b = breakers.get(provider);
  if (!b) {
    b = new CircuitBreaker(provider);
    breakers.set(provider, b);
  }
  return b;
}

/** 一次候选尝试：来自哪个池、用什么 baseUrl/model/key 调用。 */
export interface Candidate {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  format: ApiFormat;
  source: "own" | "pool" | "mock";
  keyId: number | null;
}

export interface RouteContext {
  userId: number;
  aidMode: boolean;
  preferredProvider?: string | null;
}

export interface RouteMeta {
  provider: string;
  model: string;
  source: RouteSource;
  keyId: number | null;
}

export type RouteEvent =
  | { type: "meta"; meta: RouteMeta }
  | { type: "delta"; text: string }
  | { type: "done"; usage: RouteMeta & { promptTokens: number; completionTokens: number } | null };

/** 按协议构造候选链：自有 Key → 互助池 →（开发）mock。 */
export function buildCandidates(ctx: RouteContext): Candidate[] {
  const day = today();
  const out: Candidate[] = [];

  for (const k of listKeys(ctx.userId)) {
    if (k.status !== "private") continue;
    if (k.fail_count >= 10) continue;
    if (ctx.preferredProvider && k.provider !== ctx.preferredProvider) continue;
    out.push(toCandidate(k, "own"));
  }

  if (ctx.aidMode && getPoolUsage(ctx.userId, day, "pool") < config.poolDailyLimit) {
    const pool = listPoolKeys(ctx.preferredProvider ?? undefined).filter(
      (k) => k.owner_id !== ctx.userId && k.fail_count < 10,
    );
    for (const k of pool) out.push(toCandidate(k, "pool"));
  }

  if (config.mock) {
    out.push({
      provider: "mock",
      model: "lumina-mock",
      baseUrl: "",
      apiKey: "",
      format: "openai",
      source: "mock",
      keyId: null,
    });
  }

  return out;
}

function toCandidate(k: KeyRow, source: "own" | "pool"): Candidate {
  return {
    provider: k.provider,
    model: k.model,
    baseUrl: resolveBaseUrl(k.provider, k.base_url),
    apiKey: decryptSecret(k.ciphertext),
    format: isApiFormat(k.format) ? k.format : "openai",
    source,
    keyId: k.id,
  };
}

export interface RouteResult {
  text: string;
  meta: RouteMeta;
  usage: { promptTokens: number; completionTokens: number } | null;
}

/**
 * 非流式路由调用：沿候选链降级，返回第一个成功结果。
 * 成功后按来源记账（互助每日配额）。
 */
export async function routeAndCall(
  ctx: RouteContext,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<RouteResult> {
  const candidates = buildCandidates(ctx);
  if (candidates.length === 0) throw Errors.providerUnavailable();

  const failures: string[] = [];
  for (const c of candidates) {
    const breaker = breakerFor(c.provider);
    if (!breaker.allow()) {
      failures.push(`${c.provider}:熔断中`);
      continue;
    }
    try {
      let text: string;
      let usage: { promptTokens: number; completionTokens: number } | null = null;
      if (c.source === "mock") {
        const r = await mockProvider.call(messages);
        text = r.text;
        usage = r.usage;
      } else {
        const r = await callChat({
          baseUrl: c.baseUrl,
          apiKey: c.apiKey,
          model: c.model,
          format: c.format,
          messages,
          signal,
        });
        text = r.text;
        usage = r.usage;
      }
      breaker.onSuccess();
      accountSuccess(ctx, c);
      return {
        text,
        meta: { provider: c.provider, model: c.model, source: c.source, keyId: c.keyId },
        usage,
      };
    } catch (e) {
      breaker.onFailure();
      failures.push(`${c.provider}:${e instanceof BizError ? e.message : String(e)}`);
    }
  }
  throw Errors.providerUnavailable(`所有候选提供商均失败（${failures.join("；")}）`);
}

/**
 * 流式路由：先在链上找到第一个能产出增量流的提供商，发出 meta，
 * 之后原样转发 delta。调用方负责结束后的落库。
 */
export async function* routeAndStream(
  ctx: RouteContext,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<RouteEvent> {
  const candidates = buildCandidates(ctx);
  if (candidates.length === 0) throw Errors.providerUnavailable();

  const failures: string[] = [];
  for (const c of candidates) {
    const breaker = breakerFor(c.provider);
    if (!breaker.allow()) {
      failures.push(`${c.provider}:熔断中`);
      continue;
    }
    try {
      let stream: AsyncGenerator<string>;
      if (c.source === "mock") {
        stream = mockProvider.stream(messages);
      } else {
        stream = callChatStream({
          baseUrl: c.baseUrl,
          apiKey: c.apiKey,
          model: c.model,
          format: c.format,
          messages,
          signal,
        });
      }
      const first = await stream.next();
      if (first.done) {
        // 提供商立即返回空流：视为失败，降级
        breaker.onFailure();
        failures.push(`${c.provider}:空响应`);
        continue;
      }

      breaker.onSuccess();
      accountSuccess(ctx, c);
      const meta: RouteMeta = {
        provider: c.provider,
        model: c.model,
        source: c.source,
        keyId: c.keyId,
      };
      yield { type: "meta", meta };
      if (first.value) yield { type: "delta", text: first.value };
      for await (const delta of stream) {
        yield { type: "delta", text: delta };
      }
      return;
    } catch (e) {
      breaker.onFailure();
      failures.push(`${c.provider}:${e instanceof BizError ? e.message : String(e)}`);
    }
  }
  throw Errors.providerUnavailable(`所有候选提供商均失败（${failures.join("；")}）`);
}

/** 成功使用互助池后记账。 */
function accountSuccess(ctx: RouteContext, c: Candidate): void {
  if (c.source === "pool") {
    bumpPoolUsage(ctx.userId, today(), "pool");
    if (c.keyId !== null) markKeyUsed(c.keyId);
  }
}
