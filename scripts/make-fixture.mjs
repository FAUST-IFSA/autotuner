// Generates a synthetic, vocal-like test file with known ground truth.
// Harmonic tone with a vowel-ish spectral envelope, vibrato, scoops, breath noise and gaps.
// Usage: node scripts/make-fixture.mjs [--if-missing]
//   -> fixtures/synth-vocal-{44k-stereo,22k-mono}.wav + .truth.json
import fs from 'node:fs';

if (process.argv.includes('--if-missing') && fs.existsSync('fixtures/synth-vocal-22k-mono.wav')) process.exit(0);

function encodeWav(channels, sampleRate) {
  const n = channels[0].length,
    ch = channels.length;
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * ch * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      buf.writeInt16LE(Math.round(s * 32767), o);
      o += 2;
    }
  return buf;
}

// [startSec, durSec, midi (with deliberate detune), vibratoCents]
const melody = [];
const pitches = [
  57.0, 59.2, 60.1, 62.0, 64.35, 62.0, 60.0, 59.0, 57.0, 64.0, 65.15, 67.0, 69.0, 67.0, 65.0, 64.0,
  62.0, 60.0, 59.0, 60.0, 62.3, 64.0, 65.0, 67.0, 64.0, 62.0, 60.0, 61.8,
];
let t = 0.4;
let seed = 1;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const p of pitches) {
  const dur = 0.35 + rand() * 0.6;
  melody.push({
    startSec: +t.toFixed(3),
    endSec: +(t + dur).toFixed(3),
    midi: p,
    vibratoCents: 20 + rand() * 30,
  });
  t += dur + (rand() < 0.4 ? 0.15 + rand() * 0.2 : 0.02);
}
const duration = Math.max(30, t + 0.5);

function render(sr) {
  const n = Math.round(duration * sr);
  const out = new Float32Array(n);
  const formants = [
    [700, 110],
    [1220, 120],
    [2600, 160],
  ]; // "ah"
  const env = (f) =>
    formants.reduce((a, [fc, bw]) => a + 1 / (1 + ((f - fc) / bw) ** 2), 0.05) / (1 + f / 4000);
  for (const note of melody) {
    const s0 = Math.round(note.startSec * sr),
      s1 = Math.round(note.endSec * sr);
    let phase = 0;
    for (let i = s0; i < s1 && i < n; i++) {
      const tt = (i - s0) / sr,
        len = (s1 - s0) / sr;
      const scoop = -0.6 * Math.exp(-tt / 0.04); // short scoop up into the note
      const vibDepth = (Math.min(1, tt / 0.25) * note.vibratoCents) / 100;
      const midi = note.midi + scoop + vibDepth * Math.sin(2 * Math.PI * 5.5 * tt);
      const f0 = 440 * 2 ** ((midi - 69) / 12);
      phase += (2 * Math.PI * f0) / sr;
      let s = 0;
      for (let h = 1; h * f0 < Math.min(sr / 2 - 500, 8000); h++)
        s += (env(h * f0) * Math.sin(h * phase)) / Math.sqrt(h);
      const amp = Math.min(1, tt / 0.03) * Math.min(1, (len - tt) / 0.05);
      out[i] += 0.18 * amp * s + 0.004 * amp * (rand() * 2 - 1);
    }
  }
  return out;
}

fs.mkdirSync('fixtures', { recursive: true });
const hi = render(44100);
const right = hi.map((v, i) => 0.9 * v + 0.1 * (hi[i - 220] ?? 0)); // fake slight stereo difference
fs.writeFileSync('fixtures/synth-vocal-44k-stereo.wav', encodeWav([hi, right], 44100));
fs.writeFileSync('fixtures/synth-vocal-22k-mono.wav', encodeWav([render(22050)], 22050));
fs.writeFileSync(
  'fixtures/synth-vocal.truth.json',
  JSON.stringify({ duration, notes: melody }, null, 2),
);
console.log(`wrote ${melody.length} notes, ${duration.toFixed(1)} s`);
