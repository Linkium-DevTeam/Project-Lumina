import { Hono } from "hono";
import { db } from "../db.js";
import type { Emotion } from "../types.js";
import type { Env } from "../env.js";
import { requireAuth } from "./auth.js";

export const moodRoutes = new Hono<Env>();

moodRoutes.use("*", requireAuth());

/** 最近 N 条助手消息的情绪轨迹——光球"心情条纹"的数据源。 */
moodRoutes.get("/", (c) => {
  const userId = c.get("userId");
  const limit = Math.min(60, Math.max(1, Number(c.req.query("limit") ?? 24)));
  const rows = db
    .prepare(
      "SELECT emotion, intensity, created_at FROM chat_logs " +
        "WHERE user_id = ? AND role = 'assistant' AND emotion IS NOT NULL " +
        "ORDER BY id DESC LIMIT ?",
    )
    .all(userId, limit) as Array<{ emotion: string; intensity: number; created_at: string }>;

  return c.json({
    success: true,
    code: "OK",
    message: null,
    data: {
      moods: rows
        .filter((r) => r.emotion)
        .map((r) => ({
          emotion: r.emotion as Emotion,
          intensity: r.intensity ?? 0.5,
          at: r.created_at,
        }))
        .reverse(),
    },
  });
});

/** 对话存档（文本），供客户端会话恢复；内容明文仅限本人读取。 */
moodRoutes.get("/logs", (c) => {
  const userId = c.get("userId");
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const rows = db
    .prepare(
      "SELECT role, content, care, created_at FROM chat_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(userId, limit) as Array<{
    role: "user" | "assistant";
    content: string;
    care: string | null;
    created_at: string;
  }>;
  return c.json({
    success: true,
    code: "OK",
    message: null,
    data: {
      logs: rows.reverse().map((r) => ({
        role: r.role,
        content: r.content,
        care: r.care ? safeParseCare(r.care) : null,
      })),
    },
  });
});

function safeParseCare(raw: string): { level: "gentle" | "urgent"; minor?: boolean } | null {
  try {
    const obj = JSON.parse(raw) as { level?: unknown; minor?: unknown };
    if (obj.level !== "gentle" && obj.level !== "urgent") return null;
    return { level: obj.level, ...(obj.minor === true ? { minor: true } : {}) };
  } catch {
    return null;
  }
}
