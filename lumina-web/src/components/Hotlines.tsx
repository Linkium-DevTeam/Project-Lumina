import { HOTLINES } from "../lib/hotlines.js";

export default function Hotlines({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#11141b] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-lg text-white/95">需要真实的帮助？</h2>
        <p className="mt-2 text-[13px] leading-6 text-white/50">
          微光愿意陪你，但有些时刻需要同样真实的人。拨打下面的电话，和专业的人说说话——这不是软弱，是照顾自己。
        </p>
        <div className="mt-5 flex flex-col gap-3">
          {HOTLINES.map((h) => (
            <a
              key={h.phone}
              href={`tel:${h.phone}`}
              className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 transition hover:bg-white/[0.07]"
            >
              <span>
                <span className="block text-[14px] text-white/85">{h.name}</span>
                <span className="block text-[11px] text-white/35">{h.note}</span>
              </span>
              <span className="font-serif text-[15px] tracking-wider text-teal-200/90">{h.phone}</span>
            </a>
          ))}
        </div>
        <p className="mt-4 text-[11px] leading-5 text-white/30">
          如果情况紧急（有即时的危险），请直接拨打 120 或 110。
          微光不是医疗设备，不能替代诊断与治疗。
        </p>
      </div>
    </div>
  );
}
