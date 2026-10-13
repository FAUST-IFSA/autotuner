import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch'
import type { NoteSegment } from '../types'
import { ShiftScheduler, type ShiftChange, type TimedChange, buildSchedule, shiftAt } from './schedule'

/** Drag preview block size: ~21 ms node latency instead of ~58 ms (Phase 0, spike 1). */
const PREVIEW_BLOCK_MS = 40
/** Audio before the dragged note that the preview loop includes. */
const PREVIEW_PRE_ROLL = 0.05
/** Fades on start/stop so playback never begins or ends on a click. */
const FADE_SECONDS = 0.012
/** How often the playback node reports back; each report drives the just-in-time scheduler. */
const TICK_SECONDS = 0.02

const VOICE = { formantCompensation: true, formantBaseHz: 0 } as const

/** A playback node and a preview node, each behind its own fade gain. */
interface Voices {
  player: StretchNode
  playerGain: GainNode
  previewer: StretchNode
  previewGain: GainNode
  outputLatency: number
}

/**
 * Idle node pairs per AudioContext. Signalsmith's worklet processor always reports itself active, so a
 * node is never garbage collected and keeps running even when disconnected. Creating nodes per
 * recording would leak a full copy of the audio and audio-thread CPU each time, so nodes are reused.
 */
const idleVoices = new WeakMap<BaseAudioContext, Voices[]>()

async function acquireVoices(ctx: AudioContext): Promise<Voices> {
  const reused = idleVoices.get(ctx)?.pop()
  if (reused) return reused
  // Always stereo: mono recordings are played on both channels by the node itself.
  const options = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }
  const [player, previewer] = await Promise.all([SignalsmithStretch(ctx, options), SignalsmithStretch(ctx, options)])
  await previewer.configure({ blockMs: PREVIEW_BLOCK_MS })
  const playerGain = new GainNode(ctx, { gain: 0 })
  const previewGain = new GainNode(ctx, { gain: 0 })
  player.connect(playerGain).connect(ctx.destination)
  previewer.connect(previewGain).connect(ctx.destination)
  // latency() is input + output latency; output latency is half (Phase 0, spike 2).
  const outputLatency = (await player.latency()) / 2
  return { player, playerGain, previewer, previewGain, outputLatency }
}

function releaseVoices(ctx: AudioContext, voices: Voices) {
  void voices.player.setUpdateInterval(TICK_SECONDS)
  const pool = idleVoices.get(ctx) ?? []
  idleVoices.set(ctx, pool)
  // Free the audio once the fade-out has finished, then make the pair available again.
  window.setTimeout(() => {
    void voices.player.dropBuffers()
    void voices.previewer.dropBuffers()
    pool.push(voices)
  }, 100)
}

function copyChannels(buffer: AudioBuffer, from = 0, to = buffer.duration): Float32Array[] {
  const a = Math.max(0, Math.floor(from * buffer.sampleRate))
  const b = Math.min(buffer.length, Math.ceil(to * buffer.sampleRate))
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(a, b))
}

/**
 * Plays the original recording through Signalsmith Stretch with each note's pitch shift applied, and
 * previews a single note while it is dragged. Everything runs in an AudioWorklet; nothing is rendered
 * ahead of time.
 */
export class AudioEngine {
  /** Fires when playback starts or stops (including reaching the end). */
  onPlayingChange: (playing: boolean) => void = () => {}

  private schedule: ShiftChange[] = [{ t: 0, semitones: 0 }]
  private scheduler: ShiftScheduler
  private playing = false
  /** Input position (seconds) where the current playback started, and the context time it is heard from. */
  private from = 0
  private startOutput = 0
  private position = 0
  private ticker: number | undefined
  private previewing = false
  private disposed = false
  private voices: Voices | null = null
  private readonly ctx: AudioContext
  private readonly buffer: AudioBuffer
  private readonly player: StretchNode
  private readonly playerGain: GainNode
  private readonly previewer: StretchNode
  private readonly previewGain: GainNode
  private readonly outputLatency: number

  private constructor(
    ctx: AudioContext,
    buffer: AudioBuffer,
    player: StretchNode,
    playerGain: GainNode,
    previewer: StretchNode,
    previewGain: GainNode,
    outputLatency: number,
  ) {
    this.ctx = ctx
    this.buffer = buffer
    this.player = player
    this.playerGain = playerGain
    this.previewer = previewer
    this.previewGain = previewGain
    this.outputLatency = outputLatency
    this.scheduler = new ShiftScheduler((change, outputTime) => {
      void player.schedule({ output: change.output, outputTime, semitones: change.semitones, active: change.active ?? true })
    }, outputLatency)
  }

  static async create(ctx: AudioContext, buffer: AudioBuffer): Promise<AudioEngine> {
    const voices = await acquireVoices(ctx)
    const channels = copyChannels(buffer)
    await voices.player.addBuffers(channels, channels.map((c) => c.buffer))
    const { player, playerGain, previewer, previewGain, outputLatency } = voices
    const engine = new AudioEngine(ctx, buffer, player, playerGain, previewer, previewGain, outputLatency)
    engine.voices = voices
    await player.setUpdateInterval(TICK_SECONDS, () => engine.tick())
    return engine
  }

  get isPlaying() {
    return this.playing
  }

  get duration() {
    return this.buffer.duration
  }

