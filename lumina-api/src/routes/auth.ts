import { Hono } from "hono";
import { createUser, getUser, getUserByDevice, setAidMode } from "../db.js";
import { issueToken, newDeviceId, verifyToken } from "../crypto.js";
import { Errors } from "../errors.js";
import type { UserDto } from "../types.js";
import type { Env } from "../env.js";

export const authRoutes = new Hono<Env>();

function toDto(u: { id: number; nickname: string; created_at: string }): UserDto {
  return { id: u.id, nickname: u.nickname, createdAt: u.created_at };
}

/**
 * 设备注册（幂等）：同一 deviceId 重复注册返回既有身份。
 * 匿名优先——深夜需要陪伴的人，不该先被一堵注册墙拦住。
 */
authRoutes.post("/register", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const deviceId = typeof body.deviceId === "string" && body.deviceId ? body.deviceId : newDeviceId();
  const nickname =
    typeof body.nickname === "string" && body.nickname.trim()
      ? body.nickname.trim().slice(0, 24)
      : "旅人";

  if (deviceId.length > 128) throw Errors.badRequest("deviceId 过长");

  let user = getUserByDevice(deviceId);
  if (!user) {
    user = createUser(deviceId, nickname);
  }
  // deviceId 即持有凭证：重复注册重发 token，避免客户端丢 token 后身份永久丢失。
  const token = issueToken(user.id);
  return c.json({
    success: true,
    code: "OK",
    message: null,
    data: { userId: user.id, token, user: toDto(user), deviceId },
  });
});

/** token 换身份（客户端启动时校验本地存储的 token）。 */
authRoutes.get("/whoami", requireAuth(), (c) => {
  const userId = c.get("userId");
  const user = getUser(userId);
  if (!user) throw Errors.unauthorized();
  return c.json({
    success: true,
    code: "OK",
    message: null,
    data: { user: toDto(user), aidMode: user.aid_mode === 1 },
  });
});

authRoutes.post("/aid-mode", requireAuth(), async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") throw Errors.badRequest("enabled 必须为布尔值");
  setAidMode(userId, body.enabled);
  return c.json({ success: true, code: "OK", message: null, data: { enabled: body.enabled } });
});

/** token 挂载中间件（供其他模块复用）。 */
export function requireAuth(): (c: import("hono").Context<Env>, next: () => Promise<void>) => Promise<void> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const userId = token ? verifyToken(token) : null;
    if (userId === null) throw Errors.unauthorized();
    const user = getUser(userId);
    if (!user) throw Errors.unauthorized();
    c.set("userId", userId);
    c.set("user", user);
    await next();
  };
}
