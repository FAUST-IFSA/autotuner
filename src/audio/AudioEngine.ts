import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch'
import type { NoteSegment } from '../types'
import { copyChannels } from './channels'
import { shiftOf } from './music'
import { ShiftScheduler, type ShiftChange, type TimedChange, buildSchedule, shiftAt } from './schedule'
import { VOICE, outputLatencyOf } from './stretch'

/** Drag preview block size: ~21 ms node latency instead of ~58 ms (Phase 0, spike 1). */
const PREVIEW_BLOCK_MS = 40
/** Audio before the dragged note that the preview loop includes. */
const PREVIEW_PRE_ROLL = 0.05
/** Fades on start/stop so playback never begins or ends on a click. */
const FADE_SECONDS = 0.012
/** How often the playback node reports back; each report drives the just-in-time scheduler. */
const TICK_SECONDS = 0.02

/** What a playback listener hears about: playback starting or stopping (paused, or at the end), or a seek. */
export type PlaybackEvent = 'play' | 'pause' | 'end' | 'seek'

/** A playback node and a preview node, each behind its own fade gain. */
interface Voices {
  player: StretchNode
  playerGain: GainNode
  previewer: StretchNode
  previewGain: GainNode
  outputLatency: number
  previewOutputLatency: number
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
  const outputLatency = await outputLatencyOf(player)
  const previewOutputLatency = await outputLatencyOf(previewer)
  return { player, playerGain, previewer, previewGain, outputLatency, previewOutputLatency }
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

/**
 * Plays the original recording through Signalsmith Stretch with each note's pitch shift applied, and
 * previews a single note while it is dragged. Everything runs in an AudioWorklet; nothing is rendered
 * ahead of time.
 */
export class AudioEngine {
  private schedule: ShiftChange[] = [{ t: 0, semitones: 0 }]
  private scheduler: ShiftScheduler
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
  private readonly listeners = new Set<(event: PlaybackEvent) => void>()
  private voices: Voices | null = null
  private previewOutputLatency = 0.02
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
      void player.schedule({
        output: change.output,
        outputTime,
        semitones: change.semitones,
        active: change.active ?? true,
      })
    }, outputLatency)
  }

  static async create(ctx: AudioContext, buffer: AudioBuffer): Promise<AudioEngine> {
    const voices = await acquireVoices(ctx)
    const channels = copyChannels(buffer)
    await voices.player.addBuffers(
      channels,
      channels.map((c) => c.buffer),
    )
    const { player, playerGain, previewer, previewGain, outputLatency } = voices
    const engine = new AudioEngine(ctx, buffer, player, playerGain, previewer, previewGain, outputLatency)
    engine.voices = voices
    engine.previewOutputLatency = voices.previewOutputLatency ?? engine.previewOutputLatency
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

  /** Calls `listener` when playback starts or stops (including reaching the end) and on every seek. */
  subscribe(listener: (event: PlaybackEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
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
    this.resumeAfterPreview = false
    await this.ctx.resume()
    // Disposed while the context was resuming.
    if (this.disposed) return
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
    this.notify('play')
  }

  pause() {
    if (!this.playing) return
    this.position = this.currentTime
    this.halt()
    this.notify('pause')
  }

  /** Jumps to `seconds`; keeps playing if playing. */
  seek(seconds: number) {
    const t = Math.min(this.buffer.duration, Math.max(0, seconds))
    if (this.playing) void this.play(t)
    else this.position = t
    this.notify('seek')
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
    this.previewSemitones = shiftOf(note)
    await this.loadPreview(note, false)
  }

  /** Loads a note (plus pre-roll) into the preview node and starts it, looped or once. */
  private async loadPreview(note: NoteSegment, loop: boolean) {
    const token = ++this.previewToken
    window.clearTimeout(this.previewEndTimer)
    this.previewLoaded = false
    this.previewSemitones = shiftOf(note)
    await this.ctx.resume()
    const from = Math.max(0, note.start - PREVIEW_PRE_ROLL)
    const slice = copyChannels(this.buffer, from, note.end)
    // Measure before addBuffers: transferring the arrays to the worklet empties them.
    const length = slice[0].length / this.buffer.sampleRate
    await this.previewer.dropBuffers()
    await this.previewer.addBuffers(
      slice,
      slice.map((c) => c.buffer),
    )
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
      this.previewEndTimer = window.setTimeout(
        () => {
          if (token === this.previewToken && !this.previewing) this.fadeOutPreview(this.ctx.currentTime)
        },
        (length + this.previewOutputLatency) * 1000,
      )
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
    // Also cancel a one-shot note (playNote isn't a held preview): a load still in flight, or its end timer,
    // would otherwise touch the pooled nodes after they belong to the next engine.
    this.previewToken++
    window.clearTimeout(this.previewEndTimer)
    this.fadeOutPreview(this.ctx.currentTime)
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
      this.notify('end')
    }
  }

  private notify(event: PlaybackEvent) {
    for (const listener of this.listeners) listener(event)
  }
}
