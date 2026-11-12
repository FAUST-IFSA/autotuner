const FADE_SECONDS = 0.012

/**
 * Plays the original vocal and the backing track together while they're lined up: plain buffer sources, no
 * tuning. Positions are song time (seconds into the backing track); the vocal starts at `offset`.
 */
export class LineUpPlayer {
  private sources: AudioBufferSourceNode[] = []
  private fade: GainNode | null = null
  /** Bumped by every play and stop, so a play still waiting for the context to resume can tell it's stale. */
  private token = 0
  /** Song time playback started from, and the context time it's heard. */
  private from = 0
  private startOutput = 0
  private readonly ctx: AudioContext
  private readonly vocal: AudioBuffer
  private readonly backing: AudioBuffer
  private readonly backingGain: number

  constructor(ctx: AudioContext, vocal: AudioBuffer, backing: AudioBuffer, backingGain: number) {
    this.ctx = ctx
    this.vocal = vocal
    this.backing = backing
    this.backingGain = backingGain
  }

  get isPlaying() {
    return this.fade !== null
  }

  /** The song time being heard. */
  get position() {
    const heard = this.ctx.currentTime - (this.ctx.outputLatency || 0) - this.ctx.baseLatency
    return this.from + Math.max(0, heard - this.startOutput)
  }

  async play(from: number, offset: number) {
    this.stop()
    const token = ++this.token
    await this.ctx.resume()
    if (token !== this.token) return
    const fade = new GainNode(this.ctx, { gain: 0 })
    fade.connect(this.ctx.destination)
    const at = this.ctx.currentTime + 0.03
    fade.gain.setValueAtTime(0, at)
    fade.gain.linearRampToValueAtTime(1, at + FADE_SECONDS)
    this.fade = fade
    this.from = from
    this.startOutput = at
    this.start(this.backing, from, at, this.backingGain)
    this.start(this.vocal, from - offset, at, 1)
  }

  stop() {
    this.token++
    const fade = this.fade
    if (!fade) return
    this.fade = null
    const now = this.ctx.currentTime
    fade.gain.cancelScheduledValues(0)
    fade.gain.setValueAtTime(fade.gain.value, now)
    fade.gain.linearRampToValueAtTime(0, now + FADE_SECONDS)
    for (const source of this.sources) source.stop(now + FADE_SECONDS + 0.01)
    this.sources = []
    window.setTimeout(() => fade.disconnect(), 100)
  }

  /** Plays `buffer` from its own time `time` at context time `at` (later, if `time` is before its start). */
  private start(buffer: AudioBuffer, time: number, at: number, gain: number) {
    if (time >= buffer.duration) return
    const source = new AudioBufferSourceNode(this.ctx, { buffer })
    source.connect(new GainNode(this.ctx, { gain })).connect(this.fade!)
    source.start(at + Math.max(0, -time), Math.max(0, time))
    this.sources.push(source)
  }
}
