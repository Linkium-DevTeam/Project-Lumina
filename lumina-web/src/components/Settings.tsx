import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  store,
  type KeyDto,
  type PoolStatusDto,
  type ProviderDto,
} from "../lib/api.js";
import {
  listZhVoices,
  pickDefaultVoice,
  speak,
  stopSpeaking,
} from "../lib/speech.js";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void; // 互助状态变化后通知父级刷新
}

export default function Settings({ open, onClose, onChanged }: Props) {
  const [keys, setKeys] = useState<KeyDto[]>([]);
  const [providers, setProviders] = useState<ProviderDto[]>([]);
  const [pool, setPool] = useState<PoolStatusDto | null>(null);
  const [server, setServer] = useState(store.server);
  const [adding, setAdding] = useState(false);

  // 新增 Key 表单
  const [provider, setProvider] = useState("deepseek");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [format, setFormat] = useState<"openai" | "anthropic" | "gemini">("openai");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [formErr, setFormErr] = useState("");
  const [busy, setBusy] = useState(false);

  const FORMAT_HINTS: Record<typeof format, { baseUrl: string; model: string }> = {
    openai: { baseUrl: "https://api.xxx.com/v1（OpenAI 兼容）", model: "模型名" },
    anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5 等" },
    gemini: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.0-flash 等",
    },
  };

  // 语音
  const [voiceMode, setVoiceMode] = useState<"browser" | "server">(store.voiceMode);
  const [autoRead, setAutoRead] = useState(store.autoRead);
  const [voiceURI, setVoiceURI] = useState(store.voiceURI);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [k, p, s] = await Promise.all([api.listKeys(), api.providers(), api.poolStatus()]);
      setKeys(k.keys);
      setProviders(p.providers);
      setPool(s);
    } catch {
      // 抽屉打开时的刷新失败静默处理
    }
  }, []);

  useEffect(() => {
    if (open) {
      refresh();
      loadVoices();
      const synth = window.speechSynthesis;
      if (synth) {
        const onChange = () => loadVoices();
        synth.addEventListener("voiceschanged", onChange);
        return () => synth.removeEventListener("voiceschanged", onChange);
      }
    }
  }, [open, refresh]);

  function loadVoices() {
    const vs = listZhVoices();
    if (vs.length > 0) setVoices(vs);
  }

  function previewVoice(uri: string) {
    const v = uri
      ? (window.speechSynthesis?.getVoices().find((x) => x.voiceURI === uri) ?? null)
      : pickDefaultVoice();
    speak("我在。今晚的月亮也很好看。", { voiceURI: uri, rate: 0.95 });
    void v;
  }

  function pickProvider(id: string) {
    setProvider(id);
    const def = providers.find((p) => p.id === id);
    setModel(def?.defaultModel ?? "");
    setBaseUrl("");
  }

  async function submitKey() {
    setFormErr("");
    setBusy(true);
    try {
      await api.addKey({
        provider,
        model: model || undefined,
        baseUrl: baseUrl || undefined,
        format: provider === "custom" ? format : undefined,
        apiKey,
        label: label || undefined,
      });
      setApiKey("");
      setLabel("");
      setAdding(false);
      await refresh();
      onChanged();
    } catch (e) {
      setFormErr(e instanceof ApiError ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await refresh();
      onChanged();
    } catch (e) {
      setFormErr(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  async function saveServer() {
    store.server = server.trim();
    onChanged();
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      )}
      <aside
        className={`fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#0e1118] transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-white/8 px-6 py-5">
          <h2 className="font-serif text-lg text-white/95">设置</h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {/* ── 互助模式 ── */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-medium text-white/90">互助模式</h3>
              <Toggle
                on={pool?.aidMode ?? false}
                onChange={(v) => act(() => api.setAidMode(v)).then(onChanged)}
              />
            </div>
            <p className="mt-2 text-[12.5px] leading-6 text-white/40">
              开启后，当你没有可用 Key 时，会借用互助池里他人捐赠的钥匙继续亮着。
            </p>
            {pool && (
              <div className="grid grid-cols-2 gap-2 text-center">
                <Stat label="池中钥匙" value={String(pool.poolKeys)} />
                <Stat label="今日已用" value={`${pool.usedToday}/${pool.poolDailyLimit}`} />
              </div>
            )}
          </section>

          <Divider />

          {/* ── 我的钥匙 ── */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-medium text-white/90">我的钥匙</h3>
              <button
                onClick={() => setAdding((v) => !v)}
                className="rounded-full border border-white/15 px-3 py-1 text-[12px] text-white/70 transition hover:bg-white/10"
              >
                {adding ? "收起" : "装子弹"}
              </button>
            </div>
            <p className="mt-2 text-[12.5px] leading-6 text-white/40">
              API Key 用 AES-256-GCM 加密存放在服务器上，任何接口都不会回传明文。
            </p>

            {adding && (
              <div className="mt-4 flex flex-col gap-2.5 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
                <div className="flex flex-wrap gap-1.5">
                  {[...providers.map((p) => ({ id: p.id, label: p.label })), { id: "custom", label: "自定义" }].map(
                    (p) => (
                      <button
                        key={p.id}
                        onClick={() => pickProvider(p.id)}
                        className={`rounded-full px-3 py-1 text-[12px] transition ${
                          provider === p.id
                            ? "bg-white/90 text-[#0b0d12]"
                            : "border border-white/12 text-white/60 hover:bg-white/10"
                        }`}
                      >
                        {p.label}
                      </button>
                    ),
                  )}
                </div>
                {provider === "custom" && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {(["openai", "anthropic", "gemini"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setFormat(f)}
                          className={`rounded-full px-3 py-1 text-[12px] transition ${
                            format === f
                              ? "bg-white/90 text-[#0b0d12]"
                              : "border border-white/12 text-white/60 hover:bg-white/10"
                          }`}
                        >
                          {f === "openai" ? "OpenAI 兼容" : f === "anthropic" ? "Anthropic" : "Gemini"}
                        </button>
                      ))}
                    </div>
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder={FORMAT_HINTS[format].baseUrl}
                      className={inputCls}
                    />
                  </>
                )}
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={
                    provider === "custom"
                      ? FORMAT_HINTS[format].model + "（必填）"
                      : "模型名（默认已填）"
                  }
                  className={inputCls}
                />
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="API Key（sk-…）"
                  type="password"
                  className={inputCls}
                />
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="备注（可选，如「我的主力号」）"
                  className={inputCls}
                />
                {formErr && <p className="text-xs text-rose-300/80">{formErr}</p>}
                <button
                  onClick={submitKey}
                  disabled={busy || !apiKey.trim()}
                  className="rounded-xl bg-white/90 py-2.5 text-[13px] font-medium text-[#0b0d12] hover:bg-white disabled:opacity-40"
                >
                  {busy ? "正在装入…" : "装入"}
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-col gap-2">
              {keys.length === 0 && !adding && (
                <p className="text-[13px] text-white/30">还没有钥匙。装一把，或开启互助模式。</p>
              )}
              {keys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] text-white/85">
                        {providers.find((p) => p.id === k.provider)?.label ?? k.provider}
                        <span className="ml-1.5 text-[11px] text-white/35">{k.model}</span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                          k.status === "pool"
                            ? "bg-teal-400/15 text-teal-200/90"
                            : "bg-white/8 text-white/45"
                        }`}
                      >
                        {k.status === "pool" ? "池中" : "私有"}
                      </span>
                      {k.provider === "custom" && (
                        <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/45">
                          {k.format === "openai" ? "OAI" : k.format === "anthropic" ? "ANTH" : "GEM"}
                        </span>
                      )}
                    </div>
                    {k.label && <div className="mt-0.5 truncate text-[11px] text-white/30">{k.label}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {k.status === "private" ? (
                      <IconBtn title="捐入互助池" onClick={() => act(() => api.donateKey(k.id))}>
                        💡
                      </IconBtn>
                    ) : (
                      <IconBtn title="从互助池撤回" onClick={() => act(() => api.withdrawKey(k.id))}>
                        ↩
                      </IconBtn>
                    )}
                    <IconBtn title="删除" onClick={() => act(() => api.deleteKey(k.id))}>
                      ✕
                    </IconBtn>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <Divider />

          {/* ── 语音 ── */}
          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-medium text-white/90">读给我听</h3>
            </div>
            <div className="mt-3 flex gap-1.5">
              {(
                [
                  { id: "browser", label: "浏览器语音（免费）" },
                  { id: "server", label: "服务端合成" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setVoiceMode(m.id);
                    store.voiceMode = m.id;
                    stopSpeaking();
                  }}
                  className={`rounded-full px-3.5 py-1.5 text-[12px] transition ${
                    voiceMode === m.id
                      ? "bg-white/90 text-[#0b0d12]"
                      : "border border-white/12 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {voiceMode === "browser" && (
              <div className="mt-3 flex items-center gap-2">
                <select
                  value={voiceURI}
                  onChange={(e) => {
                    setVoiceURI(e.target.value);
                    store.voiceURI = e.target.value;
                  }}
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[13px] text-white/90 outline-none focus:border-white/25"
                >
                  <option value="">默认音色</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name}
                      {v.localService ? "（本地）" : ""}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => previewVoice(voiceURI)}
                  className="shrink-0 rounded-xl border border-white/15 px-4 py-2.5 text-[13px] text-white/75 hover:bg-white/10"
                >
                  试听
                </button>
              </div>
            )}
            {voiceMode === "server" && (
              <p className="mt-2.5 text-[12px] leading-6 text-white/40">
                走服务端合成（更稳定自然），需要一把支持语音的自有 Key——
                硅基流动（CosyVoice2）、OpenAI、OrcaRouter 已内置语音模型，
                其他 custom Key 请求时指定 model。只在自有 Key 下可用，不消耗互助池。
              </p>
            )}

            <div className="mt-4 flex items-center justify-between">
              <span className="text-[13.5px] text-white/70">新回复自动朗读</span>
              <Toggle
                on={autoRead}
                onChange={(v) => {
                  setAutoRead(v);
                  store.autoRead = v;
                  if (!v) stopSpeaking();
                }}
              />
            </div>
          </section>

          <Divider />

          {/* ── 连接 ── */}
          <section>
            <h3 className="text-[15px] font-medium text-white/90">服务器</h3>
            <p className="mt-2 text-[12.5px] leading-6 text-white/40">
              默认连接部署时的同源服务。你也可以指向任何自托管的 Lumina 服务。
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="https://你的域名（留空 = 同源）"
                className={inputCls}
              />
              <button
                onClick={saveServer}
                className="shrink-0 rounded-xl border border-white/15 px-4 text-[13px] text-white/75 hover:bg-white/10"
              >
                保存
              </button>
            </div>
          </section>

          <Divider />

          {/* ── 关于 ── */}
          <section className="pb-4">
            <h3 className="text-[15px] font-medium text-white/90">关于微光</h3>
            <p className="mt-2 font-serif text-[13px] leading-6 text-white/40 italic">
              "万物皆有裂痕，那是光照进来的地方。"
            </p>
            <p className="mt-2 text-[11.5px] leading-5 text-white/30">
              Lumina v2.0 · Apache-2.0 开源。客户端（枪）免费，Key（子弹）自备，
              数据自持。它不是医疗设备，不能替代诊断与治疗。
            </p>
          </section>
        </div>
      </aside>
    </>
  );
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[13px] text-white/90 outline-none placeholder:text-white/25 focus:border-white/25";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-2 py-2.5">
      <div className="font-serif text-[15px] text-white/85">{value}</div>
      <div className="mt-0.5 text-[10.5px] text-white/35">{label}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition ${on ? "bg-teal-300/80" : "bg-white/15"}`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          on ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function IconBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-full text-[13px] text-white/45 transition hover:bg-white/10 hover:text-white/90"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <hr className="my-6 border-white/6" />;
}
