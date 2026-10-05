import { Hono } from "hono";
import {
  addLog,
  db,
  deleteKey,
  getKey,
  listKeys,
  setKeyStatus,
} from "../db.js";
import { encryptSecret } from "../crypto.js";
import { Errors } from "../errors.js";
import { providerDefault, providers } from "../config.js";
import { isApiFormat, validateUpstreamUrl } from "../provider.js";
import type { KeyDto } from "../types.js";
import type { Env } from "../env.js";
import { requireAuth } from "./auth.js";

export const keyRoutes = new Hono<Env>();

export function toKeyDto(k: {
  id: number;
  provider: string;
  model: string;
  status: string;
  format: string;
  label: string;
  created_at: string;
  donated_at: string | null;
}): KeyDto {
  return {
    id: k.id,
    provider: k.provider,
    model: k.model,
    status: k.status as KeyDto["status"],
    format: k.format,
    label: k.label,
    createdAt: k.created_at,
    donatedAt: k.donated_at,
  };
}

const ALLOWED_PROVIDER = /^[a-z0-9_-]{1,32}$/;
const SAFE_LABEL = /^[\p{L}\p{N}\s_·.\-]{0,40}$/u;

keyRoutes.use("*", requireAuth());

keyRoutes.get("/", (c) => {
  const userId = c.get("userId");
  return c.json({
    success: true,
    code: "OK",
    message: null,
    data: { keys: listKeys(userId).map(toKeyDto) },
  });
});

keyRoutes.get("/providers", (c) => {
  return c.json({
    success: true,
    code: "OK",
    message: null,
    data: {
      providers: Object.entries(providers).map(([id, p]) => ({
        id,
        label: p.label,
        baseUrl: p.baseUrl,
        defaultModel: p.defaultModel,
      })),
    },
  });
});

keyRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));

  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!ALLOWED_PROVIDER.test(provider)) throw Errors.badRequest("provider 非法");
  if (provider !== "custom" && !providerDefault(provider)) {
    throw Errors.badRequest(`未知提供商：${provider}`);
  }

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim().slice(0, 64)
      : provider === "custom"
        ? ""
        : (providerDefault(provider)?.defaultModel ?? "");
  if (!model) throw Errors.badRequest("custom 提供商必须指定 model");

  const baseUrl =
    provider === "custom"
      ? typeof body.baseUrl === "string" && body.baseUrl.trim()
        ? body.baseUrl.trim()
        : ""
      : typeof body.baseUrl === "string" && body.baseUrl.trim()
        ? body.baseUrl.trim()
        : null;
  if (provider === "custom" && !baseUrl) throw Errors.badRequest("custom 提供商必须指定 baseUrl");
  if (baseUrl) validateUpstreamUrl(baseUrl);

  // 自定义 Key 可选 API 格式：openai（默认）/ anthropic / gemini 原生
  const format = body.format === undefined || body.format === null
    ? "openai"
    : body.format;
  if (!isApiFormat(format)) throw Errors.badRequest("format 仅支持 openai / anthropic / gemini");

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (apiKey.length < 8 || apiKey.length > 512) throw Errors.badRequest("apiKey 长度非法");

  const label = typeof body.label === "string" && SAFE_LABEL.test(body.label) ? body.label : "";

  const created = addKey({
    userId,
    provider,
    model,
    baseUrl,
    format: provider === "custom" ? format : "openai",
    label,
    ciphertext: encryptSecret(apiKey),
  });
  return c.json({ success: true, code: "OK", message: null, data: toKeyDto(created) });
});

keyRoutes.delete("/:id", (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const key = getKey(id);
  if (!key || key.owner_id !== userId) throw Errors.notFound("Key 不存在");
  if (key.status === "pool") throw Errors.conflict("该 Key 正在互助池中，请先撤回");
  deleteKey(id);
  return c.json({ success: true, code: "OK", message: null, data: null });
});

keyRoutes.post("/:id/donate", (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const key = getKey(id);
  if (!key || key.owner_id !== userId) throw Errors.notFound("Key 不存在");
  if (key.status === "pool") throw Errors.conflict("该 Key 已在互助池中");
  setKeyStatus(id, "pool");
  addLog(userId, "assistant", "（你把一把钥匙放进了互助池，谢谢你为陌生人点灯。）", {
    source: "pool",
  });
  return c.json({ success: true, code: "OK", message: null, data: toKeyDto(getKey(id)!) });
});

keyRoutes.post("/:id/withdraw", (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const key = getKey(id);
  if (!key || key.owner_id !== userId) throw Errors.notFound("Key 不存在");
  if (key.status !== "pool") throw Errors.conflict("该 Key 不在互助池中");
  setKeyStatus(id, "private");
  return c.json({ success: true, code: "OK", message: null, data: toKeyDto(getKey(id)!) });
});

function addKey(k: {
  userId: number;
  provider: string;
  model: string;
  baseUrl: string | null;
  format: string;
  label: string;
  ciphertext: string;
}) {
  const r = insertKey.run(
    k.userId,
    k.provider,
    k.model,
    k.baseUrl,
    k.format,
    k.label,
    k.ciphertext,
  );
  return getKey(Number(r.lastInsertRowid))!;
}

const insertKey = db.prepare(
  "INSERT INTO api_keys (owner_id, provider, model, base_url, format, label, ciphertext) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
