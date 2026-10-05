import { useEffect, useRef, useState } from "react";
import { chatStream, type CareInfo, type ChatTurn } from "../lib/api.js";
import type { OrbState } from "../soul/orb.js";
import CareCard from "./CareCard.js";

interface Props {
  turns: ChatTurn[];
  /** 正在流式生成中的救助卡（本轮命中危机协议时出现） */
  care: CareInfo | null;
  speakingIndex: number | null;
  onSpeak: (text: string, index: number | null) => void;
  onUserTurn: (content: string) => void;
  onAssistantDelta: (chunk: string, full: string) => void;
  onAssistantMood: (mood: import("../lib/api.js").Mood | null) => void;
  onAssistantCare: (care: CareInfo | null) => void;
  onAssistantDone: (finalText: string, source: string | null, care: CareInfo | null) => void;
  onStateChange: (s: OrbState) => void;
  onError: (msg: string) => void;
}

const SOURCE_BADGE: Record<string, string> = {
  own: "自有之光",
  pool: "互助之光",
  mock: "演示之光",
};

export default function ChatView({
  turns,
  care,
  speakingIndex,
  onSpeak,
  onUserTurn,
  onAssistantDelta,
  onAssistantMood,
  onAssistantCare,
  onAssistantDone,
  onStateChange,
  onError,
}: Props) {
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fullRef = useRef("");

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streaming]);

  async function send() {
    const message = input.trim();
    if (!message || streaming) return;
    setInput("");
    onUserTurn(message);
    setStreaming(true);
    setSource(null);
    fullRef.current = "";
    onStateChange("thinking");

    const ac = new AbortController();
    abortRef.current = ac;

    // 闭包里的 turns 尚不含本条消息，正好作为历史上下文
    await chatStream(
      message,
      turns,
      {
        onMeta: (meta) => setSource(SOURCE_BADGE[meta.source] ?? meta.provider),
        onDelta: (chunk) => {
          fullRef.current += chunk;
          onAssistantDelta(chunk, fullRef.current);
          onStateChange("speaking");
        },
        onMood: (mood) => onAssistantMood(mood),
        onCare: (c) => onAssistantCare(c),
        onDone: (info) => {
          onAssistantDone(info.text || fullRef.current, info.source, info.care ?? null);
          setStreaming(false);
          onStateChange("idle");
        },
        onError: (err) => {
          onError(err.message);
          setStreaming(false);
          onStateChange("idle");
        },
      },
      ac.signal,
    );
    setStreaming(false);
    onStateChange("idle");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 消息区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 pb-4">
          {turns.length === 0 && !streaming && (
            <div className="fadein pt-2 text-center text-[13px] leading-6 text-white/28">
              今晚想从哪儿说起？随便什么都行。
            </div>
          )}
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="rise flex justify-end">
                <div className="max-w-[80%] rounded-3xl rounded-br-lg border border-white/8 bg-white/[0.05] px-4 py-2.5 text-[14.5px] leading-7 text-white/85 whitespace-pre-wrap">
                  {t.content}
                </div>
              </div>
            ) : (
              <div key={i} className="rise">
                <div className="flex items-start gap-2.5">
                  <span className="mt-[9px] h-2 w-2 shrink-0 rounded-full bg-teal-300/70 shadow-[0_0_8px_rgba(94,200,220,.8)]" />
                  <div className="group max-w-[85%] pt-1 text-[14.5px] leading-7 whitespace-pre-wrap text-white/80">
                    {t.content}
                    <button
                      onClick={() =>
                        onSpeak(t.content, speakingIndex === i ? null : i)
                      }
                      title={speakingIndex === i ? "停止朗读" : "读给我听"}
                      className={`ml-2 inline-grid h-6 w-6 translate-y-1 place-items-center rounded-full align-middle transition ${
                        speakingIndex === i
                          ? "bg-teal-300/20 text-teal-200"
                          : "text-white/25 hover:bg-white/8 hover:text-white/70"
                      }`}
                      aria-label={speakingIndex === i ? "停止朗读" : "读给我听"}
                    >
                      {speakingIndex === i ? (
                        <span className="block h-2 w-2 rounded-[2px] bg-current" />
                      ) : (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.8]">
                          <path
                            d="M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                {t.care && <CareCard care={t.care} onContinue={() => {}} />}
              </div>
            ),
          )}
          {care && <CareCard care={care} onContinue={() => {}} />}
          {streaming && source && (
            <div className="text-center text-[11px] tracking-wide text-white/25">· {source} ·</div>
          )}
        </div>
      </div>

      {/* 输入区 */}
      <div className="px-5 pb-5 pt-2">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => onStateChange("listening")}
            onBlur={() => onStateChange("idle")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"
            className="max-h-40 min-h-[52px] w-full resize-none rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-3.5 text-[14.5px] leading-6 text-white/90 outline-none placeholder:text-white/25 focus:border-white/25"
          />
          <button
            onClick={streaming ? () => abortRef.current?.abort() : send}
            disabled={!streaming && !input.trim()}
            className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-white/90 text-[#0b0d12] transition hover:bg-white disabled:opacity-30"
            aria-label={streaming ? "停止" : "发送"}
          >
            {streaming ? (
              <span className="block h-3 w-3 rounded-[3px] bg-current" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2">
                <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
