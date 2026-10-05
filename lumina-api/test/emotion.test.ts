import { describe, expect, it } from "vitest";
import { extractMood, lexiconMood, parseReply, visibleSoFar } from "../src/emotion.js";
import { moodTrend } from "../src/persona.js";

describe("moodTrend", () => {
  it("识别情绪走向", () => {
    expect(moodTrend(["sad", "joy"])).toBe("easing");
    expect(moodTrend(["calm", "anxious"])).toBe("worsening");
    expect(moodTrend(["calm", "calm"])).toBe("steady");
    expect(moodTrend(["sad"])).toBe("steady");
  });
});

describe("emotion", () => {
  it("解析协议行并从正文剥离", () => {
    const raw = '辛苦了，好好休息。\n[[mood]]{"emotion":"tired","intensity":0.6}[[/mood]]';
    const { text, mood } = extractMood(raw);
    expect(text).toBe("辛苦了，好好休息。");
    expect(mood.emotion).toBe("tired");
    expect(mood.intensity).toBeCloseTo(0.6);
  });

  it("care 标签解析为救助卡，正文剥离所有标签", () => {
    const raw =
      '我在。让真实的人接住你：12356。\n[[care]]{"level":"urgent","minor":true}[[/care]]\n[[mood]]{"emotion":"sad","intensity":0.9}[[/mood]]';
    const { text, mood, care } = parseReply(raw);
    expect(text).toBe("我在。让真实的人接住你：12356。");
    expect(text).not.toContain("[[care]]");
    expect(text).not.toContain("[[mood]]");
    expect(mood.emotion).toBe("sad");
    expect(care).toEqual({ level: "urgent", minor: true });
  });

  it("无 care 标签时返回 null；损坏的 care 标签忽略", () => {
    expect(parseReply("普通回复 [[mood]]{\"emotion\":\"calm\"}[[/mood]]").care).toBeNull();
    expect(parseReply("坏标签 [[care]]{oops[[/care]]").care).toBeNull();
    expect(parseReply('错误级别 [[care]]{"level":"panic"}[[/care]]').care).toBeNull();
  });

  it("非法情绪名时退回词典", () => {
    const raw = '我很难过 [[mood]]{"emotion":"banana"}[[/mood]]';
    const { text, mood } = extractMood(raw);
    expect(text).not.toContain("banana");
    expect(mood.emotion).toBe("sad");
  });

  it("损坏的 JSON 退回词典", () => {
    const raw = "好的 [[mood]]{oops[[/mood]]";
    const { mood } = extractMood(raw);
    expect(mood.emotion).toBeTruthy();
  });

  it("词典兜底：负面词映射", () => {
    expect(lexiconMood("加班到深夜，真的好累好累").emotion).toBe("tired");
    expect(lexiconMood("一个人待着好孤独").emotion).toBe("lonely");
    expect(lexiconMood("哈哈太好了！").emotion).toBe("joy");
    expect(lexiconMood("嗯。").emotion).toBe("calm");
  });

  it("visibleSoFar 截断完整标签行（mood 与 care 取更早者）", () => {
    expect(visibleSoFar('前面的话\n[[mood]]{"emotion":"calm"}[[/mood]]')).toBe("前面的话");
    expect(
      visibleSoFar('正文\n[[care]]{"level":"urgent"}[[/care]]\n[[mood]]{"emotion":"sad"}[[/mood]]'),
    ).toBe("正文");
  });

  it("visibleSoFar 扣留不成形的前缀", () => {
    expect(visibleSoFar("你好[[mo")).toBe("你好");
    expect(visibleSoFar("你好[[ca")).toBe("你好");
    expect(visibleSoFar("你好[")).toBe("你好");
    expect(visibleSoFar("你好，在吗[呀")).toBe("你好，在吗[呀");
  });
});

