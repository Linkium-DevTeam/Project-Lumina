import type { Emotion, Mood } from "../lib/api.js";

export interface OrbParams {
  /** 外层主色（冷↔暖即"色温"） */
  colA: [number, number, number];
  /** 内核亮色 */
  colB: [number, number, number];
  /** 呼吸频率（rad/s）：唤醒度高 → 快 */
  rate: number;
  /** 膜面湍流：情绪越激荡越明显 */
  turb: number;
  /** 亮度 */
  bright: number;
  /** CSS 光晕色（rgba 前缀） */
  css: string;
}

function hex2rgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const PALETTE: Record<Emotion, OrbParams> = {
  calm: {
    colA: hex2rgb("#4d8fa8"), colB: hex2rgb("#bfeef2"),
    rate: 1.15, turb: 0.35, bright: 0.88, css: "#4d8fa8",
  },
  joy: {
    colA: hex2rgb("#e8a23c"), colB: hex2rgb("#ffe9b8"),
    rate: 2.0, turb: 0.55, bright: 1.05, css: "#e8a23c",
  },
  love: {
    colA: hex2rgb("#d96a8a"), colB: hex2rgb("#ffd6e0"),
    rate: 1.5, turb: 0.4, bright: 0.98, css: "#d96a8a",
  },
  sad: {
    colA: hex2rgb("#4a5a9c"), colB: hex2rgb("#a8b8e8"),
    rate: 0.7, turb: 0.3, bright: 0.62, css: "#4a5a9c",
  },
  anxious: {
    colA: hex2rgb("#7b6bd9"), colB: hex2rgb("#d0c8ff"),
    rate: 2.8, turb: 0.72, bright: 0.92, css: "#7b6bd9",
  },
  angry: {
    colA: hex2rgb("#cc4a33"), colB: hex2rgb("#ffb89a"),
    rate: 3.2, turb: 0.8, bright: 1.05, css: "#cc4a33",
  },
  lonely: {
    colA: hex2rgb("#3a6a8a"), colB: hex2rgb("#9cc8d8"),
    rate: 0.85, turb: 0.35, bright: 0.68, css: "#3a6a8a",
  },
  hopeful: {
    colA: hex2rgb("#58b89a"), colB: hex2rgb("#d8ffe8"),
    rate: 1.6, turb: 0.45, bright: 0.98, css: "#58b89a",
  },
  tired: {
    colA: hex2rgb("#8a7a6a"), colB: hex2rgb("#e8d8c0"),
    rate: 0.6, turb: 0.25, bright: 0.58, css: "#8a7a6a",
  },
};

export function paramsFor(mood: Mood): OrbParams {
  return PALETTE[mood.emotion] ?? PALETTE.calm;
}

export function cssFor(mood: Mood | null): string {
  if (!mood) return PALETTE.calm.css;
  return paramsFor(mood).css;
}

/** 情绪的中文短词（悬浮提示用）。 */
export const EMOTION_LABEL: Record<Emotion, string> = {
  calm: "平静",
  joy: "欣喜",
  love: "温柔",
  sad: "难过",
  anxious: "不安",
  angry: "生气",
  lonely: "孤独",
  hopeful: "有盼头",
  tired: "疲惫",
};
