import { beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { Env } from "../src/env.js";

let app: Hono<Env>;
let token = "";
const deviceId = `test-device-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function api(
  method: string,
  path: string,
  body?: unknown,
  withAuth = true,
): Promise<Response> {
  return app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(withAuth && token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface Envelope<T> {
  success: boolean;
  code: string;
  message: string | null;
  data: T;
}

beforeAll(async () => {
  // config 在首次 import 时读取 vitest 注入的环境变量
  const { buildApp } = await import("../src/app.js");
  app = buildApp();
});

describe("lumina api", () => {
  it("healthz", async () => {
    const res = await api("GET", "/api/healthz", undefined, false);
    expect(res.status).toBe(200);
  });

  it("注册 → token", async () => {
    const res = await api(
      "POST",
      "/api/v1/auth/register",
      { deviceId, nickname: "测试旅人" },
      false,
    );
    const data = await json<Envelope<{ userId: number; token: string }>>(res);
    expect(data.success).toBe(true);
    expect(data.data.token).toBeTruthy();
    token = data.data.token;
  });

  it("重复注册幂等：返回既有身份并重发 token", async () => {
    const res = await api("POST", "/api/v1/auth/register", { deviceId }, false);
    const data = await json<Envelope<{ token: string | null; userId: number }>>(res);
    expect(data.success).toBe(true);
    expect(data.data.token).toBeTruthy();
  });

  it("无 token 访问被拒", async () => {
    const res = await api("GET", "/api/v1/keys", undefined, false);
    expect(res.status).toBe(401);
  });

  it("添加自有 Key（加密落库，不回传明文）", async () => {
    const res = await api("POST", "/api/v1/keys", {
      provider: "deepseek",
      apiKey: `sk-test-${crypto.randomUUID()}`,
      label: "我的第一个",
    });
    const data = await json<Envelope<{ id: number; status: string }>>(res);
    expect(data.success).toBe(true);
    expect(data.data.status).toBe("private");
  });

  it("自定义 Key 支持 anthropic 格式", async () => {
    const res = await api("POST", "/api/v1/keys", {
      provider: "custom",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
      format: "anthropic",
      apiKey: `sk-ant-${crypto.randomUUID()}`,
    });
    const data = await json<Envelope<{ format: string; provider: string }>>(res);
    expect(data.success).toBe(true);
    expect(data.data.format).toBe("anthropic");
  });

  it("内网上游 baseUrl 被 SSRF 防护拒绝", async () => {
    const res = await api("POST", "/api/v1/keys", {
      provider: "custom",
      baseUrl: "http://169.254.169.254/latest",
      model: "m",
      apiKey: `sk-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(400);
  });

  it("非法 format 被拒绝", async () => {
    const res = await api("POST", "/api/v1/keys", {
      provider: "custom",
      baseUrl: "https://api.example.com/v1",
      model: "m",
      format: "grpc",
      apiKey: `sk-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(400);
  });

  it("捐赠 Key 进互助池并查看池状态", async () => {
    const list = await json<Envelope<{ keys: Array<{ id: number }> }>>(
      await api("GET", "/api/v1/keys"),
    );
    const keyId = list.data.keys[0]!.id;

    const donated = await json<Envelope<{ status: string }>>(
      await api("POST", `/api/v1/keys/${keyId}/donate`),
    );
    expect(donated.data.status).toBe("pool");

    const pool = await json<Envelope<{ poolKeys: number; aidMode: boolean; usedToday: number }>>(
      await api("GET", "/api/v1/pool"),
    );
    expect(pool.data.poolKeys).toBeGreaterThanOrEqual(1);
    expect(pool.data.aidMode).toBe(false);
  });

  it("撤回捐赠", async () => {
    const list = await json<Envelope<{ keys: Array<{ id: number; status: string }> }>>(
      await api("GET", "/api/v1/keys"),
    );
    const keyId = list.data.keys[0]!.id;
    const w = await json<Envelope<{ status: string }>>(
      await api("POST", `/api/v1/keys/${keyId}/withdraw`),
    );
    expect(w.data.status).toBe("private");
  });

  it("非流式对话（mock 提供商）带情绪标签剥离", async () => {
    const res = await api("POST", "/api/v1/chat", {
      message: "今天加班到很晚，一个人走回家的路上觉得好孤独，有点撑不住了",
      history: [],
    });
    const data = await json<
      Envelope<{ text: string; mood: { emotion: string }; source: string; provider: string }>
    >(res);
    expect(data.success).toBe(true);
    expect(data.data.text).not.toContain("[[mood]]");
    expect(data.data.text.length).toBeGreaterThan(4);
    expect(data.data.mood.emotion).toBeTruthy();
    expect(["mock", "own", "pool"]).toContain(data.data.source);
  });

  it("流式对话（SSE）：meta → delta → mood → done", async () => {
    const res = await api("POST", "/api/v1/chat/stream", {
      message: "有点焦虑，明天要做一个很重要的汇报",
    });
    expect(res.status).toBe(200);
    const text = await res.text();

    const events = text
      .split("\n\n")
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const evLine = block.split("\n").find((l) => l.startsWith("event:"));
        const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
        return {
          event: evLine?.slice(6).trim() ?? "",
          data: dataLine?.slice(5).trim() ?? "",
        };
      });

    const kinds = events.map((e) => e.event);
    expect(kinds[0]).toBe("meta");
    expect(kinds).toContain("mood");
    expect(kinds[kinds.length - 1]).toBe("done");
    expect(kinds.filter((k) => k === "delta").length).toBeGreaterThan(2);

    const done = JSON.parse(events.find((e) => e.event === "done")!.data) as {
      text: string;
      care: { level: string } | null;
    };
    expect(done.text).not.toContain("[[mood]]");
    expect(done.care).toBeNull();

    const mood = JSON.parse(events.find((e) => e.event === "mood")!.data) as {
      emotion: string;
    };
    expect(mood.emotion).toBe("anxious");
  });

  it("危机信号：流式回复携带 care 救助卡事件", async () => {
    const res = await api("POST", "/api/v1/chat/stream", {
      message: "我真的不想活了，觉得撑不下去了",
    });
    const text = await res.text();
    const events = text
      .split("\n\n")
      .map((b) => b.trim())
      .filter(Boolean)
      .map((b) => ({
        event: b.split("\n").find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "",
        data: b.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim() ?? "",
      }));

    const careEv = events.find((e) => e.event === "care");
    expect(careEv).toBeTruthy();
    const care = JSON.parse(careEv!.data) as { level: string; text?: string };
    expect(care.level).toBe("urgent");

    const done = JSON.parse(events.find((e) => e.event === "done")!.data) as {
      text: string;
      care: { level: string } | null;
    };
    expect(done.text).not.toContain("[[care]]");
    expect(done.care?.level).toBe("urgent");
    expect(done.text).toContain("12356");
  });

  it("持续低落：gentle 级别救助卡", async () => {
    const res = await api("POST", "/api/v1/chat", {
      message: "我连续失眠好多天了，每天都很丧，觉得活着没意思",
    });
    const data = await json<Envelope<{ care: { level: string } | null; text: string }>>(res);
    expect(data.data.care?.level).toBe("gentle");
    expect(data.data.text).not.toContain("[[care]]");
  });

  it("TTS：没有支持语音的 Key 时给出明确指引", async () => {
    const res = await api("POST", "/api/v1/tts", { text: "晚安" });
    expect(res.status).toBe(400);
    const data = await json<Envelope<null>>(res);
    expect(data.message).toContain("语音");
  });

  it("心情轨迹可查询", async () => {
    const res = await api("GET", "/api/v1/moods?limit=10");
    const data = await json<Envelope<{ moods: Array<{ emotion: string }> }>>(res);
    expect(data.success).toBe(true);
    expect(data.data.moods.length).toBeGreaterThanOrEqual(2);
  });

  it("互助模式开关", async () => {
    const on = await json<Envelope<{ enabled: boolean }>>(
      await api("POST", "/api/v1/auth/aid-mode", { enabled: true }),
    );
    expect(on.data.enabled).toBe(true);
    const me = await json<Envelope<{ aidMode: boolean }>>(await api("GET", "/api/v1/me"));
    expect(me.data.aidMode).toBe(true);
  });

  it("message 超长被拒绝", async () => {
    const res = await api("POST", "/api/v1/chat", { message: "x".repeat(4001) });
    expect(res.status).toBe(400);
  });
});
