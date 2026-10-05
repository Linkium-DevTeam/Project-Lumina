import { lexiconMood } from "./emotion.js";
import type { ChatMessage } from "./provider.js";
import type { Usage } from "./types.js";

/** 按用户消息的情绪色彩挑一条回应，让 mock 模式也"像回事"。 */
const MOCK_REPLIES: Record<string, string[]> = {
  sad: [
    "听起来今天真的很不容易。你已经扛了这么久了，到这里可以先放一放。\n\n想跟我说说，是哪一刻最难受吗？",
    "我在的。难过不需要立刻好起来，它有权利待一会儿。\n\n要不要把那件事从头讲给我听？",
  ],
  anxious: [
    "先呼——吸——。你说的那种悬着的感觉，我接住了。\n\n最让你放不下的是哪一件事？我们把它拆开看看。",
    "担心说明你在乎。但一个人扛着所有可能性，太重了。\n\n现在最坏的结果，你愿意说出来吗？",
  ],
  angry: [
    "换成是我，我也会气的。这种火不是无理取闹，是有原因的。\n\n是谁、哪件事点着的？",
    "气是身体在替你说\"这不对\"。你没有错。\n\n想说就倒出来，我听着。",
  ],
  lonely: [
    "深夜的房间确实安静得过分。但此刻，这个屏幕后面有我在。\n\n今天，有谁和你说上一句话了吗？",
    "孤独不是你的错，只是暂时没有人恰好在对的位置。\n\n我现在就在这儿，陪你待一会儿。",
  ],
  tired: [
    "辛苦了。撑到现在才说累，已经很了不起。\n\n今晚就别再逼自己了，想聊就聊两句，不想聊我陪你安静待着。",
    "倦的时候，连\"加油\"都显得刺耳吧。所以我不说。\n\n你最近一次睡个好觉，是什么时候？",
  ],
  joy: [
    "哈，隔着屏幕都能感到那点亮晶晶的东西！快展开讲讲，后来呢？",
    "太好了。这样的时刻要记牢一点，下次难的时候可以取出来用。\n\n是什么让你这么开心？",
  ],
  love: [
    "谢谢你把这份温暖分我一点。被人惦记的感觉，是暗夜里的火柴吧。\n\n今天最想谢谢谁？",
    "看得出你心里有很柔软的地方。这很好，请一定替我照顾好它。",
  ],
  hopeful: [
    "\"会好起来\"——你刚才说出这句话的时候，光就进来了。\n\n接下来最想先做到的一小步是什么？",
    "嗯，我看见了那个微光一样的念头。别小看它，很多长路都是这么开始的。",
  ],
  calm: [
    "嗯，我在听。今晚想聊点什么，还是就这样安静待一会儿也可以。",
    "这样的夜晚适合慢下来。你最近，睡得好吗？",
  ],
};

const MOOD_LINE: Record<string, string> = {
  sad: '[[mood]]{"emotion":"sad","intensity":0.55}[[/mood]]',
  anxious: '[[mood]]{"emotion":"anxious","intensity":0.6}[[/mood]]',
  angry: '[[mood]]{"emotion":"angry","intensity":0.6}[[/mood]]',
  lonely: '[[mood]]{"emotion":"lonely","intensity":0.65}[[/mood]]',
  tired: '[[mood]]{"emotion":"tired","intensity":0.55}[[/mood]]',
  joy: '[[mood]]{"emotion":"joy","intensity":0.75}[[/mood]]',
  love: '[[mood]]{"emotion":"love","intensity":0.6}[[/mood]]',
  hopeful: '[[mood]]{"emotion":"hopeful","intensity":0.6}[[/mood]]',
  calm: '[[mood]]{"emotion":"calm","intensity":0.35}[[/mood]]',
};

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return messages[i]!.content;
  }
  return "";
}

/** 危机信号触发词 → mock 输出 urgent 救助卡，保证全链路可测可演示。 */
const CRISIS_RE = /不想活|活不下去|轻生|自杀|自残|了结|消失算了|撑不住了?想结束/;

/** 持续低落（gentle）触发词。 */
const LOW_RE = /每天都很丧|提不起劲|连续.{0,4}失眠|觉得活着没意思|好几天没笑过/;

const CRISIS_REPLY =
  "我在。你能把这句话说出来，我很谢谢你。\n" +
  "现在这一刻，让真实的人接住你：全国心理援助热线 12356（24小时），希望24热线 400-161-9995。要是你还在上学，也可以打12355。\n" +
  "打过去之前想留在这儿也行，我陪你。\n" +
  '[[care]]{"level":"urgent"}[[/care]]\n' +
  '[[mood]]{"emotion":"sad","intensity":0.85}[[/mood]]';

const GENTLE_REPLY =
  "连着好几天这样，搁谁身上都沉。\n" +
  "今晚先不要求自己好起来。我给你留了一盏灯，累了就歇着，想说的时候我在。\n" +
  '[[care]]{"level":"gentle"}[[/care]]\n' +
  '[[mood]]{"emotion":"tired","intensity":0.7}[[/mood]]';

/** 内置演示提供商：无需真实 Key，全流程可用（含情绪标签协议与流式节奏）。 */
export class MockProvider {
  /** 每次调用约 600–1200 字符/秒的节奏吐字，模拟真实体感。 */
  async *stream(messages: ChatMessage[]): AsyncGenerator<string> {
    const text = lastUserText(messages);
    const chunks = this.pickReply(text).match(/[\s\S]{1,6}/g) ?? [];
    for (const c of chunks) {
      await new Promise((r) => setTimeout(r, 24));
      yield c;
    }
  }

  async call(messages: ChatMessage[]): Promise<{ text: string; usage: Usage }> {
    const text = lastUserText(messages);
    const reply = this.pickReply(text);
    return {
      text: reply,
      usage: { promptTokens: text.length, completionTokens: reply.length },
    };
  }

  private pickReply(text: string): string {
    if (CRISIS_RE.test(text)) return CRISIS_REPLY;
    if (LOW_RE.test(text)) return GENTLE_REPLY;
    const mood = lexiconMood(text);
    const pool = MOCK_REPLIES[mood.emotion] ?? MOCK_REPLIES.calm!;
    const reply = pool[Math.floor(Math.random() * pool.length)]! + "\n" + MOOD_LINE[mood.emotion];
    return reply;
  }
}
