/** 与 lumina-api/src/types.ts 保持镜像。 */

export type Emotion =
  | "calm"
  | "joy"
  | "love"
  | "sad"
  | "anxious"
  | "angry"
  | "lonely"
  | "hopeful"
  | "tired";

export interface Mood {
  emotion: Emotion;
  intensity: number;
}

/** 救助卡片：模型检出危机信号时随回复附带。 */
export interface CareInfo {
  level: "gentle" | "urgent";
  minor?: boolean;
}

export interface UserDto {
  id: number;
  nickname: string;
  createdAt: string;
}

export interface KeyDto {
  id: number;
  provider: string;
  model: string;
  status: "private" | "pool";
  format: string;
  label: string;
  createdAt: string;
  donatedAt: string | null;
}

export interface ProviderDto {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
}

export interface PoolStatusDto {
  poolKeys: number;
  aidMode: boolean;
  poolDailyLimit: number;
  usedToday: number;
}

export interface ChatResultDto {
  text: string;
  mood: Mood;
  provider: string;
  model: string;
  source: "own" | "pool" | "mock";
  usage: { promptTokens: number; completionTokens: number } | null;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  care?: CareInfo | null;
}

// ── 存储 ──

const KEY_TOKEN = "lumina.token";
const KEY_DEVICE = "lumina.device";
const KEY_NICK = "lumina.nickname";
const KEY_SERVER = "lumina.server";
const KEY_AUTO_READ = "lumina.autoRead";
const KEY_VOICE_MODE = "lumina.voiceMode";
const KEY_VOICE_URI = "lumina.voiceURI";

export const store = {
  get token() {
    return localStorage.getItem(KEY_TOKEN) ?? "";
  },
  set token(v: string) {
    v ? localStorage.setItem(KEY_TOKEN, v) : localStorage.removeItem(KEY_TOKEN);
  },
  get deviceId() {
    let id = localStorage.getItem(KEY_DEVICE);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY_DEVICE, id);
    }
    return id;
  },
  get nickname() {
    return localStorage.getItem(KEY_NICK) ?? "";
  },
  set nickname(v: string) {
    localStorage.setItem(KEY_NICK, v);
  },
  get server() {
    return localStorage.getItem(KEY_SERVER) ?? "";
  },
  set server(v: string) {
    v ? localStorage.setItem(KEY_SERVER, v) : localStorage.removeItem(KEY_SERVER);
  },
  get autoRead() {
    return localStorage.getItem(KEY_AUTO_READ) === "1";
  },
  set autoRead(v: boolean) {
    localStorage.setItem(KEY_AUTO_READ, v ? "1" : "0");
  },
  get voiceMode(): "browser" | "server" {
    return localStorage.getItem(KEY_VOICE_MODE) === "server" ? "server" : "browser";
  },
  set voiceMode(v: "browser" | "server") {
    localStorage.setItem(KEY_VOICE_MODE, v);
  },
  get voiceURI() {
    return localStorage.getItem(KEY_VOICE_URI) ?? "";
  },
  set voiceURI(v: string) {
    v ? localStorage.setItem(KEY_VOICE_URI, v) : localStorage.removeItem(KEY_VOICE_URI);
  },
  clear() {
    localStorage.removeItem(KEY_TOKEN);
    localStorage.removeItem(KEY_NICK);
  },
};

