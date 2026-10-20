import SignalsmithStretch from 'signalsmith-stretch'
import type { NoteSegment } from '../types'
import { VOICE } from './AudioEngine'
import { ShiftScheduler, buildSchedule } from './schedule'

/** Extra suspends (seconds apart) so long passages without edits still report progress. */
const PROGRESS_STEP = 1

export function channelsOf(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice())
}

/** Plain sample-rate conversion (used before an MP3 render of a >48 kHz recording). */
export function resample(buffer: AudioBuffer, sampleRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === sampleRate) return Promise.resolve(buffer)
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(buffer.duration * sampleRate), sampleRate)
  const source = new AudioBufferSourceNode(ctx, { buffer })
  source.connect(ctx.destination)
  source.start()
  return ctx.startRendering()
}

/**
 * Renders the whole recording with every note's shift applied, faster than real time, through the same
 * Signalsmith node and transpose schedule as playback, so the file sounds like what was heard.
 *
 * The node's `schedule()` holds only one future change (see ShiftScheduler), so the render is suspended
 * at each point where the next change can be queued, the change is posted, and rendering resumes.
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
  const node = await SignalsmithStretch(ctx, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [numberOfChannels],
  })
  node.connect(ctx.destination)
  const channels = channelsOf(buffer)
  await node.addBuffers(channels, channels.map((c) => c.buffer))
  const outputLatency = (await node.latency()) / 2

  const pending: Promise<unknown>[] = []
  const scheduler = new ShiftScheduler((change, outputTime) => {
    pending.push(node.schedule({ output: change.output, outputTime, semitones: change.semitones }))
  }, outputLatency)
  await node.schedule({ active: true, input: 0, output: 0, semitones: schedule[0].semitones, ...VOICE })
  scheduler.reset(
    schedule.slice(1).map((c) => ({ output: c.t, semitones: c.semitones })),
    0,
  )
  scheduler.tick(0)

  // Suspend wherever a change becomes postable (its predecessor's time minus the output latency), plus
  // every second for progress. Suspend times snap to 128-frame render quanta and must be unique.
  const quantum = 128 / sampleRate
  const end = length / sampleRate
  const times = new Set<number>()
  for (const c of schedule.slice(1)) times.add(Math.ceil((c.t - outputLatency) / quantum) * quantum)
  for (let t = PROGRESS_STEP; t < end; t += PROGRESS_STEP) times.add(Math.ceil(t / quantum) * quantum)
  for (const t of [...times].filter((t) => t > 0 && t < end).sort((a, b) => a - b)) {
    void ctx.suspend(t).then(async () => {
      scheduler.tick(ctx.currentTime)
      // The worklet must have the change before rendering continues.
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

