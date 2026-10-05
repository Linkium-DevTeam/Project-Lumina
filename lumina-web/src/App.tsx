import { useCallback, useEffect, useRef, useState } from "react";
import SoulSphere from "./soul/SoulSphere.js";
import type { OrbState } from "./soul/orb.js";
import ChatView from "./components/ChatView.js";
import MoodStrip from "./components/MoodStrip.js";
import Hotlines from "./components/Hotlines.js";
import Onboarding from "./components/Onboarding.js";
import Settings from "./components/Settings.js";
import {
  api,
  store,
  type CareInfo,
  type ChatTurn,
  type Mood,
} from "./lib/api.js";
import { speak, stopSpeaking, type SpeakHandle } from "./lib/speech.js";

interface MoodMark extends Mood {
  at: string;
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [nickname, setNickname] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [mood, setMood] = useState<Mood | null>(null);
  const [marks, setMarks] = useState<MoodMark[]>([]);
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hotlinesOpen, setHotlinesOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [streamCare, setStreamCare] = useState<CareInfo | null>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orbApiRef = useRef<{ pulse: () => void } | null>(null);
  const speechHandleRef = useRef<SpeakHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingAutoReadRef = useRef<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);

  // ── 启动：校验本地 token，恢复会话与心情轨迹 ──
  useEffect(() => {
    (async () => {
      if (!store.token) return;
      try {
        const me = await api.me();
        setNickname(me.user.nickname);
        const [logs, moods] = await Promise.all([api.logs(), api.moods()]);
        setTurns(logs.logs);
        setMarks(moods.moods);
        const last = moods.moods.at(-1);
        if (last) setMood({ emotion: last.emotion, intensity: last.intensity });
        setBooted(true);
      } catch {
        store.clear();
      }
    })();
  }, []);

  const onReady = useCallback((name: string) => {
    setNickname(name);
    setBooted(true);
  }, []);

  // ── 语音 ──
  const settleSpeak = useCallback(() => {
    setSpeakingIndex(null);
    setOrbState((s) => (s === "speaking" ? "idle" : s));
  }, []);

  const startSpeak = useCallback(
    (text: string, index: number) => {
      stopSpeaking();
      speechHandleRef.current?.stop();
      audioRef.current?.pause();
      speechHandleRef.current = null;
      audioRef.current = null;
      setSpeakingIndex(index);
      setOrbState("speaking");

      if (store.voiceMode === "server") {
        api
          .tts(text)
          .then((blob) => {
            const audio = new Audio(URL.createObjectURL(blob));
            audioRef.current = audio;
            audio.onended = settleSpeak;
            audio.onerror = settleSpeak;
            void audio.play().catch(settleSpeak);
          })
          .catch((e) => {
            showToast(`${e instanceof Error ? e.message : "语音合成失败"}，改用浏览器语音`);
            speechHandleRef.current = speak(text, {
              voiceURI: store.voiceURI || undefined,
              onBoundary: () => orbApiRef.current?.pulse(),
              onEnd: settleSpeak,
            });
          });
        return;
      }

      speechHandleRef.current = speak(text, {
        voiceURI: store.voiceURI || undefined,
        onBoundary: () => orbApiRef.current?.pulse(),
        onEnd: settleSpeak,
      });
    },
    [settleSpeak, showToast],
  );

  const onSpeak = useCallback(
    (text: string, index: number | null) => {
      if (index === null) {
        stopSpeaking();
        speechHandleRef.current?.stop();
        audioRef.current?.pause();
        setSpeakingIndex(null);
        setOrbState((s) => (s === "speaking" ? "idle" : s));
        return;
      }
      startSpeak(text, index);
    },
    [startSpeak],
  );

  // 自动朗读：done 带回的文本与最新一条助手消息对上时才朗读，避免循环
  useEffect(() => {
    const pending = pendingAutoReadRef.current;
    if (!pending) return;
    const last = turns.at(-1);
    if (last?.role === "assistant" && last.content === pending) {
      pendingAutoReadRef.current = null;
      startSpeak(last.content, turns.length - 1);
    }
  }, [turns, startSpeak]);

  // ── 对话回调 ──
  const onUserTurn = useCallback((content: string) => {
    setStreamCare(null);
    setTurns((ts) => [...ts, { role: "user", content }]);
  }, []);

  const onAssistantDelta = useCallback((_chunk: string, full: string) => {
    setTurns((ts) => {
      const lastTs = ts.at(-1);
      if (lastTs?.role === "assistant") {
        return [...ts.slice(0, -1), { role: "assistant", content: full }];
      }
      return [...ts, { role: "assistant", content: full }];
    });
  }, []);

  const onAssistantMood = useCallback((m: Mood | null) => {
    if (!m) return;
    setMood(m);
    setMarks((ms) => [...ms.slice(-23), { ...m, at: new Date().toISOString() }]);
  }, []);

  const onAssistantCare = useCallback((c: CareInfo | null) => {
    setStreamCare(c);
  }, []);

  const onAssistantDone = useCallback(
    (finalText: string, source: string | null, care: CareInfo | null) => {
      setTurns((ts) => {
        const lastTs = ts.at(-1);
        if (lastTs?.role === "assistant") {
          return [
            ...ts.slice(0, -1),
            { role: "assistant", content: finalText, care },
          ];
        }
        return ts;
      });
      if (care) {
        // 卡片随消息落库展示；清掉流式态的卡避免重复
        setStreamCare(null);
        if (care.level === "urgent") {
          setMood((m) => m ?? { emotion: "sad", intensity: 0.8 });
        }
      } else {
        setStreamCare(null);
      }
      if (store.autoRead) {
        pendingAutoReadRef.current = finalText;
      }
      if (source === "pool") {
        showToast("这束光来自互助池——某位陌生人捐赠的钥匙。");
      }
    },
    [showToast],
  );

  const onError = useCallback((msg: string) => showToast(msg), [showToast]);

  const refreshPool = useCallback(() => {
    api.moods().then((m) => setMarks(m.moods)).catch(() => {});
  }, []);

  if (!booted) {
    return (
      <div className="relative h-full">
        <Onboarding onReady={onReady} />
        {hotlinesOpen && <Hotlines onClose={() => setHotlinesOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-5 pt-4">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[15px] tracking-[0.2em] text-white/80">微光</span>
          <span className="text-[10px] tracking-[0.3em] text-white/30">LUMINA</span>
        </div>
        <div className="flex items-center gap-1">
          {nickname && (
            <span className="mr-2 text-[12px] text-white/35">你好，{nickname}</span>
          )}
          <HeaderBtn
            title="需要帮助"
            onClick={() => setHotlinesOpen(true)}
            icon={
              <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] fill-none stroke-current stroke-[1.6]">
                <path
                  d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7a2 2 0 0 1 1.7 2.05z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
          <HeaderBtn
            title="设置"
            onClick={() => setSettingsOpen(true)}
            icon={
              <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] fill-none stroke-current stroke-[1.6]">
                <circle cx="12" cy="12" r="3.2" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            }
          />
        </div>
      </header>

      {/* 光球 + 心情条纹 */}
      <div className="relative flex flex-col items-center pt-2 pb-3">
        <SoulSphere
          mood={mood}
          state={orbState}
          className="h-44 w-44"
          exposeApi={(a) => {
            orbApiRef.current = a;
          }}
        />
        <div className="mt-1">
          <MoodStrip moods={marks} />
        </div>
      </div>

      {/* 对话 */}
      <ChatView
        turns={turns}
        care={streamCare}
        speakingIndex={speakingIndex}
        onSpeak={onSpeak}
        onUserTurn={onUserTurn}
        onAssistantDelta={onAssistantDelta}
        onAssistantMood={onAssistantMood}
        onAssistantCare={onAssistantCare}
        onAssistantDone={onAssistantDone}
        onStateChange={setOrbState}
        onError={onError}
      />

      {/* 悬浮提示 */}
      {toast && (
        <div className="pointer-events-none fixed bottom-28 left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/10 bg-[#161a22]/95 px-5 py-2.5 text-[13px] text-white/80 shadow-xl fadein">
          {toast}
        </div>
      )}

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={refreshPool}
      />
      {hotlinesOpen && <Hotlines onClose={() => setHotlinesOpen(false)} />}
    </div>
  );
}

function HeaderBtn({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-full text-white/45 transition hover:bg-white/8 hover:text-white/85"
    >
      {icon}
    </button>
  );
}
