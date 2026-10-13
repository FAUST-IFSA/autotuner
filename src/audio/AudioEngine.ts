import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch'
import type { NoteSegment } from '../types'
import { scheduleFades } from './crossfade'
import { CROSSFADE_SECONDS, ShiftScheduler, type ShiftChange, type VoicePlan, buildSchedule, planVoices } from './schedule'

/** Drag preview block size: ~21 ms node latency instead of ~58 ms (Phase 0, spike 1). */
const PREVIEW_BLOCK_MS = 40
/** Audio before the dragged note that the preview loop includes. */
const PREVIEW_PRE_ROLL = 0.05
/** Fades on start/stop so playback never begins or ends on a click. */
const FADE_SECONDS = 0.012
/** How often the playback node reports back; each report drives the just-in-time scheduler. */
const TICK_SECONDS = 0.02
/** After an edit during playback: time for the silent voice to settle on its new pitch before it's heard. */
const REPLAN_SETTLE_SECONDS = 0.04

/** Formant compensation keeps a shifted voice from sounding chipmunk-like or muffled. */
export const VOICE = { formantCompensation: true, formantBaseHz: 0 } as const

/**
 * Two playback nodes (crossfaded voices, see planVoices) behind per-voice gains and a shared output gain
 * for start/stop fades, plus the preview node behind its own gain.
 */
interface Voices {
  players: [StretchNode, StretchNode]
  voiceGains: [GainNode, GainNode]
  bus: GainNode
  previewer: StretchNode
  previewGain: GainNode
  outputLatency: number
  previewOutputLatency: number
}

/**
 * Idle node sets per AudioContext. Signalsmith's worklet processor always reports itself active, so a
 * node is never garbage collected and keeps running even when disconnected. Creating nodes per
 * recording would leak a full copy of the audio and audio-thread CPU each time, so nodes are reused.
 */
const idleVoices = new WeakMap<BaseAudioContext, Voices[]>()

async function acquireVoices(ctx: AudioContext): Promise<Voices> {
  const reused = idleVoices.get(ctx)?.pop()
  if (reused) return reused
  // Always stereo: mono recordings are played on both channels by the node itself.
  const options = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }
  const [a, b, previewer] = await Promise.all([
    SignalsmithStretch(ctx, options),
    SignalsmithStretch(ctx, options),
    SignalsmithStretch(ctx, options),
  ])
  await previewer.configure({ blockMs: PREVIEW_BLOCK_MS })
  const bus = new GainNode(ctx, { gain: 0 })
  bus.connect(ctx.destination)
  const voiceGains: [GainNode, GainNode] = [new GainNode(ctx, { gain: 1 }), new GainNode(ctx, { gain: 0 })]
  a.connect(voiceGains[0]).connect(bus)
  b.connect(voiceGains[1]).connect(bus)
  const previewGain = new GainNode(ctx, { gain: 0 })
  previewer.connect(previewGain).connect(ctx.destination)
  // latency() is input + output latency; output latency is half (Phase 0, spike 2).
  const outputLatency = (await a.latency()) / 2
  const previewOutputLatency = (await previewer.latency()) / 2
  return { players: [a, b], voiceGains, bus, previewer, previewGain, outputLatency, previewOutputLatency }
}

