import { useEffect, useMemo, useRef, useState } from "react";
import { SoulOrb, type OrbState } from "./orb.js";
import { cssFor } from "./palette.js";
import type { Mood } from "../lib/api.js";

interface Props {
  mood: Mood | null;
  state: OrbState;
  className?: string;
  /** 创建完成后暴露光球控制接口（如朗读时的呼吸脉冲）。 */
  exposeApi?: (api: { pulse: () => void } | null) => void;
}

/**
 * 灵魂光球：WebGL 渲染，情绪驱动色温与律动。
 * 无 WebGL 环境时以 CSS 渐变球回退（保持呼吸动画）。
 */
export default function SoulSphere({ mood, state, className, exposeApi }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbRef = useRef<SoulOrb | null>(null);
  const [cssFallback, setCssFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const orb = new SoulOrb(canvas);
    orbRef.current = orb;
    if (!orb.webgl) setCssFallback(true);
    orb.start();
    exposeApi?.({ pulse: () => orb.pulse() });
    return () => {
      orb.dispose();
      orbRef.current = null;
      exposeApi?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mood) orbRef.current?.setMood(mood);
  }, [mood]);

  useEffect(() => {
    orbRef.current?.setState(state);
  }, [state]);

  const aura = useMemo(() => cssFor(mood), [mood]);

  return (
    <div className={`relative ${className ?? ""}`} aria-hidden>
      {/* 背景氤氲：情绪色温的环境光 */}
      <div
        className="aura absolute inset-8 rounded-full opacity-25"
        style={{ background: `radial-gradient(circle, ${aura} 0%, transparent 70%)` }}
      />
      {cssFallback ? (
        <div
          className="absolute inset-0 grid place-items-center"
          style={{ ["--aura" as string]: aura }}
        >
          <div
            className="soul-fallback h-[46%] w-[46%] rounded-full"
            style={{
              background: `radial-gradient(circle at 42% 38%, rgba(255,255,255,.85) 0%, ${aura} 34%, transparent 78%)`,
              animation: "breathe 5.2s ease-in-out infinite",
            }}
          />
          <style>{`@keyframes breathe { 0%,100% { transform: scale(.94); opacity:.8 } 50% { transform: scale(1.05); opacity:1 } }`}</style>
        </div>
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      )}
    </div>
  );
}
