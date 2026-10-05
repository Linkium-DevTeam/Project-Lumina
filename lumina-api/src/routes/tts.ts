import { Hono } from "hono";
import { providerDefault } from "../config.js";
import { decryptSecret } from "../crypto.js";
import { listKeys, markKeyUsed } from "../db.js";
import { Errors } from "../errors.js";
import { RateLimiter } from "../ratelimit.js";
import { resolveBaseUrl } from "../provider.js";
import type { Env } from "../env.js";
import { requireAuth } from "./auth.js";

export const ttsRoutes = new Hono<Env>();

const limiter = new RateLimiter(10, 5); // 语音合成成本高：每分钟 10 次，突发 5

interface TtsBody {
  text: string;
  voice?: string;
  model?: string;
  provider?: string;
}

/**
 * 语音合成：仅使用用户自有 Key（互助池捐赠的 Key 只供文本，
 * 不被语音播放消耗），沿 OpenAI 兼容 /audio/speech 逐候选降级，
 * 命中后把音频流原样透传给客户端。
 */
ttsRoutes.post("/", requireAuth(), async (c) => {
  const user = c.get("user");
  limiter.take(`tts:${user.id}`);

  const body = (await c.req.json().catch(() => ({}))) as Partial<TtsBody>;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw Errors.badRequest("text 必填");
  if (text.length > 1000) throw Errors.badRequest("text 最长 1000 字符");
  if (body.voice !== undefined && (typeof body.voice !== "string" || body.voice.length > 64)) {
    throw Errors.badRequest("voice 非法");
  }
  if (body.model !== undefined && (typeof body.model !== "string" || body.model.length > 96)) {
    throw Errors.badRequest("model 非法");
  }
  if (body.provider !== undefined && (typeof body.provider !== "string" || body.provider.length > 32)) {
    throw Errors.badRequest("provider 非法");
  }

  const candidates = listKeys(user.id)
    .filter((k) => k.status === "private" && k.fail_count < 10)
    .filter((k) => !body.provider || k.provider === body.provider)
    .map((k) => {
      const def = providerDefault(k.provider);
      // 内置提供商：用配置的默认 TTS 模型（如硅基流动 CosyVoice2）；
      // custom Key 没有默认语音模型，必须由请求显式传 model。
      const ttsModel = body.model ?? def?.ttsModel;
      if (!ttsModel) return null;
      return {
        keyId: k.id,
        baseUrl: resolveBaseUrl(k.provider, k.base_url),
        apiKey: decryptSecret(k.ciphertext),
        model: ttsModel,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (candidates.length === 0) {
    throw Errors.badRequest("没有支持语音合成的 Key：建议添加一把硅基流动 Key（内置 CosyVoice2），或 custom Key 时传入 model");
  }

  const failures: string[] = [];
  for (const cand of candidates) {
    try {
      const res = await fetch(`${cand.baseUrl.replace(/\/+$/, "")}/audio/speech`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cand.apiKey}`,
        },
        body: JSON.stringify({
          model: cand.model,
          input: text,
          ...(body.voice ? { voice: body.voice } : {}),
          response_format: "mp3",
        }),
        signal: c.req.raw.signal,
      });
      if (!res.ok || !res.body) {
        failures.push(await res.text().catch(() => `HTTP ${res.status}`));
        continue;
      }
      markKeyUsed(cand.keyId);
      return new Response(res.body, {
        status: 200,
        headers: {
          "content-type": res.headers.get("content-type") ?? "audio/mpeg",
          "cache-control": "no-store",
        },
      });
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw Errors.providerUnavailable(`语音合成失败（${failures.join("；").slice(0, 300)}）`);
});
