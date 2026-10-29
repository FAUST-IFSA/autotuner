// Phase 0 spikes 1 and 2: Signalsmith Stretch live transpose + offline render.
// Results are logged to the page and stored on window.spikeResults for automation.
import SignalsmithStretch from 'signalsmith-stretch';

type StretchNode = AudioWorkletNode & {
  addBuffers(buffers: Float32Array[]): Promise<number>;
  schedule(obj: Record<string, number | boolean>): Promise<unknown>;
  start(when?: number): Promise<unknown>;
  stop(when?: number): Promise<unknown>;
  configure(cfg: Record<string, unknown>): Promise<unknown>;
  latency(): Promise<number>;
  inputTime: number;
};
const createStretch = SignalsmithStretch as unknown as (
  ctx: BaseAudioContext,
  opts?: AudioWorkletNodeOptions,
) => Promise<StretchNode>;

const results: Record<string, unknown> = {};
(window as unknown as { spikeResults: unknown }).spikeResults = results;
Object.assign(window, {
  createStretch,
  sine: (...a: [number, number, number]) => sine(...a),
  pitchAt: (...a: [Float32Array, number, number]) => pitchAt(...a),
});
const logEl = document.getElementById('log')!;
function log(...parts: unknown[]) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  logEl.textContent += line + '\n';
  console.log(line);
}
const $ = (id: string) => document.getElementById(id)!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- helpers ----------

function sine(sr: number, sec: number, hz: number, amp = 0.5): Float32Array {
  const a = new Float32Array(Math.round(sr * sec));
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return a;
}

/** Simplified McLeod pitch method on one window. Returns Hz or null. */
function detectPitch(x: Float32Array, sr: number, minHz = 70, maxHz = 1100): number | null {
  const n = x.length;
  const maxLag = Math.min(n - 1, Math.floor(sr / minHz));
  const minLag = Math.floor(sr / maxHz);
  const nsdf = new Float32Array(maxLag + 1);
  for (let tau = minLag; tau <= maxLag; tau++) {
    let acf = 0,
      m = 0;
    for (let i = 0; i < n - tau; i++) {
      acf += x[i]! * x[i + tau]!;
      m += x[i]! * x[i]! + x[i + tau]! * x[i + tau]!;
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }
  let best = 0;
  for (let t = minLag; t <= maxLag; t++) best = Math.max(best, nsdf[t]!);
  if (best < 0.6) return null;
  for (let t = minLag + 1; t < maxLag; t++) {
    if (nsdf[t]! >= 0.9 * best && nsdf[t]! >= nsdf[t - 1]! && nsdf[t]! >= nsdf[t + 1]!) {
      const a = nsdf[t - 1]!,
        b = nsdf[t]!,
        c = nsdf[t + 1]!;
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
      return sr / (t + shift);
    }
  }
  return null;
}

function mono(buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i]! += d[i]! / buf.numberOfChannels;
  }
  return out;
}

function pitchAt(x: Float32Array, sr: number, t: number, win = 2048) {
  const s = Math.max(0, Math.round(t * sr - win / 2));
  return detectPitch(x.subarray(s, s + win), sr);
}

/** Zero-crossing frequency over a short window; good enough to find a sine's octave jump. */
function zcHz(x: Float32Array, sr: number, start: number, len: number): number {
  let zc = 0;
  for (let i = start + 1; i < start + len && i < x.length; i++)
    if (x[i - 1]! < 0 !== x[i]! < 0) zc++;
  return (zc / 2) * (sr / len);
}

/** First time (s) at or after `from` where a 440->880 sine has crossed 660 Hz for 10 ms. */
function findOctaveJump(x: Float32Array, sr: number, from: number, up = true): number | null {
  const win = Math.round(sr * 0.006),
    hop = Math.round(sr * 0.0005),
    need = Math.round(0.01 / 0.0005);
  let run = 0;
  for (let s = Math.round(from * sr); s + win < x.length; s += hop) {
    const f = zcHz(x, sr, s, win);
    run = (up ? f > 660 : f < 660) ? run + 1 : 0;
    if (run >= need) return (s - (need - 1) * hop + win / 2) / sr;
  }
  return null;
}

