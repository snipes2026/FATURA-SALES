"use client";

let ctx: AudioContext | null = null;

/** Short beep through Web Audio (no sound file). "error" = low double beep, "ok" = short high beep. */
export function beep(kind: "error" | "ok" = "error") {
  try {
    ctx ??= new AudioContext();
    const tones = kind === "error" ? [0, 0.18] : [0];
    for (const at of tones) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = kind === "error" ? 220 : 1200;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      const t = ctx.currentTime + at;
      o.start(t);
      o.stop(t + (kind === "error" ? 0.14 : 0.06));
    }
  } catch {
    // no audio available — the toast still shows
  }
}
