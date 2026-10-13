import SignalsmithStretch from 'signalsmith-stretch'
import type { NoteSegment } from '../types'
import { VOICE } from './AudioEngine'
import { scheduleFades } from './crossfade'
import { ShiftScheduler, buildSchedule, planVoices } from './schedule'

/** Extra suspends (seconds apart) so long passages without edits still report progress. */
const PROGRESS_STEP = 1

export function channelsOf(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice())
}

/** Plain sample-rate conversion (used before an MP3 render of a >48 kHz recording). */
export async function resample(buffer: AudioBuffer, sampleRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === sampleRate) return buffer
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * sampleRate), sampleRate)
  const source = new AudioBufferSourceNode(ctx, { buffer })
  source.connect(ctx.destination)
  source.start()
  return ctx.startRendering()
}

/**
 * Renders the whole recording with every note's shift applied, faster than real time, through the same
 * two-voice crossfaded setup as playback, so the file sounds like what was heard.
 *
 * Each voice's `schedule()` holds only one future change (see ShiftScheduler), so the render is
 * suspended wherever a voice's next change can be queued, the change is posted, and rendering resumes.
 * A recording with no edits is returned untouched.
 */
export async function renderTuned(
  buffer: AudioBuffer,
  notes: NoteSegment[],
  onProgress: (fraction: number) => void = () => {},
): Promise<AudioBuffer> {
  const schedule = buildSchedule(notes)
  if (schedule.length === 1 && schedule[0].semitones === 0) {
    onProgress(1)
    return buffer
  }

  const { sampleRate, numberOfChannels, length } = buffer
  const ctx = new OfflineAudioContext(numberOfChannels, length, sampleRate)
  const options = { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [numberOfChannels] }
  const nodes = await Promise.all([SignalsmithStretch(ctx, options), SignalsmithStretch(ctx, options)])
  const gains = nodes.map((node, v) => {
    const gain = new GainNode(ctx, { gain: v === 0 ? 1 : 0 })
    node.connect(gain).connect(ctx.destination)
    return gain
  }) as [GainNode, GainNode]
  for (const node of nodes) {
    const channels = channelsOf(buffer)
    await node.addBuffers(channels, channels.map((c) => c.buffer))
  }
  const outputLatency = (await nodes[0].latency()) / 2

  const plan = planVoices(schedule)
  scheduleFades([gains[0].gain, gains[1].gain], plan, (t) => t)
  const pending: Promise<unknown>[] = []
  const schedulers = nodes.map(
    (node) =>
      new ShiftScheduler((change, outputTime) => {
        pending.push(node.schedule({ output: change.output, outputTime, semitones: change.semitones }))
      }, outputLatency),
  )
  for (const v of [0, 1] as const) {
    await nodes[v].schedule({ active: true, input: 0, output: 0, semitones: plan.initial[v], ...VOICE })
    schedulers[v].reset(
      plan.changes[v].map((c) => ({ output: c.t, semitones: c.semitones })),
      0,
    )
    schedulers[v].tick(0)
  }

  // Suspend wherever a voice's change becomes postable (its predecessor's time minus the output
  // latency), plus every second for progress. Times snap to 128-frame render quanta and must be unique.
  const quantum = 128 / sampleRate
  const end = length / sampleRate
  const times = new Set<number>()
  for (const change of [...plan.changes[0], ...plan.changes[1]]) {
    times.add(Math.ceil((change.t - outputLatency) / quantum) * quantum)
  }
  for (let t = PROGRESS_STEP; t < end; t += PROGRESS_STEP) times.add(Math.ceil(t / quantum) * quantum)
  for (const t of [...times].filter((t) => t > 0 && t < end).sort((a, b) => a - b)) {
    void ctx.suspend(t).then(async () => {
      for (const scheduler of schedulers) scheduler.tick(ctx.currentTime)
      // The worklets must have the changes before rendering continues.
      await Promise.all(pending.splice(0))
      onProgress(ctx.currentTime / end)
      await ctx.resume()
    })
  }
  await Promise.all(pending.splice(0))
  const rendered = await ctx.startRendering()
  onProgress(1)
  return rendered
}
