import { Hono } from "hono";
import { config } from "../config.js";
import { countPoolKeys, getPoolUsage, today } from "../db.js";
import type { PoolStatusDto } from "../types.js";
import type { Env } from "../env.js";
import { requireAuth } from "./auth.js";

export const poolRoutes = new Hono<Env>();

poolRoutes.use("*", requireAuth());

poolRoutes.get("/", (c) => {
  const userId = c.get("userId");
  const user = c.get("user");
  const day = today();
  const status: PoolStatusDto = {
    poolKeys: countPoolKeys(),
    aidMode: user.aid_mode === 1,
    poolDailyLimit: config.poolDailyLimit,
    usedToday: getPoolUsage(userId, day, "pool"),
  };
  return c.json({ success: true, code: "OK", message: null, data: status });
});
