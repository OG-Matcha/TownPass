// 聽覺與觸覺回饋：用 WebAudio 合成短音（不用音檔，離線可用），搭配震動。全部不丟例外。
export type FeedbackKind = "listen" | "heard" | "ok" | "fail";

type Note = { f: number; at: number; dur: number; type?: OscillatorType; gain?: number };

// 每種提示音總長都小於 250ms
const TONES: Record<FeedbackKind, Note[]> = {
  listen: [
    { f: 660, at: 0, dur: 0.09 },
    { f: 880, at: 0.1, dur: 0.11 },
  ],
  heard: [{ f: 740, at: 0, dur: 0.08, gain: 0.12 }],
  ok: [
    { f: 523.25, at: 0, dur: 0.1 }, // C5
    { f: 659.25, at: 0.11, dur: 0.12 }, // E5
  ],
  fail: [
    { f: 180, at: 0, dur: 0.09, type: "square", gain: 0.12 },
    { f: 180, at: 0.13, dur: 0.09, type: "square", gain: 0.12 },
  ],
};

const PATTERNS: Record<FeedbackKind, number[]> = {
  listen: [30, 40, 50],
  heard: [25],
  ok: [40, 50, 40],
  fail: [90, 60, 90],
};

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

export function earcon(kind: FeedbackKind): void {
  try {
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime + 0.01;
    for (const n of TONES[kind]) {
      const osc = c.createOscillator();
      const g = c.createGain();
      const peak = n.gain ?? 0.18;
      const s = t0 + n.at;
      osc.type = n.type ?? "sine";
      osc.frequency.setValueAtTime(n.f, s);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(peak, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + n.dur);
      osc.connect(g).connect(c.destination);
      osc.start(s);
      osc.stop(s + n.dur + 0.02);
    }
  } catch {
    /* 沒有聲音就算了 */
  }
}

export function buzz(kind: FeedbackKind): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* 不支援就略過 */
  }
}

export function feedback(kind: FeedbackKind): void {
  earcon(kind);
  buzz(kind);
}
