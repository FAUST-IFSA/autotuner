// signalsmith-stretch ships no types. Shapes taken from its README and 1.3.2 source.
declare module 'signalsmith-stretch' {
  export interface StretchSchedule {
    output?: number
    /** "Now" for this call: queued segments at or after it are dropped (see ShiftScheduler). */
    outputTime?: number
    active?: boolean
    input?: number
    rate?: number
    semitones?: number
    tonalityHz?: number
    formantSemitones?: number
    formantCompensation?: boolean
    formantBaseHz?: number
    loopStart?: number
    loopEnd?: number
  }

  export interface StretchNode extends AudioWorkletNode {
    inputTime: number
    schedule(change: StretchSchedule): Promise<unknown>
    start(when?: number): Promise<unknown>
    stop(when?: number): Promise<unknown>
    addBuffers(channels: Float32Array[], transfer?: Transferable[]): Promise<number>
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>
    configure(config: { blockMs?: number; intervalMs?: number; splitComputation?: boolean; preset?: string }): Promise<unknown>
    latency(): Promise<number>
    setUpdateInterval(seconds: number, callback?: (inputTime: number) => void): Promise<unknown>
  }

  export default function SignalsmithStretch(
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ): Promise<StretchNode>
}