/** Peak of 2nd-difference energy (5 ms frames) near t, relative to the max in the surrounding 300 ms. */
function clickRatio(x: Float32Array, sr: number, t: number): number {
  const frame = Math.round(sr * 0.005);
  const energy = (s: number) => {
    let e = 0;
    for (let i = s + 2; i < s + frame; i++) e += (x[i]! - 2 * x[i - 1]! + x[i - 2]!) ** 2;
    return e;
  };
  const c = Math.round(t * sr);
  let near = 0,
    around = 0;
  for (let s = c - 0.3 * sr; s < c + 0.3 * sr; s += frame) {
    const e = energy(Math.round(s));
    if (Math.abs(s - c) < 0.04 * sr) near = Math.max(near, e);
    else around = Math.max(around, e);
  }
  return near / (around || 1e-12);
}

let fixtureCache: AudioBuffer | null = null;
async function loadFixture(ctx: BaseAudioContext): Promise<AudioBuffer> {
  if (fixtureCache) return fixtureCache;
  const res = await fetch('/synth-vocal-44k-stereo.wav');
  fixtureCache = await ctx.decodeAudioData(await res.arrayBuffer());
  return fixtureCache;
}

function channels(buf: AudioBuffer): Float32Array[] {
  return Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice());
}

function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels,
    n = buf.length;
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  dv.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, ch, true);
  dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * ch * 2, true);
  dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, n * ch * 2, true);
  const data = channels(buf);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      dv.setInt16(o, Math.max(-1, Math.min(1, data[c]![i]!)) * 32767, true);
      o += 2;
    }
  return new Blob([dv.buffer], { type: 'audio/wav' });
}

// ---------- spike 1: live ----------

let liveCtx: AudioContext | null = null;
let liveNode: StretchNode | null = null;

async function ensureLiveCtx() {
  liveCtx ??= new AudioContext({ latencyHint: 'interactive' });
  await liveCtx.resume();
  return liveCtx;
}

$('live-start').onclick = async () => {
  const ctx = await ensureLiveCtx();
  const buf = await loadFixture(ctx);
  liveNode?.disconnect();
  liveNode = await createStretch(ctx);
  liveNode.connect(ctx.destination);
  await liveNode.addBuffers(channels(buf));
  await liveNode.schedule({ formantCompensation: true, formantBaseHz: 0 });
  await liveNode.start();
  await liveNode.schedule({ loopStart: 0, loopEnd: buf.duration });
  log(
    `live: playing, ctx baseLatency ${(ctx.baseLatency * 1000).toFixed(1)} ms, outputLatency ${((ctx.outputLatency || 0) * 1000).toFixed(1)} ms, node latency ${((await liveNode.latency()) * 1000).toFixed(1)} ms`,
  );
};
$('live-stop').onclick = async () => {
  await liveNode?.stop();
};

let pendingSemis: number | null = null;
$('semis').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  $('semis-v').textContent = v.toFixed(2);
  if (pendingSemis === null) {
    requestAnimationFrame(() => {
      if (liveNode && pendingSemis !== null) void liveNode.schedule({ semitones: pendingSemis });
      pendingSemis = null;
    });
  }
  pendingSemis = v;
});

const RECORDER_SRC = `registerProcessor('spike-recorder', class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage({ t: currentTime, d: ch.slice() }); return true; }
});`;

