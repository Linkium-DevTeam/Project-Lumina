/** 与前端共享的核心类型（前端在 lumina-web/src/lib/api.ts 有镜像定义）。 */

export type Emotion =
  | "calm"
  | "joy"
  | "love"
  | "sad"
  | "anxious"
  | "angry"
  | "lonely"
  | "hopeful"
  | "tired";

export const EMOTIONS: readonly Emotion[] = [
  "calm", "joy", "love", "sad", "anxious", "angry", "lonely", "hopeful", "tired",
];

export function isEmotion(v: unknown): v is Emotion {
  return typeof v === "string" && (EMOTIONS as readonly string[]).includes(v);
}

export interface Mood {
  emotion: Emotion;
  /** 0.0 ~ 1.0 */
  intensity: number;
}

/** 救助卡片：模型检出危机信号时随回复附带。 */
export interface CareInfo {
  /** gentle：持续低落，卡片温和；urgent：自伤/轻生信号，卡片醒目 */
  level: "gentle" | "urgent";
  /** 模型判断对方可能是青少年（学生/未成年语境），追加 12355 */
  minor?: boolean;
}

export type KeyStatus = "private" | "pool";
export type RouteSource = "own" | "pool" | "mock";

export interface KeyDto {
  id: number;
  provider: string;
  model: string;
  status: KeyStatus;
  /** API 协议格式：openai / anthropic / gemini */
  format: string;
  label: string;
  createdAt: string;
  donatedAt: string | null;
}

export interface PoolStatusDto {
  poolKeys: number;
  aidMode: boolean;
  poolDailyLimit: number;
  usedToday: number;
}

export interface UserDto {
  id: number;
  nickname: string;
  createdAt: string;
}

export interface UsageDto {
  promptTokens: number;
  completionTokens: number;
}

/** 上游用量（内部传递，与 DTO 同形）。 */
export type Usage = UsageDto;

export interface ChatResultDto {
  text: string;
  mood: Mood;
  provider: string;
  model: string;
  source: RouteSource;
  usage: UsageDto | null;
}

/** SSE 事件（chat/stream）：
 *  meta    → { provider, model, source }
 *  delta   → { text }
 *  mood    → { mood }
 *  done    → { usage, messageId }
 *  error   → { code, message }
 */
