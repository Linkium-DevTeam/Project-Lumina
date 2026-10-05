/** 浏览器端语音合成（Web Speech API）：零成本、零延迟的默认语音通道。 */

export interface SpeakHandle {
  stop: () => void;
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** 是否存在"在线神经音色"（Edge 的晓晓/云希等），这类音色值得默认开启语音。 */
export function hasNaturalVoice(): boolean {
  if (!speechSupported()) return false;
  return listZhVoices().some((v) => !v.localService);
}

export function listZhVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("zh"));
}

/** 挑默认音色：优先微软在线神经音色（晓晓/云希/晓伊…），其次任意中文。 */
export function pickDefaultVoice(): SpeechSynthesisVoice | null {
  const voices = listZhVoices();
  if (voices.length === 0) return null;
  const natural = voices.filter((v) => !v.localService);
  const pool = natural.length > 0 ? natural : voices;
  const preferred = pool.find((v) =>
    /xiaoxiao|晓晓|yunxi|云希|xiaoyi|晓伊|xiaohan|晓涵/i.test(v.name),
  );
  return preferred ?? pool[0]!;
}

export interface SpeakOptions {
  voiceURI?: string;
  rate?: number;
  onBoundary?: () => void;
  onEnd?: () => void;
}

export function speak(text: string, opts: SpeakOptions = {}): SpeakHandle {
  if (!speechSupported()) {
    opts.onEnd?.();
    return { stop: () => {} };
  }
  const synth = window.speechSynthesis;
  synth.cancel();

  const u = new SpeechSynthesisUtterance(text);
  const voice = opts.voiceURI
    ? (synth.getVoices().find((v) => v.voiceURI === opts.voiceURI) ?? pickDefaultVoice())
    : pickDefaultVoice();
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = "zh-CN";
  }
  u.rate = opts.rate ?? 0.95;
  u.pitch = 1.0;
  u.onboundary = () => opts.onBoundary?.();
  u.onend = () => opts.onEnd?.();
  u.onerror = () => opts.onEnd?.();
  synth.speak(u);

  return {
    stop: () => {
      synth.cancel();
      opts.onEnd?.();
    },
  };
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
