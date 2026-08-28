// Deterministic sound-design kit for the teaser — synthesizes small WAV files
// (44.1kHz mono 16-bit) with a seeded PRNG so every run is identical.
// Usage: node scripts/make-sfx.mjs   (writes into assets/sfx/)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "sfx");
mkdirSync(OUT, { recursive: true });

// xorshift32 — seeded noise
function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

function wav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(join(OUT, name), buf);
  console.log("  ✓", name, (buf.length / 1024).toFixed(1) + "KB");
}

const sec = (s) => Math.round(s * SR);
const env = (i, a, d, n) => {
  const t = i / n;
  const at = a / (a + d);
  return t < at ? t / at : Math.exp(-6 * (t - at) / (1 - at));
};

// whoosh — 0.55s falling filtered-noise swell (the zoom-out whip)
{
  const n = sec(0.55), rnd = prng(1201), out = new Float32Array(n);
  let lp = 0, lp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const cutoff = 0.35 * Math.pow(1 - t, 1.6) + 0.015; // falling brightness
    lp += cutoff * (rnd() - lp);
    lp2 += cutoff * (lp - lp2);
    const e = Math.sin(Math.PI * Math.min(1, t * 1.25)) ** 1.5; // swell then die
    out[i] = lp2 * e * 2.2;
  }
  wav("whoosh.wav", out);
}

// shutter — two soft mechanical ticks 45ms apart
{
  const n = sec(0.22), rnd = prng(7331), out = new Float32Array(n);
  const click = (at, gain, tone) => {
    const start = sec(at), len = sec(0.035);
    let lp = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      lp += tone * (rnd() - lp);
      out[start + i] += lp * Math.exp(-10 * (i / len)) * gain * 3;
    }
  };
  click(0.0, 1.0, 0.5);
  click(0.045, 0.55, 0.35);
  wav("shutter.wav", out);
}

// tick — tiny warm blip for data chips landing
{
  const n = sec(0.09), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = Math.sin(2 * Math.PI * 1180 * t) * env(i, 0.004, 0.996, n) * 0.32
           + Math.sin(2 * Math.PI * 2360 * t) * env(i, 0.004, 0.996, n) * 0.08;
  }
  wav("tick.wav", out);
}

// thump — low soft impact for headline beats / seal stamp
{
  const n = sec(0.3), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 118 * Math.exp(-6 * t) + 46;
    out[i] = Math.sin(2 * Math.PI * f * t) * env(i, 0.003, 0.997, n) * 0.9;
  }
  wav("thump.wav", out);
}

// chime — two-note soft save confirmation
{
  const n = sec(0.55), out = new Float32Array(n);
  const note = (at, f, g) => {
    const start = sec(at), len = n - start;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const e = env(i, 0.006, 0.994, len);
      out[start + i] += (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t)) * e * g;
    }
  };
  note(0, 659.26, 0.28);   // E5
  note(0.1, 987.77, 0.22); // B5
  wav("chime.wav", out);
}
console.log("done");