function releaseVoices(ctx: AudioContext, voices: Voices) {
  void voices.players[0].setUpdateInterval(TICK_SECONDS)
  const pool = idleVoices.get(ctx) ?? []
  idleVoices.set(ctx, pool)
  // Free the audio once the fade-out has finished, then make the set available again.
  window.setTimeout(() => {
    for (const player of voices.players) void player.dropBuffers()
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
  private readonly schedulers: [ShiftScheduler, ShiftScheduler]
  private playing = false
  /** Input position (seconds) where the current playback started, and the context time it is heard from. */
  private from = 0
  private startOutput = 0
  private position = 0
  private ticker: number | undefined
  private previewing = false
  private previewSemitones = 0
  /** Shift the held note last (re)started at; moving half a semitone from it restarts the note. */
  private previewStartSemitones = 0
  private previewLoaded = false
  private previewToken = 0
  private previewEndTimer: number | undefined
  private resumeAfterPreview = false
  private disposed = false
  private readonly ctx: AudioContext
  private readonly buffer: AudioBuffer
  private readonly voices: Voices
  private readonly players: [StretchNode, StretchNode]
  private readonly voiceGains: [GainNode, GainNode]
  private readonly bus: GainNode
  private readonly previewer: StretchNode
  private readonly previewGain: GainNode
  private readonly outputLatency: number
  private readonly previewOutputLatency: number

  private constructor(ctx: AudioContext, buffer: AudioBuffer, voices: Voices) {
    this.ctx = ctx
    this.buffer = buffer
    this.voices = voices
    this.players = voices.players
    this.voiceGains = voices.voiceGains
    this.bus = voices.bus
    this.previewer = voices.previewer
    this.previewGain = voices.previewGain
    this.outputLatency = voices.outputLatency
    this.previewOutputLatency = voices.previewOutputLatency ?? 0.02
    this.schedulers = this.players.map(
      (player) =>
        new ShiftScheduler((change, outputTime) => {
          void player.schedule({ output: change.output, outputTime, semitones: change.semitones })
        }, this.outputLatency),
    ) as [ShiftScheduler, ShiftScheduler]
  }

  static async create(ctx: AudioContext, buffer: AudioBuffer): Promise<AudioEngine> {
    const voices = await acquireVoices(ctx)
    for (const player of voices.players) {
      const channels = copyChannels(buffer)
      await player.addBuffers(channels, channels.map((c) => c.buffer))
    }
    const engine = new AudioEngine(ctx, buffer, voices)
    await voices.players[0].setUpdateInterval(TICK_SECONDS, () => engine.tick())
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

  /**
   * Call whenever notes change. During playback the silent voice takes the new pitch at once and the
   * sound crossfades over to it ~60 ms later (the node's minimum lead time), so edits never jump the
   * pitch of the voice being heard.
   */
  setNotes(notes: NoteSegment[]) {
    this.schedule = buildSchedule(notes)
    if (!this.playing) return
    const now = this.ctx.currentTime
    const switchAt = now + this.outputLatency + REPLAN_SETTLE_SECONDS + CROSSFADE_SECONDS / 2
    const plan = planVoices(this.schedule, this.inputAt(switchAt))
    // The voice heard now keeps its pitch until it has faded out; the other one takes over.
    const heard = this.voiceGains[0].gain.value >= this.voiceGains[1].gain.value ? 0 : 1
    const incoming = heard === 0 ? 1 : 0
    for (const gain of this.voiceGains) {
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
    }
    const changeAt = now + this.outputLatency + 0.005
    void this.players[incoming].schedule({ output: changeAt, semitones: plan.initial[0] })
    // Plan voice 0 (the segment at switchAt) is the incoming physical voice.
    this.applyPlan({ ...plan, fades: [{ t: this.inputAt(switchAt), to: 0 }, ...plan.fades] }, incoming, changeAt, {
      // The outgoing voice gets its first pitch for the new plan once it's silent. Its queue is
      // replanned from now, dropping any change the old plan had queued for when it would have faded.
      change: { t: this.inputAt(switchAt) + CROSSFADE_SECONDS / 2, semitones: plan.initial[1] },
      from: now,
    })
  }

  async play(from = this.position) {
    if (this.disposed) return
    this.resumeAfterPreview = false
    await this.ctx.resume()
    if (this.playing) this.halt()
    this.from = from >= this.buffer.duration - 0.05 ? 0 : from
    // Schedule ahead by the node's output latency so it starts exactly at `from`.
    this.startOutput = this.ctx.currentTime + this.outputLatency + 0.02
    const plan = planVoices(this.schedule, this.from)
    this.players.forEach((player, v) => {
      void player.schedule({ active: true, input: this.from, output: this.startOutput, semitones: plan.initial[v], ...VOICE })
      const gain = this.voiceGains[v].gain
      gain.cancelScheduledValues(this.startOutput)
      gain.setValueAtTime(v === 0 ? 1 : 0, this.startOutput)
    })
    this.applyPlan(plan, 0, this.startOutput)
    const gain = this.bus.gain
    // Keep any fade-out from halt() (seeking while playing); start the fade-in after it.
    gain.cancelScheduledValues(this.startOutput)
    gain.setValueAtTime(0, this.startOutput)
    gain.linearRampToValueAtTime(1, this.startOutput + FADE_SECONDS)
    this.playing = true
    // Worklet time reports keep the schedulers fed; this timer covers the end of the file and hidden tabs.
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

  /**
   * Plays one note on a loop from the moment it's grabbed until it's released. If the song is playing,
   * playback pauses for the preview and resumes from the same spot on release.
   */
  async startPreview(note: NoteSegment) {
    if (this.disposed) return
    if (this.playing) {
      this.pause()
      this.resumeAfterPreview = true
    }
    this.previewing = true
    await this.loadPreview(note, true)
  }

  /**
   * New shift for the held note. Each time it lands on a different pitch (half a semitone or more from
   * where it last started) the note restarts from its beginning, so every step is heard as the note.
   */
  updatePreview(semitones: number) {
    if (!this.previewing) return
    const moved = Math.abs(semitones - this.previewStartSemitones) >= 0.5
    this.previewSemitones = semitones
    if (moved && this.previewLoaded) this.restartPreview()
    else void this.previewer.schedule({ semitones })
  }

  /** Ends the preview, and resumes playback if the preview interrupted it. */
  stopPreview() {
    if (this.previewing) {
      this.previewing = false
      this.fadeOutPreview(this.ctx.currentTime)
    }
    if (this.resumeAfterPreview) {
      this.resumeAfterPreview = false
      void this.play(this.position)
    }
  }

  /**
   * Plays a note once, from its start, at its current pitch (after a keyboard nudge). Playback in
   * progress already reflects the change, so this only sounds when stopped; a newer call cuts off an
   * older one.
   */
  async playNote(note: NoteSegment) {
    if (this.disposed || this.playing || this.previewing) return
    this.previewSemitones = note.midi - note.detectedMidi
    await this.loadPreview(note, false)
  }

  /** Loads a note (plus pre-roll) into the preview node and starts it, looped or once. */
  private async loadPreview(note: NoteSegment, loop: boolean) {
    const token = ++this.previewToken
    window.clearTimeout(this.previewEndTimer)
    this.previewLoaded = false
    this.previewSemitones = note.midi - note.detectedMidi
    await this.ctx.resume()
    const from = Math.max(0, note.start - PREVIEW_PRE_ROLL)
    const slice = copyChannels(this.buffer, from, note.end)
    // Measure before addBuffers: transferring the arrays to the worklet empties them.
    const length = slice[0].length / this.buffer.sampleRate
    await this.previewer.dropBuffers()
    await this.previewer.addBuffers(slice, slice.map((c) => c.buffer))
    // A newer preview started, or the held note was released, while the audio loaded.
    if (token !== this.previewToken || (loop && !this.previewing)) return
    this.previewLoaded = true
    this.previewStartSemitones = this.previewSemitones
    const now = this.ctx.currentTime
    void this.previewer.schedule({
      active: true,
      input: 0,
      output: now,
      // Equal loop points disable looping.
      loopStart: 0,
      loopEnd: loop ? length : 0,
      // Any pitch the note was moved to while the audio was loading.
      semitones: this.previewSemitones,
      ...VOICE,
    })
    const gain = this.previewGain.gain
    gain.cancelScheduledValues(0)
    gain.setValueAtTime(0, now)
    gain.linearRampToValueAtTime(1, now + FADE_SECONDS)
    if (!loop) {
      this.previewEndTimer = window.setTimeout(() => {
        if (token === this.previewToken && !this.previewing) this.fadeOutPreview(this.ctx.currentTime)
      }, (length + this.previewOutputLatency) * 1000)
    }
  }

  /** Jumps the held note back to its start at the new pitch, behind a short fade so it doesn't click. */
  private restartPreview() {
    this.previewStartSemitones = this.previewSemitones
    const now = this.ctx.currentTime
    const at = now + this.previewOutputLatency + FADE_SECONDS
    const gain = this.previewGain.gain
    gain.cancelScheduledValues(0)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(0, at)
    gain.linearRampToValueAtTime(1, at + FADE_SECONDS)
    void this.previewer.schedule({ input: 0, output: at, outputTime: now, semitones: this.previewSemitones })
  }

  private fadeOutPreview(now: number) {
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
    this.resumeAfterPreview = false
    this.halt()
    this.stopPreview()
    releaseVoices(this.ctx, this.voices)
  }

  private halt() {
    window.clearInterval(this.ticker)
    this.playing = false
    const now = this.ctx.currentTime
    const gain = this.bus.gain
    gain.cancelScheduledValues(0)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(0, now + FADE_SECONDS)
    for (const v of [0, 1] as const) {
      this.schedulers[v].reset([], now)
      this.voiceGains[v].gain.cancelScheduledValues(now + FADE_SECONDS)
      void this.players[v].stop(now + FADE_SECONDS + 0.01)
    }
  }

  /** Position in the original audio that is heard at context time `t` (playback runs at rate 1). */
  private inputAt(t: number) {
    return this.from + (t - this.startOutput)
  }

  /**
   * Hands a voice plan to the two voices: plan voice 0 plays on physical voice `first`. Pitch changes go
   * to each voice's just-in-time scheduler and crossfades onto the voice gains, from `at` on.
   */
  private applyPlan(plan: VoicePlan, first: 0 | 1, at: number, outgoing?: { change: ShiftChange; from: number }) {
    const toOutput = (t: number) => this.startOutput + (t - this.from)
    const physical = (pv: 0 | 1) => (pv === 0 ? first : first === 0 ? 1 : 0) as 0 | 1
    scheduleFades(
      [this.voiceGains[physical(0)].gain, this.voiceGains[physical(1)].gain],
      plan,
      toOutput,
      at - CROSSFADE_SECONDS,
    )
    for (const pv of [0, 1] as const) {
      const changes = [...(pv === 1 && outgoing ? [outgoing.change] : []), ...plan.changes[pv]]
      const scheduler = this.schedulers[physical(pv)]
      scheduler.reset(
        changes.map((c) => ({ output: toOutput(c.t), semitones: c.semitones })),
        pv === 1 && outgoing ? outgoing.from : at,
      )
      scheduler.tick(this.ctx.currentTime)
    }
  }

  private tick() {
    if (!this.playing) return
    for (const scheduler of this.schedulers) scheduler.tick(this.ctx.currentTime)
    if (this.currentTime >= this.buffer.duration) {
      this.position = this.buffer.duration
      this.halt()
      this.onPlayingChange(false)
    }
  }
}
