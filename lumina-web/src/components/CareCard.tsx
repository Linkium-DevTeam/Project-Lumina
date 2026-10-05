import { hotlinesFor } from "../lib/hotlines.js";
import type { CareInfo } from "../lib/api.js";

/**
 * 救助卡片：模型检出危机信号（[[care]] 协议）时出现在对应回复之后。
 * urgent = 自伤/轻生信号，醒目暖色；gentle = 持续低落，温和青色。
 * minor = 判定对方可能是青少年，追加 12355。
 */
export default function CareCard({ care, onContinue }: { care: CareInfo; onContinue: () => void }) {
  const urgent = care.level === "urgent";
  const hotlines = hotlinesFor(care.minor);

  return (
    <div
      className={`rise mt-1 max-w-[92%] rounded-3xl border p-5 ${
        urgent
          ? "border-amber-300/40 bg-amber-300/[0.06] shadow-[0_0_40px_rgba(232,162,60,0.12)]"
          : "border-teal-300/30 bg-teal-300/[0.05]"
      }`}
      role="alert"
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            urgent ? "bg-amber-300 shadow-[0_0_10px_rgba(232,162,60,0.9)]" : "bg-teal-300/80"
          }`}
        />
        <h3 className={`font-serif text-[15px] ${urgent ? "text-amber-100/95" : "text-teal-100/90"}`}>
          {urgent ? "现在，请让真实的人接住你" : "给你留了一盏灯"}
        </h3>
      </div>

      <p className="mt-2.5 text-[13px] leading-6 text-white/60">
        {urgent
          ? "你刚才说的那些话，我认真收下了。但这一刻，我更希望你身边有血肉之躯的声音——下面这些电话背后是真实的人，24小时都在，打过去不欠任何人。"
          : "有些夜晚确实很长。这几通电话背后是真实的人，想说话的时候随时都在——不打也可以，我还在这儿。"}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {hotlines.map((h) => (
          <a
            key={h.phone}
            href={`tel:${h.phone}`}
            className={`group flex items-center justify-between rounded-2xl border px-4 py-3 transition ${
              urgent
                ? "border-amber-200/20 bg-white/[0.04] hover:bg-white/[0.09]"
                : "border-white/8 bg-white/[0.02] hover:bg-white/[0.06]"
            }`}
          >
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] text-white/85">{h.name}</span>
              <span className="block text-[11px] text-white/35">{h.note}</span>
            </span>
            <span
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition ${
                urgent
                  ? "bg-amber-200/90 text-[#1a1206] group-hover:bg-amber-200"
                  : "bg-teal-200/80 text-[#06131a] group-hover:bg-teal-200"
              }`}
            >
              拨打 {h.phone}
            </span>
          </a>
        ))}
      </div>

      <div className="mt-3.5 flex items-center justify-between">
        <p className="text-[11px] text-white/30">
          紧急情况请直接拨打 120 或 110。微光不能替代专业帮助。
        </p>
        <button
          onClick={onContinue}
          className="shrink-0 rounded-full border border-white/12 px-3.5 py-1.5 text-[11.5px] text-white/60 transition hover:bg-white/10"
        >
          继续和我说话
        </button>
      </div>
    </div>
  );
}