  /** The position being heard right now, in seconds of the original audio. */
  get currentTime(): number {
    if (!this.playing) return this.position
    const heard = this.ctx.currentTime - (this.ctx.outputLatency || 0) - this.ctx.baseLatency
    return Math.min(this.buffer.duration, Math.max(this.from, this.from + heard - this.startOutput))
  }

  /** Call whenever notes change; playback picks up the new shifts within ~60 ms. */
  setNotes(notes: NoteSegment[]) {
    this.schedule = buildSchedule(notes)
    if (!this.playing) return
    // Re-plan from the earliest moment the node can still change: now plus its output latency.
    const at = this.ctx.currentTime + this.outputLatency + 0.005
    const input = this.from + (at - this.startOutput)
    void this.player.schedule({ output: at, outputTime: at - 0.001, semitones: shiftAt(this.schedule, input) })
    this.scheduler.reset(this.timedChanges(), at)
    this.scheduler.tick(this.ctx.currentTime)
  }

  async play(from = this.position) {
    if (this.disposed) return
    await this.ctx.resume()
    if (this.playing) this.halt()
    this.from = from >= this.buffer.duration - 0.05 ? 0 : from
    // Schedule ahead by the node's output latency so it starts exactly at `from`.
    this.startOutput = this.ctx.currentTime + this.outputLatency + 0.02
    void this.player.schedule({
      active: true,
      input: this.from,
      output: this.startOutput,
      semitones: shiftAt(this.schedule, this.from),
      ...VOICE,
    })
    const gain = this.playerGain.gain
    // Keep any fade-out from halt() (seeking while playing); start the fade-in after it.
    gain.cancelScheduledValues(this.startOutput)
    gain.setValueAtTime(0, this.startOutput)
    gain.linearRampToValueAtTime(1, this.startOutput + FADE_SECONDS)
    this.scheduler.reset(this.timedChanges(), this.startOutput)
    this.scheduler.tick(this.ctx.currentTime)
    this.playing = true
    // Worklet time reports keep the scheduler fed; this timer covers the end of the file and hidden tabs.
    this.ticker = window.setInterval(() => this.tick(), 50)
    this.onPlayingChange(true)
  }

  pause() {
    if (!this.playing) return
    this.position = this.currentTime
    this.halt()
    this.onPlayingChange(false)
  }

  /** Jumps to `seconds`; keeps playing if playing. */
  seek(seconds: number) {
    const t = Math.min(this.buffer.duration, Math.max(0, seconds))
    if (this.playing) void this.play(t)
    else this.position = t
  }

  /** Starts looping one note at its current shift (call on drag start). */
  async startPreview(note: NoteSegment) {
    if (this.disposed || this.playing) return
    await this.ctx.resume()
    this.previewing = true
    const from = Math.max(0, note.start - PREVIEW_PRE_ROLL)
    const slice = copyChannels(this.buffer, from, note.end)
    await this.previewer.dropBuffers()
    await this.previewer.addBuffers(slice, slice.map((c) => c.buffer))
    if (!this.previewing) return
    const now = this.ctx.currentTime
    void this.previewer.schedule({
      active: true,
      input: 0,
      output: now,
      loopStart: 0,
      loopEnd: slice[0].length / this.buffer.sampleRate,
      semitones: note.midi - note.detectedMidi,
      ...VOICE,
    })
    const gain = this.previewGain.gain
    gain.cancelScheduledValues(0)
    gain.setValueAtTime(0, now)
    gain.linearRampToValueAtTime(1, now + FADE_SECONDS)
  }

  /** New shift for the note being previewed; heard within ~75 ms. */
  updatePreview(semitones: number) {
    if (this.previewing) void this.previewer.schedule({ semitones })
  }

  stopPreview() {
    if (!this.previewing) return
    this.previewing = false
    const now = this.ctx.currentTime
    const gain = this.previewGain.gain
    gain.cancelScheduledValues(0)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(0, now + FADE_SECONDS)
    void this.previewer.stop(now + FADE_SECONDS + 0.01)
  }

  /** Stops sound and hands the nodes back to the pool for the next recording. */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.halt()
    this.stopPreview()
    if (this.voices) releaseVoices(this.ctx, this.voices)
  }

  private halt() {
    window.clearInterval(this.ticker)
    this.playing = false
    const now = this.ctx.currentTime
    const gain = this.playerGain.gain
    gain.cancelScheduledValues(0)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(0, now + FADE_SECONDS)
    this.scheduler.reset([], now)
    void this.player.stop(now + FADE_SECONDS + 0.01)
  }

  /** Schedule changes after the playback start, on the context clock, plus a stop at the end. */
  private timedChanges(): TimedChange[] {
    const toOutput = (t: number) => this.startOutput + (t - this.from)
    const changes: TimedChange[] = this.schedule
      .filter((c) => c.t > this.from)
      .map((c) => ({ output: toOutput(c.t), semitones: c.semitones }))
    changes.push({ output: toOutput(this.buffer.duration), semitones: 0, active: false })
    return changes
  }

  private tick() {
    if (!this.playing) return
    this.scheduler.tick(this.ctx.currentTime)
    if (this.currentTime >= this.buffer.duration) {
      this.position = this.buffer.duration
      this.halt()
      this.onPlayingChange(false)
    }
  }
}
