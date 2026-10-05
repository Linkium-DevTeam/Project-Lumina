import { isEmotion, type Mood, type Emotion, type CareInfo } from "./types.js";

/**
 * 模型输出协议：正文之后可跟两行结构化标签，服务端解析并剥离，用户不可见。
 *   [[mood]]{"emotion":"joy","intensity":0.6}[[/mood]]   情绪 → 光球
 *   [[care]]{"level":"urgent","minor":true}[[/care]]      危机信号 → 救助卡片
 *
 * 解析顺序：先 care 后 mood（正文剥离两者）。
 * 模型未按约定输出时，情绪退回轻量词典扫描；care 缺失即无卡片。
 */

const MOOD_RE = /\[\[mood\]\]\s*(\{[\s\S]*?\})\s*\[\[\/mood\]\]/i;
const CARE_RE = /\[\[care\]\]\s*(\{[\s\S]*?\})\s*\[\[\/care\]\]/i;
/** 流式时用于扣留"正在成形"的标签前缀。 */
const TAG_OPENERS = ["[[care]]", "[[mood]]"];

/** 剥离所有协议标签行。 */
function stripTags(raw: string): string {
  return raw.replace(CARE_RE, "").replace(MOOD_RE, "");
}

export interface ParsedReply {
  text: string;
  mood: Mood;
  care: CareInfo | null;
}

/** 解析模型完整回复：正文 + 情绪 + 救助卡（若有）。先解析再剥离，顺序不可颠倒。 */
export function parseReply(raw: string): ParsedReply {
  let care: CareInfo | null = null;
  const cm = raw.match(CARE_RE);
  if (cm) {
    try {
      const obj = JSON.parse(cm[1]!) as { level?: unknown; minor?: unknown };
      if (obj.level === "urgent" || obj.level === "gentle") {
        care = {
          level: obj.level,
          ...(obj.minor === true ? { minor: true } : {}),
        };
      }
    } catch {
      // 损坏的 care 标签视为无卡片
    }
  }
  const noCare = raw.replace(CARE_RE, "");
  const moodParsed = parseMoodFrom(noCare);
  return { text: moodParsed.text, mood: moodParsed.mood, care };
}

export function parseMoodFrom(raw: string): { text: string; mood: Mood } {
  const m = raw.match(MOOD_RE);
  if (m) {
    try {
      const obj = JSON.parse(m[1]!) as { emotion?: unknown; intensity?: unknown };
      if (isEmotion(obj.emotion)) {
        const intensity = clamp01(Number(obj.intensity ?? 0.5));
        return {
          text: raw.replace(MOOD_RE, "").trimEnd(),
          mood: { emotion: obj.emotion, intensity },
        };
      }
    } catch {
      // fall through to lexicon
    }
  }
  const stripped = raw.replace(MOOD_RE, "");
  return { text: stripped.trimEnd(), mood: lexiconMood(stripped) };
}

/** 兼容旧调用方：只关心正文与情绪。 */
export function extractMood(raw: string): { text: string; mood: Mood } {
  const r = parseReply(raw);
  return { text: r.text, mood: r.mood };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

// ── 词典兜底：按命中词计数 + 强度权重，粗略但够用 ──

const LEXICON: Array<[Emotion, RegExp, number]> = [
  ["angry", /愤怒|生气|可恶|气死|火大|气死我|怒|烦死了/g, 0.8],
  ["anxious", /焦虑|紧张|害怕|担心|慌|恐惧|不安|心慌|睡不着|失眠/g, 0.7],
  ["sad", /难过|伤心|想哭|哭|低落|沮丧|失望|无助|崩溃|抑郁/g, 0.7],
  ["lonely", /孤独|孤单|没人|一个人|空虚|寂寞|被忽视|没人理/g, 0.7],
  ["tired", /累|疲惫|倦|撑不住|耗尽|精力|麻木|压力好大/g, 0.6],
  ["joy", /开心|高兴|快乐|哈哈|太好了|兴奋|愉快|笑/g, 0.7],
  ["love", /爱|喜欢|温暖|感动|幸福|抱抱|谢谢|感谢/g, 0.6],
  ["hopeful", /希望|加油|期待|好起来|相信|努力|明天/g, 0.5],
];

export function lexiconMood(text: string): Mood {
  let best: { emotion: Emotion; score: number } | null = null;
  for (const [emotion, re, weight] of LEXICON) {
    const hits = text.match(re)?.length ?? 0;
    if (hits === 0) continue;
    const score = Math.min(1, hits * weight * 0.4);
    if (!best || score > best.score) best = { emotion, score };
  }
  if (!best) return { emotion: "calm", intensity: 0.3 };
  return { emotion: best.emotion, intensity: Math.max(0.35, best.score) };
}

/**
 * 流式过程中从已积累文本里截取"可见文本"：剥掉完整标签行，
 * 并暂时扣留末尾可能正在成形的 "[[care]]" / "[[mood]]" 前缀。
 */
export function visibleSoFar(buffer: string): string {
  let end = buffer.length;
  for (const tag of TAG_OPENERS) {
    const open = buffer.indexOf(tag);
    if (open >= 0) end = Math.min(end, open);
    else {
      for (let i = 1; i <= Math.min(tag.length, buffer.length); i++) {
        if (tag.startsWith(buffer.slice(buffer.length - i))) {
          end = Math.min(end, buffer.length - i);
        }
      }
    }
  }
  return buffer.slice(0, end).trimEnd();
}
