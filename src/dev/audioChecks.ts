// Dev-only acceptance checks for the audio engine (Phase 3). Not imported by the app, so never bundled.
// Run from the browser console on the dev server, after one real click on the page (audio needs a gesture):
//   const m = await import('/src/dev/audioChecks.ts')
//   await m.previewLatency()   // drag preview: time from a shift change to hearing it
//   await m.playbackCheck()    // playback: right pitch per note, no clicks at note boundaries
//   await m.loopCheck()        // a held note keeps looping until released
//   await m.retriggerCheck()   // moving a held note a semitone restarts it at the new pitch
//   await m.nudgeCheck()       // Up/Down plays the note once at its new pitch
import { AudioEngine } from '../audio/AudioEngine'
import { getAudioContext } from '../audio/decode'
import { buildSchedule } from '../audio/schedule'
import type { NoteSegment } from '../types'

const RECORDER = `registerProcessor('dev-recorder', class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage({ t: currentTime, d: ch.slice() }); return true }
})`
let recorderLoaded: Promise<void> | null = null
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Records whatever `source` outputs, on the context clock. */
async function record(ctx: AudioContext, source: AudioNode) {
  recorderLoaded ??= ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([RECORDER], { type: 'text/javascript' })))
  await recorderLoaded
  const node = new AudioWorkletNode(ctx, 'dev-recorder')
  const mute = new GainNode(ctx, { gain: 0 })
  source.connect(node).connect(mute).connect(ctx.destination)
  const blocks: { t: number; d: Float32Array }[] = []
  node.port.onmessage = (e) => blocks.push(e.data)
  return {
    stop() {
      source.disconnect(node)
      node.disconnect()
      mute.disconnect()
      const x = new Float32Array(blocks.length * 128)
      blocks.forEach((b, i) => x.set(b.d, i * 128))
      return { x, t0: blocks[0]?.t ?? 0, sampleRate: ctx.sampleRate }
    },
  }
}

