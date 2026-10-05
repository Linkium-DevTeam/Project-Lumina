import { useState } from "react";
import SoulSphere from "../soul/SoulSphere.js";
import { api } from "../lib/api.js";

export default function Onboarding({ onReady }: { onReady: (nickname: string) => void }) {
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function lightUp() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const name = nickname.trim() || "旅人";
      await api.register(name);
      onReady(name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "点亮失败，稍后再试");
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 px-6">
      <SoulSphere mood={null} state="idle" className="h-52 w-52" />

      <div className="max-w-md text-center">
        <h1 className="font-serif text-3xl tracking-wide text-white/95">微光 Lumina</h1>
        <p className="mt-5 font-serif text-[15px] leading-7 text-white/55 italic">
          "There is a crack in everything,
          <br />
          that's how the light gets in."
        </p>
        <p className="mt-1.5 text-xs text-white/35">万物皆有裂痕，那是光照进来的地方。</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lightUp()}
          maxLength={24}
          placeholder="怎么称呼你？"
          className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3.5 text-center text-[15px] text-white/90 outline-none placeholder:text-white/25 focus:border-white/25"
        />
        <button
          onClick={lightUp}
          disabled={busy}
          className="w-full rounded-2xl bg-white/90 px-5 py-3.5 text-[15px] font-medium text-[#0b0d12] transition hover:bg-white disabled:opacity-50"
        >
          {busy ? "正在点亮…" : "点亮微光"}
        </button>
        {err && <p className="text-center text-xs text-rose-300/80">{err}</p>}
      </div>

      <p className="absolute bottom-6 text-center text-[11px] leading-5 text-white/25">
        陪你说话的光。它不是医生，也不能替代专业帮助。
      </p>
    </div>
  );
}
