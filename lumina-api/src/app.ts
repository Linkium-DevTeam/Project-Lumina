import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config.js";
import { BizError } from "./errors.js";
import { RateLimiter } from "./ratelimit.js";
import { authRoutes, requireAuth } from "./routes/auth.js";
import { keyRoutes } from "./routes/keys.js";
import { poolRoutes } from "./routes/pool.js";
import { chatRoutes } from "./routes/chat.js";
import { moodRoutes } from "./routes/moods.js";
import { ttsRoutes } from "./routes/tts.js";
import type { Env } from "./env.js";

/** 组装 Hono 应用（与监听端口解耦，便于测试与复用）。 */
export function buildApp(): Hono<Env> {
  const app = new Hono<Env>();

  if (config.corsOrigin) {
    app.use("/api/*", cors({ origin: config.corsOrigin }));
  }

  // 全局限流：粗粒度防滥用（细粒度在 chat 路由内）
  const globalLimiter = new RateLimiter(240, 120);
  app.use("/api/*", async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    globalLimiter.take(`ip:${ip}`);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof BizError) {
      return c.json(
        { success: false, code: err.code, message: err.message, data: null },
        err.status as 400,
      );
    }
    console.error("[lumina] unhandled:", err);
    return c.json(
      { success: false, code: "INTERNAL", message: "服务开小差了，稍后再试", data: null },
      500,
    );
  });

  app.get("/api/healthz", (c) => c.json({ status: "ok", service: "lumina", version: "2.0.0" }));

  app.route("/api/v1/auth", authRoutes);
  app.route("/api/v1/keys", keyRoutes);
  app.route("/api/v1/pool", poolRoutes);
  app.route("/api/v1/chat", chatRoutes);
  app.route("/api/v1/moods", moodRoutes);
  app.route("/api/v1/tts", ttsRoutes);

  // 聚合入口：身份 + 互助模式
  app.get("/api/v1/me", requireAuth(), (c) => {
    const user = c.get("user");
    return c.json({
      success: true,
      code: "OK",
      message: null,
      data: {
        user: { id: user.id, nickname: user.nickname, createdAt: user.created_at },
        aidMode: user.aid_mode === 1,
      },
    });
  });

  return app;
}