let recorderLoaded: Promise<void> | null = null;
async function measureLiveLatency(label: string, config: Record<string, unknown> | null) {
  const ctx = await ensureLiveCtx();
  recorderLoaded ??= ctx.audioWorklet.addModule(
    URL.createObjectURL(new Blob([RECORDER_SRC], { type: 'text/javascript' })),
  );
  await recorderLoaded;
  const node = await createStretch(ctx, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  if (config) await node.configure(config);
  const rec = new AudioWorkletNode(ctx, 'spike-recorder');
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(rec).connect(mute).connect(ctx.destination);
  const blocks: { t: number; d: Float32Array }[] = [];
  rec.port.onmessage = (e) => blocks.push(e.data);
  await node.addBuffers([sine(ctx.sampleRate, 4, 440)]);
  await node.start();
  await sleep(1000);
  const trials: { nodeMs: number; msgMs: number }[] = [];
  let semis = 12;
  for (let k = 0; k < 6; k++) {
    const tSent = ctx.currentTime;
    const p0 = performance.now();
    await node.schedule({ semitones: semis });
    const msgMs = (performance.now() - p0) / 2;
    await sleep(350);
    trials.push({ nodeMs: NaN, msgMs });
    (trials[k] as unknown as { tSent: number; up: boolean }).tSent = tSent;
    (trials[k] as unknown as { up: boolean }).up = semis === 12;
    semis = semis === 12 ? 0 : 12;
  }
  await node.stop();
  await sleep(100);
  node.disconnect();
  rec.disconnect();
  // Stitch recording into one timeline (context time).
  const sr = ctx.sampleRate;
  const t0 = blocks[0]!.t;
  const x = new Float32Array(blocks.length * 128);
  blocks.forEach((b, i) => x.set(b.d, i * 128));
  for (const tr of trials as unknown as { tSent: number; up: boolean; nodeMs: number }[]) {
    const jump = findOctaveJump(x, sr, tr.tSent - t0 - 0.05, tr.up);
    tr.nodeMs = jump === null ? NaN : (jump + t0 - tr.tSent) * 1000;
  }
  const lat = (await node.latency()) * 1000;
  const hw = (ctx.baseLatency + (ctx.outputLatency || 0)) * 1000;
  const nodeMs = trials.map((t) => t.nodeMs);
  const med = [...nodeMs].sort((a, b) => a - b)[nodeMs.length >> 1]!;
  const r = {
    label,
    nodeReportedLatencyMs: lat,
    measuredNodeMs: nodeMs.map((v) => +v.toFixed(1)),
    medianNodeMs: +med.toFixed(1),
    ctxBaseLatencyMs: +(ctx.baseLatency * 1000).toFixed(1),
    ctxOutputLatencyMs: +((ctx.outputLatency || 0) * 1000).toFixed(1),
    messageOneWayMs: +(trials.reduce((a, t) => a + t.msgMs, 0) / trials.length).toFixed(2),
    estPerceivedMs: +(med + hw + 16).toFixed(1),
  };
  results[`live:${label}`] = r;
  log(`live latency [${label}]`, r);
}
$('live-measure').onclick = () => measureLiveLatency('default', null);
$('live-measure-cheap').onclick = () => measureLiveLatency('cheaper', { preset: 'cheaper' });
$('live-measure-small').onclick = () => measureLiveLatency('blockMs60', { blockMs: 60 });

// ---------- spike 2: offline ----------

let lastRender: AudioBuffer | null = null;

type Change = { t: number; semitones: number };

/**
 * The library's schedule() keeps only [segment active at `outputTime`, newer segments], so a whole
 * timeline can't be queued up front. Instead: queue change k only once change k-1 is active, with
 * outputTime just after change k-1. Offline, that means suspending the render at each boundary.
 * `lead` = how far before a boundary (in output time) the previous change becomes active.
 */
async function renderWithChanges(
  ctx: OfflineAudioContext,
  node: StretchNode,
  changes: Change[],
  lead: number,
  base: Record<string, number | boolean> = {},
) {
  const q = 128 / ctx.sampleRate;
  await node.schedule({ active: true, input: 0, output: 0, semitones: 0, ...base });
  let prevT = 0,
    lastSuspend = -1,
    skipped = 0;
  for (let k = 0; k < changes.length; k++) {
    const c = changes[k]!,
      afterT = prevT;
    const post = () =>
      node.schedule({ output: c.t, outputTime: afterT + 1e-6, semitones: c.semitones });
    if (k === 0) await post();
    else {
      let at = Math.ceil(Math.max(0, afterT - lead) / q) * q;
      if (at <= lastSuspend) at = lastSuspend + q;
      if (at >= ctx.length / ctx.sampleRate) {
        skipped++;
        continue;
      }
      lastSuspend = at;
      void ctx.suspend(at).then(async () => {
        await post();
        await ctx.resume();
      });
    }
    prevT = c.t;
  }
  const t0 = performance.now();
  const out = await ctx.startRendering();
  return { out, ms: performance.now() - t0, skipped };
}

async function offlineSineTest(label: string, lead: number, ramp: boolean) {
  const sr = 44100,
    dur = 4;
  const ctx = new OfflineAudioContext(1, sr * dur, sr);
  const node = await createStretch(ctx, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  node.connect(ctx.destination);
  await node.addBuffers([sine(sr, dur, 440)]);
  const steps = [
    { t: 1, semitones: 12 },
    { t: 2, semitones: 0 },
    { t: 3, semitones: 7 },
  ];
  const changes: Change[] = [];
  let prev = 0;
  for (const s of steps) {
    if (ramp) {
      // 15 ms stepped ramp centred on the boundary.
      const n = 5;
      for (let i = 1; i <= n; i++)
        changes.push({
          t: s.t - 0.0075 + (0.015 * (i - 1)) / (n - 1),
          semitones: prev + ((s.semitones - prev) * i) / n,
        });
    } else changes.push(s);
    prev = s.semitones;
  }
  const { out } = await renderWithChanges(ctx, node, changes, lead);
  const x = out.getChannelData(0);
  const hz = [0.5, 1.5, 2.5, 3.5].map((t) => +(pitchAt(x, sr, t) ?? 0).toFixed(1));
  const jumpUp = findOctaveJump(x, sr, 0.8, true);
  const jumpDown = findOctaveJump(x, sr, 1.8, false);
  return {
    label,
    lead,
    ramp,
    pitchHzAt_0_5_1_5_2_5_3_5: hz,
    expectedHz: [440, 880, 440, 659.3],
    changeErrorMs: {
      up: jumpUp === null ? null : +((jumpUp - 1) * 1000).toFixed(1),
      down: jumpDown === null ? null : +((jumpDown - 2) * 1000).toFixed(1),
    },
    clickRatioAtChanges: [1, 2, 3].map((t) => +clickRatio(x, sr, t).toFixed(2)),
  };
}

/** Rapid alternation: 40 ms segments, to check short notes land on time. */
async function offlineShortSegments(lead: number) {
  const sr = 44100,
    dur = 2;
  const ctx = new OfflineAudioContext(1, sr * dur, sr);
  const node = await createStretch(ctx, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  node.connect(ctx.destination);
  await node.addBuffers([sine(sr, dur, 440)]);
  const changes: Change[] = [];
  for (let i = 0; i < 10; i++)
    changes.push({ t: 0.5 + i * 0.08, semitones: 12 }, { t: 0.54 + i * 0.08, semitones: 0 });
  const { out } = await renderWithChanges(ctx, node, changes, lead);
  const x = out.getChannelData(0);
  const errs: number[] = [];
  for (let i = 0; i < 10; i++) {
    const j = findOctaveJump(x, sr, 0.5 + i * 0.08 - 0.03, true);
    errs.push(j === null ? NaN : +((j - (0.5 + i * 0.08)) * 1000).toFixed(1));
  }
  return { lead, upChangeErrorMs: errs };
}

async function offlineVocalTest(lead: number) {
  const probe = new OfflineAudioContext(1, 1, 44100);
  const buf = await loadFixture(probe);
  const truth: { notes: { startSec: number; endSec: number; midi: number }[] } = await (
    await fetch('/synth-vocal.truth.json')
  ).json();
  const ctx = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
  const node = await createStretch(ctx, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [buf.numberOfChannels],
  });
  node.connect(ctx.destination);
  await node.addBuffers(channels(buf));
  // Shift every other note: +2, -3, +2, -3 ..., snapped to the semitone. 0 between notes.
  const shifts = truth.notes.map((n, i) => (i % 2 === 0 ? 2 : -3) + (Math.round(n.midi) - n.midi));
  const changes: Change[] = [];
  truth.notes.forEach((n, i) => {
    changes.push({ t: n.startSec - 0.01, semitones: shifts[i]! });
    const next = truth.notes[i + 1];
    if (!next || next.startSec - n.endSec > 0.03)
      changes.push({ t: n.endSec + 0.01, semitones: 0 });
  });
  const { out, ms, skipped } = await renderWithChanges(ctx, node, changes, lead, {
    formantCompensation: true,
    formantBaseHz: 0,
  });
  lastRender = out;
  const x = mono(out);
  let correct = 0;
  const errs: number[] = [];
  truth.notes.forEach((n, i) => {
    const hz = pitchAt(x, out.sampleRate, (n.startSec + n.endSec) / 2, 2048);
    if (hz === null) {
      errs.push(NaN);
      return;
    }
    const cents = (69 + 12 * Math.log2(hz / 440) - (n.midi + shifts[i]!)) * 100;
    errs.push(Math.round(cents));
    if (Math.abs(cents) < 40) correct++;
  });
  return {
    lead,
    changes: changes.length,
    skipped,
    durationSec: +buf.duration.toFixed(2),
    renderMs: Math.round(ms),
    speedX: +(buf.duration / (ms / 1000)).toFixed(1),
    notesWithExpectedPitch: `${correct}/${truth.notes.length}`,
    centsErrorPerNote: errs,
    maxAbsSample: +x.reduce((m, v) => Math.max(m, Math.abs(v)), 0).toFixed(3),
  };
}

$('offline-run').onclick = async () => {
  log('offline: running...');
  try {
    const probeCtx = new OfflineAudioContext(1, 128, 44100);
    const probe = await createStretch(probeCtx);
    const lat = await probe.latency();
    results['offline:latencySec'] = lat;
    log(`node.latency() = ${(lat * 1000).toFixed(1)} ms (input + output)`);
    for (const [label, lead] of [
      ['lead0', 0],
      ['leadHalf', lat / 2],
      ['leadFull', lat],
    ] as const) {
      const r = await offlineSineTest(label, lead, false);
      results[`offline:sine:${label}`] = r;
      log('offline sine', r);
      const s = await offlineShortSegments(lead);
      results[`offline:short:${label}`] = s;
      log('offline 40 ms segments', s);
    }
    const rr = await offlineSineTest('ramp', lat / 2, true);
    results['offline:sine:ramp'] = rr;
    log('offline sine with 15 ms stepped ramp', rr);
    const v = await offlineVocalTest(lat / 2);
    results['offline:vocal'] = v;
    log('offline vocal', v);
  } catch (e) {
    results['offline:error'] = String(e);
    log('offline ERROR', String(e), (e as Error).stack ?? '');
  }
  results['offline:done'] = true;
};

$('offline-play').onclick = async () => {
  if (!lastRender) return;
  const ctx = await ensureLiveCtx();
  const src = ctx.createBufferSource();
  src.buffer = lastRender;
  src.connect(ctx.destination);
  src.start();
};
$('offline-download').onclick = () => {
  if (!lastRender) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(encodeWav(lastRender));
  a.download = 'offline-render.wav';
  a.click();
};
Object.assign(window, { measureLiveLatency });
