import { afterEach, describe, expect, it, vi } from "vitest";
import { callChat, callChatStream, validateUpstreamUrl, type CallOptions } from "../src/provider.js";

/** 测试夹具：运行时生成，非真实凭据。 */
const FAKE_KEY = `sk-test-${crypto.randomUUID().slice(0, 12)}`;
const BEARER = `Bearer ${FAKE_KEY}`;

function baseOpts(overrides: Partial<CallOptions> = {}): CallOptions {
  return {
    baseUrl: "https://api.example.com",
    apiKey: FAKE_KEY,
    model: "some-model",
    format: "openai",
    messages: [
      { role: "system", content: "你是微光。" },
      { role: "user", content: "在吗" },
    ],
    ...overrides,
  };
}

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function captureFetch(respondJson: unknown, status = 200): { captured: Captured[] } {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: { headers?: Record<string, string>; body?: string }) => {
      captured.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(init?.body ?? "{}"),
      });
      return new Response(JSON.stringify(respondJson), { status });
    }),
  );
  return { captured };
}

function sseFetch(lines: string[]): void {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openai 格式", () => {
  it("请求头与端点正确，解析 message.content", async () => {
    const { captured } = captureFetch({
      choices: [{ message: { content: "嗯，我在。" } }],
    });
    const r = await callChat(baseOpts());
    expect(r.text).toBe("嗯，我在。");
    expect(captured[0]!.url).toBe("https://api.example.com/chat/completions");
    expect(captured[0]!.headers.authorization).toBe(BEARER);
    expect(captured[0]!.body.model).toBe("some-model");
  });

  it("流式解析 data: 增量，[DONE] 收尾", async () => {
    sseFetch([
      'data: {"choices":[{"delta":{"content":"先呼"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"——吸"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const out: string[] = [];
    for await (const d of callChatStream(baseOpts())) out.push(d);
    expect(out.join("")).toBe("先呼——吸");
  });
});

describe("anthropic 格式", () => {
  it("system 提为顶层字段、带 x-api-key 与版本头、端点 /v1/messages", async () => {
    const { captured } = captureFetch({
      content: [{ type: "text", text: "我在。" }],
    });
    const r = await callChat(baseOpts({ format: "anthropic" }));
    expect(r.text).toBe("我在。");
    const req = captured[0]!;
    expect(req.url).toBe("https://api.example.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe(FAKE_KEY);
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    expect(req.body.system).toBe("你是微光。");
    const msgs = req.body.messages as Array<{ role: string }>;
    expect(msgs).toHaveLength(1); // system 已抽出
    expect(msgs[0]!.role).toBe("user");
  });

  it("流式解析 content_block_delta", async () => {
    sseFetch([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"晚"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"安"}}\n\n',
    ]);
    const out: string[] = [];
    for await (const d of callChatStream(baseOpts({ format: "anthropic" }))) out.push(d);
    expect(out.join("")).toBe("晚安");
  });
});

describe("gemini 格式", () => {
  it("角色映射 model/user、systemInstruction、x-goog-api-key", async () => {
    const { captured } = captureFetch({
      candidates: [{ content: { parts: [{ text: "还没睡？" }] } }],
    });
    const r = await callChat(
      baseOpts({
        format: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "u1" },
          { role: "assistant", content: "a1" },
          { role: "user", content: "u2" },
        ],
      }),
    );
    expect(r.text).toBe("还没睡？");
    const req = captured[0]!;
    expect(req.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/some-model:generateContent",
    );
    expect(req.headers["x-goog-api-key"]).toBe(FAKE_KEY);
    expect((req.body.systemInstruction as { parts: Array<{ text: string }> }).parts[0]!.text).toBe(
      "sys",
    );
    const contents = req.body.contents as Array<{ role: string }>;
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  });

  it("流式走 alt=sse 并解析 candidates parts", async () => {
    sseFetch([
      'data: {"candidates":[{"content":{"parts":[{"text":"早"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"安"}]}}]}\n\n',
    ]);
    const out: string[] = [];
    for await (const d of callChatStream(
      baseOpts({ format: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" }),
    ))
      out.push(d);
    expect(out.join("")).toBe("早安");
  });
});

describe("SSRF 校验", () => {
  it("拒绝非 http(s) 协议", () => {
    expect(() => validateUpstreamUrl("file:///etc/passwd")).toThrow();
    expect(() => validateUpstreamUrl("gopher://x")).toThrow();
  });

  it("拒绝环回/内网/保留地址", () => {
    for (const bad of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:8080/v1",
      "http://192.168.1.5/v1",
      "http://10.0.0.3/v1",
      "http://172.16.0.9/v1",
      "http://169.254.169.254/latest",
      "http://[::1]:9000/v1",
      "http://sub.localhost/v1",
    ]) {
      expect(() => validateUpstreamUrl(bad), bad).toThrow();
    }
  });

  it("放行公网 https 地址并规范化末尾斜杠", () => {
    expect(validateUpstreamUrl("https://api.orcarouter.ai/v1/")).toBe(
      "https://api.orcarouter.ai/v1",
    );
  });
});
