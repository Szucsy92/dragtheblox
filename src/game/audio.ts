// Tiny synthesized toy sounds (Web Audio). Created lazily on first gesture.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastKnock = 0;

function ac() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext || (window as any).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function unlockAudio() {
  ac();
}

function tone(freq: number, dur: number, vol: number, type: OscillatorType = "sine", slide = 0) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, freq: number) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = 3;
  const g = c.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(master);
  s.start(t);
}

/** wooden knock, strength 0..1 */
export function knock(strength: number) {
  const c = ac();
  if (!c) return;
  const now = performance.now();
  if (now - lastKnock < 35) return;
  lastKnock = now;
  const v = Math.min(1, Math.max(0.05, strength));
  const f = 380 + Math.random() * 260;
  tone(f, 0.09, 0.25 * v, "triangle", -120);
  noise(0.05, 0.5 * v, 1800 + Math.random() * 800);
}

export const sfx = {
  spawn: () => tone(520, 0.18, 0.25, "sine", 500),
  pick: () => tone(700, 0.08, 0.15, "sine", 200),
  drop: () => tone(500, 0.1, 0.12, "sine", -200),
  trash: () => {
    tone(400, 0.25, 0.2, "square", -320);
    noise(0.2, 0.3, 900);
  },
  clear: () => {
    tone(660, 0.12, 0.2, "triangle", -200);
    setTimeout(() => tone(440, 0.2, 0.2, "triangle", -200), 90);
  },
  click: () => tone(900, 0.04, 0.1, "sine"),
};