export function baseUrl(): string {
  return store.server.replace(/\/+$/, "");
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(baseUrl() + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(store.token ? { authorization: `Bearer ${store.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | { success: boolean; code: string; message: string | null; data: T }
    | null;
  if (!data) throw new ApiError("NETWORK", "连不上服务器，请检查网络或服务器地址", res.status);
  if (!data.success) throw new ApiError(data.code, data.message ?? "请求失败", res.status);
  return data.data;
}

// ── 接口 ──

export const api = {
  async register(nickname: string): Promise<{ user: UserDto; token: string }> {
    const d = await call<{ user: UserDto; token: string }>("POST", "/api/v1/auth/register", {
      deviceId: store.deviceId,
      nickname,
    });
    store.token = d.token;
    store.nickname = d.user.nickname;
    return d;
  },

  async me(): Promise<{ user: UserDto; aidMode: boolean }> {
    return call("GET", "/api/v1/me");
  },

  async setAidMode(enabled: boolean): Promise<void> {
    await call("POST", "/api/v1/auth/aid-mode", { enabled });
  },

  listKeys: () => call<{ keys: KeyDto[] }>("GET", "/api/v1/keys"),
  providers: () => call<{ providers: ProviderDto[] }>("GET", "/api/v1/keys/providers"),

  addKey: (input: {
    provider: string;
    model?: string;
    baseUrl?: string;
    format?: "openai" | "anthropic" | "gemini";
    apiKey: string;
    label?: string;
  }) => call<KeyDto>("POST", "/api/v1/keys", input),

  deleteKey: (id: number) => call<null>("DELETE", `/api/v1/keys/${id}`),
  donateKey: (id: number) => call<KeyDto>("POST", `/api/v1/keys/${id}/donate`),
  withdrawKey: (id: number) => call<KeyDto>("POST", `/api/v1/keys/${id}/withdraw`),

  poolStatus: () => call<PoolStatusDto>("GET", "/api/v1/pool"),

  moods: () =>
    call<{ moods: Array<Mood & { at: string }> }>("GET", "/api/v1/moods?limit=24"),

  logs: () => call<{ logs: ChatTurn[] }>("GET", "/api/v1/moods/logs?limit=50"),

  /** 服务端语音合成（需支持 TTS 的自有 Key，如硅基流动），返回音频 Blob。 */
  tts: async (text: string, opts?: { voice?: string; model?: string }): Promise<Blob> => {
    const res = await fetch(baseUrl() + "/api/v1/tts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(store.token ? { authorization: `Bearer ${store.token}` } : {}),
      },
      body: JSON.stringify({ text, ...opts }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new ApiError("TTS_ERROR", data?.message ?? `语音合成失败（${res.status}）`, res.status);
    }
    return res.blob();
  },
};

// ── 流式对话（SSE over fetch）──

export interface StreamHandlers {
  onMeta?: (meta: { provider: string; model: string; source: ChatResultDto["source"] }) => void;
  onDelta: (chunk: string) => void;
  onMood?: (mood: Mood) => void;
  onCare?: (care: CareInfo) => void;
  onDone?: (info: {
    text: string;
    provider: string | null;
    source: ChatResultDto["source"] | null;
    care: CareInfo | null;
  }) => void;
  onError?: (err: ApiError) => void;
}

export async function chatStream(
  message: string,
  history: ChatTurn[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(baseUrl() + "/api/v1/chat/stream", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(store.token ? { authorization: `Bearer ${store.token}` } : {}),
      },
      body: JSON.stringify({ message, history }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    handlers.onError?.(new ApiError("NETWORK", "连不上服务器", 0));
    return;
  }

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as
      | { code?: string; message?: string }
      | null;
    handlers.onError?.(
      new ApiError(data?.code ?? "HTTP_ERROR", data?.message ?? `请求失败（${res.status}）`, res.status),
    );
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const handle = (event: string, raw: string) => {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    switch (event) {
      case "meta":
        handlers.onMeta?.(payload as never);
        break;
      case "delta":
        handlers.onDelta((payload as { text: string }).text ?? "");
        break;
      case "mood":
        handlers.onMood?.(payload as Mood);
        break;
      case "care":
        handlers.onCare?.(payload as CareInfo);
        break;
      case "done": {
        const p = payload as {
          text: string;
          provider: string | null;
          source: ChatResultDto["source"] | null;
          care: CareInfo | null;
        };
        handlers.onDone?.(p);
        break;
      }
      case "error": {
        const p = payload as { code: string; message: string };
        handlers.onError?.(new ApiError(p.code, p.message, 500));
        break;
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (event && data) handle(event, data);
    }
  }
}
