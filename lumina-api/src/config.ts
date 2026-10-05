import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

/** 尽早加载 .env（不引入 dotenv 依赖：手写 20 行足够）。 */
function loadDotEnv(): void {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const key = m[1]!;
    if (!(key in process.env)) {
      process.env[key] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
}
loadDotEnv();

export interface ProviderDefault {
  baseUrl: string;
  defaultModel: string;
  label: string;
  /** 支持语音合成的提供商填写（OpenAI 兼容 /audio/speech） */
  ttsModel?: string;
}

const BUILTIN_PROVIDERS: Record<string, ProviderDefault> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    label: "DeepSeek",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    label: "OpenAI",
    ttsModel: "gpt-4o-mini-tts",
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    label: "通义千问",
  },
  zhipu: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    label: "智谱",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    label: "Gemini",
  },
  orcarouter: {
    baseUrl: "https://api.orcarouter.ai/v1",
    defaultModel: "openai/gpt-4o-mini",
    label: "OrcaRouter",
    ttsModel: "openai/gpt-4o-mini-tts",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-chat",
    label: "OpenRouter",
  },
  siliconflow: {
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    label: "硅基流动",
    ttsModel: "FunAudioLLM/CosyVoice2-0.5B",
  },
  modelscope: {
    baseUrl: "https://api-inference.modelscope.cn/v1",
    defaultModel: "Qwen/Qwen3-32B",
    label: "魔搭免费推理",
  },
};

function loadProviderOverrides(): Record<string, Partial<ProviderDefault>> {
  const raw = process.env.LUMINA_PROVIDERS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ProviderDefault>>;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    console.warn("[lumina] LUMINA_PROVIDERS 不是合法 JSON，忽略");
    return {};
  }
}

const overrides = loadProviderOverrides();

export const providers: Record<string, ProviderDefault> = Object.fromEntries(
  Object.entries({ ...BUILTIN_PROVIDERS, ...overrides }).map(([id, base]) => [
    id,
    { ...BUILTIN_PROVIDERS[id], ...base } as ProviderDefault,
  ]),
);

export function providerDefault(id: string): ProviderDefault | undefined {
  return providers[id];
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  masterKey: process.env.LUMINA_MASTER_KEY ?? "",
  dbPath: process.env.LUMINA_DB_PATH ?? "./data/lumina.db",
  mock: /^(1|true|yes)$/i.test(process.env.LUMINA_MOCK ?? ""),
  corsOrigin: process.env.LUMINA_CORS_ORIGIN || undefined,
  poolDailyLimit: Number(process.env.LUMINA_POOL_DAILY_LIMIT ?? 60),
  /** 自托管者用 ollama/LM Studio 等本地模型时打开（默认严格禁止内网/环回上游） */
  allowPrivateUpstream: /^(1|true|yes)$/i.test(process.env.LUMINA_ALLOW_PRIVATE_UPSTREAM ?? ""),
};

export function ensureDataDir(): void {
  const dir = dirname(resolve(config.dbPath));
  mkdirSync(dir, { recursive: true });
}

/** 启动自检：主密钥缺失时给出可操作的错误信息。 */
export function assertMasterKey(): void {
  if (config.masterKey && config.masterKey.length >= 32) return;
  console.error(
    "[lumina] LUMINA_MASTER_KEY 缺失或不足 32 字节。\n" +
      "  请复制 .env.example 为 .env 并设置：openssl rand -base64 32",
  );
  process.exit(1);
}
