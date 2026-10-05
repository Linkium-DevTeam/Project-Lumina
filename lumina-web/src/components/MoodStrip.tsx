import { cssFor, EMOTION_LABEL } from "../soul/palette.js";
import type { Mood } from "../lib/api.js";

/** 光球下方的一串"心情圆点"：今晚这场对话的情绪轨迹。 */
export default function MoodStrip({ moods }: { moods: Array<Mood & { at: string }> }) {
  if (moods.length === 0) return <div className="h-3" />;
  return (
    <div className="flex h-3 items-center justify-center gap-1.5">
      {moods.slice(-14).map((m, i) => (
        <span
          key={i}
          title={EMOTION_LABEL[m.emotion]}
          className="inline-block rounded-full transition-all duration-700"
          style={{
            width: 5 + m.intensity * 5,
            height: 5 + m.intensity * 5,
            background: cssFor(m),
            opacity: 0.25 + m.intensity * 0.6,
          }}
        />
      ))}
    </div>
  );
}