/** Simplified McLeod pitch method on one window. */
function detectPitch(x: Float32Array, sr: number): number | null {
  const minLag = Math.floor(sr / 1100)
  const maxLag = Math.min(x.length - 1, Math.floor(sr / 70))
  const nsdf = new Float32Array(maxLag + 2)
  let best = 0
  for (let tau = minLag; tau <= maxLag; tau++) {
    let acf = 0
    let m = 0
    for (let i = 0; i < x.length - tau; i++) {
      acf += x[i] * x[i + tau]
      m += x[i] * x[i] + x[i + tau] * x[i + tau]
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0
    best = Math.max(best, nsdf[tau])
  }
  if (best < 0.6) return null
  for (let t = minLag + 1; t < maxLag; t++) {
    if (nsdf[t] >= 0.9 * best && nsdf[t] >= nsdf[t - 1] && nsdf[t] >= nsdf[t + 1]) return sr / t
  }
  return null
}

const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

/** Peak 2nd-difference energy (5 ms frames) within 40 ms of `t`, over the peak in the surrounding 300 ms. */
function clickRatio(x: Float32Array, sr: number, t: number) {
  const frame = Math.round(sr * 0.005)
  const energy = (s: number) => {
    let e = 0
    for (let i = s + 2; i < s + frame; i++) e += (x[i] - 2 * x[i - 1] + x[i - 2]) ** 2
    return e
  }
  const c = Math.round(t * sr)
  let near = 0
  let around = 0
  for (let s = c - 0.3 * sr; s < c + 0.3 * sr; s += frame) {
    if (s < 2 || s + frame >= x.length) continue
    const e = energy(Math.round(s))
    if (Math.abs(s - c) < 0.04 * sr) near = Math.max(near, e)
    else around = Math.max(around, e)
  }
  return near / (around || 1e-12)
}

async function loadFixture(ctx: AudioContext) {
  const buffer = await ctx.decodeAudioData(await (await fetch('/fixtures/synth-vocal-44k-stereo.wav')).arrayBuffer())
  const truth: { notes: { startSec: number; endSec: number; midi: number }[] } = await (
    await fetch('/fixtures/synth-vocal.truth.json')
  ).json()
  return { buffer, truth }
}

/**
 * Drag preview latency: loop a steady 440 Hz tone through the preview node, jump it an octave, and time
 * how long until the octave appears at the engine's output. Add the device's own output latency for
 * what you hear.
 */
export async function previewLatency(trials = 6) {
  const ctx = getAudioContext()
  await ctx.resume()
  const sr = ctx.sampleRate
  const tone = new AudioBuffer({ length: sr * 4, sampleRate: sr, numberOfChannels: 1 })
  tone.getChannelData(0).forEach((_, i, a) => (a[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr)))
  const engine = await AudioEngine.create(ctx, tone)
  const note: NoteSegment = { id: 'n', start: 0.2, end: 3.8, detectedMidi: 69, originalMidi: 69, midi: 69 }
  const rec = await record(ctx, (engine as unknown as { previewGain: GainNode }).previewGain)
  await engine.startPreview(note)
  await sleep(600)
  const sent: { t: number; up: boolean }[] = []
  for (let k = 0; k < trials; k++) {
    const up = k % 2 === 0
    sent.push({ t: ctx.currentTime, up })
    engine.updatePreview(up ? 12 : 0)
    await sleep(350)
  }
  engine.stopPreview()
  const { x, t0 } = rec.stop()
  engine.dispose()

  const win = Math.round(sr * 0.006)
  const hop = Math.round(sr * 0.0005)
  const ms = sent.map(({ t, up }) => {
    let run = 0
    for (let s = Math.round((t - t0) * sr); s + win < x.length; s += hop) {
      let zc = 0
      for (let i = s + 1; i < s + win; i++) if (x[i - 1] < 0 !== x[i] < 0) zc++
      const hz = (zc / 2) * (sr / win)
      run = (up ? hz > 660 : hz < 660) ? run + 1 : 0
      if (run >= 20) return +((s - 19 * hop + win / 2) / sr + t0 - t).toFixed(4) * 1000
    }
    return NaN
  })
  const median = [...ms].sort((a, b) => a - b)[ms.length >> 1]
  const device = (ctx.baseLatency + (ctx.outputLatency || 0)) * 1000
  return {
    engineMs: ms.map((v) => Math.round(v)),
    medianEngineMs: Math.round(median),
    deviceMs: Math.round(device),
    heardMs: Math.round(median + device),
  }
}

/**
 * Playback: plays the synthetic vocal with every other note moved (+2 / -3, snapped), records the engine
 * output, then checks each note's pitch and compares click energy at each shift change against the same
 * passage played unedited.
 */
export async function playbackCheck(seconds = 12) {
  const ctx = getAudioContext()
  await ctx.resume()
  const { buffer, truth } = await loadFixture(ctx)
  const sung: NoteSegment[] = truth.notes.map((n, i) => ({
    id: `n${i}`,
    start: n.startSec,
    end: n.endSec,
    detectedMidi: n.midi,
    originalMidi: Math.round(n.midi),
    midi: n.midi,
  }))
  const edited = sung.map((n, i) => ({ ...n, midi: Math.round(n.detectedMidi) + (i % 2 === 0 ? 2 : -3) }))

  const run = async (notes: NoteSegment[]) => {
    const engine = await AudioEngine.create(ctx, buffer)
    engine.setNotes(notes)
    const internals = engine as unknown as { playerGain: GainNode; startOutput: number; from: number }
    const rec = await record(ctx, internals.playerGain)
    await engine.play(0)
    await sleep(seconds * 1000 + 300)
    engine.pause()
    const out = rec.stop()
    engine.dispose()
    // Output sample index for an input time t.
    const at = (t: number) => (internals.startOutput + t - internals.from - out.t0) * out.sampleRate
    return { ...out, at }
  }
  const plain = await run(sung)
  const moved = await run(edited)

  const inRange = edited.filter((n) => n.end < seconds - 0.2)
  const cents = inRange.map((n) => {
    const mid = Math.round(moved.at((n.start + n.end) / 2))
    const hz = detectPitch(moved.x.subarray(mid - 1024, mid + 1024), moved.sampleRate)
    return hz === null ? NaN : Math.round((hzToMidi(hz) - n.midi) * 100)
  })
  const boundaries = buildSchedule(edited)
    .filter((c) => c.t > 0 && c.t < seconds - 0.4)
    .map((c) => c.t)
  const clickExcess = boundaries.map((t) => {
    const a = clickRatio(moved.x, moved.sampleRate, moved.at(t) / moved.sampleRate)
    const b = clickRatio(plain.x, plain.sampleRate, plain.at(t) / plain.sampleRate)
    return +(a / Math.max(b, 0.05)).toFixed(2)
  })
  return {
    notesChecked: inRange.length,
    notesWithin40Cents: cents.filter((c) => Math.abs(c) < 40).length,
    centsErrorPerNote: cents,
    boundaries: boundaries.length,
    /** Click energy at each shift change relative to the unedited passage; ~1 = no added click. */
    clickExcessMax: Math.max(...clickExcess),
    clickExcess,
  }
}

/** Dominant pitch (Hz) of the recording around `t` seconds. */
function pitchAround(rec: { x: Float32Array; t0: number; sampleRate: number }, contextTime: number) {
  const mid = Math.round((contextTime - rec.t0) * rec.sampleRate)
  return detectPitch(rec.x.subarray(Math.max(0, mid - 1024), mid + 1024), rec.sampleRate)
}

/** A 1 s "note": 440 Hz for its first 150 ms, then 330 Hz, so a restart is easy to hear in the output. */
function twoPartNote(ctx: AudioContext) {
  const sr = ctx.sampleRate
  const buffer = new AudioBuffer({ length: sr * 2, sampleRate: sr, numberOfChannels: 1 })
  const data = buffer.getChannelData(0)
  for (let i = Math.round(0.5 * sr); i < 1.5 * sr; i++) {
    const t = i / sr - 0.5
    data[i] = 0.5 * Math.sin(2 * Math.PI * (t < 0.15 ? 440 : 330) * t)
  }
  const note: NoteSegment = { id: 'n', start: 0.5, end: 1.5, detectedMidi: 64, originalMidi: 64, midi: 64 }
  return { buffer, note }
}

/**
 * Held note: moving it a semitone restarts it from its beginning at the new pitch; a fine (cent) move
 * just bends it. Expect ~466 Hz after the semitone move (the 440 Hz start, +1), ~331 Hz after the fine move.
 */
export async function retriggerCheck() {
  const ctx = getAudioContext()
  await ctx.resume()
  const { buffer, note } = twoPartNote(ctx)
  const engine = await AudioEngine.create(ctx, buffer)
  const rec = await record(ctx, (engine as unknown as { previewGain: GainNode }).previewGain)
  await engine.startPreview(note)
  await sleep(500) // well into the 330 Hz part
  const beforeMove = ctx.currentTime
  const fineAt = ctx.currentTime
  engine.updatePreview(0.05)
  await sleep(150)
  const afterFine = ctx.currentTime
  engine.updatePreview(1)
  const moveAt = ctx.currentTime
  await sleep(160)
  const afterMove = ctx.currentTime - 0.05
  engine.stopPreview()
  await sleep(100)
  const out = rec.stop()
  engine.dispose()
  const hz = (t: number) => Math.round(pitchAround(out, t) ?? 0)
  return {
    heldHz: hz(beforeMove - 0.05),
    afterFineMoveHz: hz(afterFine - 0.03),
    afterSemitoneMoveHz: hz(afterMove),
    expected: { held: 330, afterFineMove: 331, afterSemitoneMove: 466 },
    restartDelayMs: Math.round((afterMove - moveAt) * 1000),
    fineMoveAt: +fineAt.toFixed(2),
  }
}

/** Up/Down nudge with the song stopped: the note plays once from its start at the new pitch, then stops. */
export async function nudgeCheck() {
  const ctx = getAudioContext()
  await ctx.resume()
  const { buffer, note } = twoPartNote(ctx)
  const engine = await AudioEngine.create(ctx, buffer)
  const rec = await record(ctx, (engine as unknown as { previewGain: GainNode }).previewGain)
  const start = ctx.currentTime
  await engine.playNote({ ...note, midi: 65 })
  await sleep(1800)
  const out = rec.stop()
  engine.dispose()
  const hz = (t: number) => Math.round(pitchAround(out, t) ?? 0)
  const rms = (from: number, to: number) => {
    const a = Math.round((from - out.t0) * out.sampleRate)
    const b = Math.round((to - out.t0) * out.sampleRate)
    let sum = 0
    for (let i = a; i < b; i++) sum += out.x[i] ** 2
    return +Math.sqrt(sum / Math.max(1, b - a)).toFixed(3)
  }
  return {
    // The note starts 50 ms in (pre-roll), so its 440 Hz opening is at ~0.12-0.2 s, raised to ~466 Hz.
    openingHz: hz(start + 0.17),
    bodyHz: hz(start + 0.7),
    expected: { opening: 466, body: 350 },
    levelDuringNote: rms(start + 0.3, start + 0.9),
    levelAfterNote: rms(start + 1.25, start + 1.45),
  }
}

/** A held note keeps looping past its own length (1 s here) until released, then goes quiet. */
export async function loopCheck() {
  const ctx = getAudioContext()
  await ctx.resume()
  const { buffer, note } = twoPartNote(ctx)
  const engine = await AudioEngine.create(ctx, buffer)
  const analyser = new AnalyserNode(ctx, { fftSize: 2048 })
  ;(engine as unknown as { previewGain: GainNode }).previewGain.connect(analyser)
  const data = new Float32Array(2048)
  const level = () => {
    analyser.getFloatTimeDomainData(data)
    return +Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length).toFixed(3)
  }
  await engine.startPreview(note)
  const heldLevels: number[] = []
  for (let i = 0; i < 10; i++) {
    await sleep(250)
    heldLevels.push(level())
  }
  engine.stopPreview()
  await sleep(200)
  const releasedLevel = level()
  engine.dispose()
  // 250 ms steps across 2.5 s: the note (with 50 ms pre-roll) is ~1.05 s, so steps 5-10 are loop repeats.
  return { heldLevels, quietSteps: heldLevels.filter((l) => l < 0.01).length, releasedLevel }
}
