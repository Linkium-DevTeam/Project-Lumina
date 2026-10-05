import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { addLog, db, type ChatLogRow } from "../db.js";
import { Errors } from "../errors.js";
import { RateLimiter } from "../ratelimit.js";
import { buildSystemPrompt } from "../persona.js";
import { parseReply, visibleSoFar } from "../emotion.js";
import { routeAndCall, routeAndStream, type RouteMeta } from "../router.js";
import type { ChatMessage } from "../provider.js";
import { isEmotion } from "../types.js";
import type { Env } from "../env.js";
import { requireAuth } from "./auth.js";

export const chatRoutes = new Hono<Env>();

const limiter = new RateLimiter(20, 8); // 每分钟 20 条，突发 8

const MAX_MESSAGE = 4000;
const MAX_HISTORY = 16;

interface ChatBody {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  provider?: string;
}

interface RawChatBody {
  message?: unknown;
  history?: unknown;
  provider?: unknown;
}

function parseBody(raw: unknown): ChatBody {
  const b = (raw ?? {}) as RawChatBody;
  if (typeof b.message !== "string" || !b.message.trim()) {
    throw Errors.badRequest("message 必填");
  }
  if (b.message.length > MAX_MESSAGE) {
    throw Errors.badRequest(`message 最长 ${MAX_MESSAGE} 字符`);
  }
  let provider: string | undefined;
  if (b.provider !== undefined) {
    if (typeof b.provider !== "string" || b.provider.length > 32) {
      throw Errors.badRequest("provider 非法");
    }
    provider = b.provider;
  }
  const rawHistory = Array.isArray(b.history) ? b.history.slice(-MAX_HISTORY) : [];
  const history: ChatBody["history"] = [];
  for (const h of rawHistory) {
    const item = h as { role?: unknown; content?: unknown };
    if (
      !item ||
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string" ||
      item.content.length > MAX_MESSAGE
    ) {
      throw Errors.badRequest("history 格式非法");
    }
    history.push({ role: item.role, content: item.content });
  }
  return { message: (b.message as string).trim(), history, provider };
}

function buildMessages(userId: number, nickname: string, body: ChatBody): ChatMessage[] {
  const recentMoods = (
    db
      .prepare(
        "SELECT emotion FROM chat_logs WHERE user_id = ? AND role = 'assistant' AND emotion IS NOT NULL ORDER BY id DESC LIMIT 3",
      )
      .all(userId) as Array<{ emotion: string }>
  )
    .map((r) => r.emotion)
    .filter(isEmotion);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(nickname, recentMoods, {
        turnCount: Math.floor(body.history.length / 2) + 1,
        hour: new Date().getHours(),
      }),
    },
    ...body.history.map((h) => ({ role: h.role, content: h.content }) as ChatMessage),
    { role: "user", content: body.message },
  ];
  return messages;
}

function routeContext(c: import("hono").Context<Env>, body: ChatBody) {
  const user = c.get("user");
  return {
    userId: user.id,
    aidMode: user.aid_mode === 1,
    preferredProvider: body.provider ?? null,
  };
}

chatRoutes.use("*", requireAuth());

/** 非流式对话（兼容旧协议 / 简单集成）。 */
chatRoutes.post("/", async (c) => {
  const user = c.get("user");
  limiter.take(`chat:${user.id}`);
  const body = parseBody(await c.req.json().catch(() => null));
  const messages = buildMessages(user.id, user.nickname, body);

  const result = await routeAndCall(routeContext(c, body), messages, c.req.raw.signal);
  const { text, mood, care } = parseReply(result.text);

  addLog(user.id, "user", body.message);
  addLog(user.id, "assistant", text, {
    provider: result.meta.provider,
    source: result.meta.source,
    emotion: mood.emotion,
    intensity: mood.intensity,
    care: care ? JSON.stringify(care) : null,
  });

  return c.json({
    success: true,
    code: "OK",
    message: null,
    data: {
      text,
      mood,
      care,
      provider: result.meta.provider,
      model: result.meta.model,
      source: result.meta.source,
      usage: result.usage,
    },
  });
});

/** 流式对话：SSE。事件序列 meta → delta* → mood → done。 */
chatRoutes.post("/stream", async (c) => {
  const user = c.get("user");
  limiter.take(`chat:${user.id}`);
  const body = parseBody(await c.req.json().catch(() => null));
  const messages = buildMessages(user.id, user.nickname, body);
  const ctx = routeContext(c, body);

  addLog(user.id, "user", body.message);

  return streamSSE(c, async (sse) => {
    let meta: RouteMeta | null = null;
    let full = "";
    let sent = "";
    let closed = false;
    c.req.raw.signal.addEventListener("abort", () => {
      closed = true;
    });
    try {
      for await (const ev of routeAndStream(ctx, messages, c.req.raw.signal)) {
        if (closed) break;
        if (ev.type === "meta") {
          meta = ev.meta;
          await sse.writeSSE({ event: "meta", data: JSON.stringify(ev.meta) });
        } else if (ev.type === "delta") {
          full += ev.text;
          const vis = visibleSoFar(full);
          if (vis.length > sent.length) {
            const chunk = vis.slice(sent.length);
            sent = vis;
            await sse.writeSSE({ event: "delta", data: JSON.stringify({ text: chunk }) });
          }
        }
      }
      const { text, mood, care } = parseReply(full);
      await sse.writeSSE({ event: "mood", data: JSON.stringify(mood) });
      if (care) {
        await sse.writeSSE({ event: "care", data: JSON.stringify(care) });
      }

      const log: ChatLogRow = addLog(user.id, "assistant", text, {
        provider: meta?.provider,
        source: meta?.source,
        emotion: mood.emotion,
        intensity: mood.intensity,
        care: care ? JSON.stringify(care) : null,
      });
      await sse.writeSSE({
        event: "done",
        data: JSON.stringify({
          provider: meta?.provider ?? null,
          model: meta?.model ?? null,
          source: meta?.source ?? null,
          messageId: log.id,
          text,
          care,
        }),
      });
    } catch (e) {
      const be = e as { code?: string; message?: string };
      await sse.writeSSE({
        event: "error",
        data: JSON.stringify({
          code: be.code ?? "INTERNAL",
          message: be.message ?? "服务异常",
        }),
      });
    }
  });
});
