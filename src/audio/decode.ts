import type { Project } from '../types'
import type { AnalysisMessage, AnalysisRequest, AnalysisResult } from './analysis.worker'
import { ANALYSIS_SAMPLE_RATE } from './f0'

export const MAX_DURATION_SECONDS = 10 * 60

let audioContext: AudioContext | null = null

export function getAudioContext(): AudioContext {
  audioContext ??= new AudioContext()
  return audioContext
}

export async function decodeAudioFile(file: Blob, name: string): Promise<AudioBuffer> {
  const data = await file.arrayBuffer()
  try {
    return await getAudioContext().decodeAudioData(data)
  } catch {
    throw new Error(`Couldn't decode "${name}". Try a WAV, MP3, OGG or FLAC file.`)
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c)
    for (let i = 0; i < channel.length; i++) mono[i] += channel[i] / buffer.numberOfChannels
  }
  return mono
}

/** Mono at 22,050 Hz for pitch analysis. The OfflineAudioContext handles downmix and resampling. */
async function resampleForAnalysis(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * ANALYSIS_SAMPLE_RATE)
  const ctx = new OfflineAudioContext(1, length, ANALYSIS_SAMPLE_RATE)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  return (await ctx.startRendering()).getChannelData(0)
}

async function analyzeAudio(buffer: AudioBuffer, onProgress: (fraction: number) => void): Promise<AnalysisResult> {
  const samples = mixToMono(buffer)
  const analysisSamples = await resampleForAnalysis(buffer)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<AnalysisMessage>) => {
      const message = event.data
      if (message.type === 'progress') return onProgress(message.fraction)
      if (message.type === 'done') resolve(message.result)
      else reject(new Error(`Pitch analysis failed: ${message.message}`))
      worker.terminate()
    }
    worker.onerror = (event) => {
      reject(new Error(event.message || 'Audio analysis failed.'))
      worker.terminate()
    }
    const request: AnalysisRequest = { samples, sampleRate: buffer.sampleRate, analysisSamples }
    worker.postMessage(request, [samples.buffer, analysisSamples.buffer])
  })
}

export async function loadAudioFile(file: File, onProgress: (fraction: number) => void = () => {}): Promise<Project> {
  const buffer = await decodeAudioFile(file, file.name)
  if (buffer.duration > MAX_DURATION_SECONDS) {
    throw new Error(`"${file.name}" is longer than ${MAX_DURATION_SECONDS / 60} minutes.`)
  }
  const { peaks, notes, f0, usedFallback } = await analyzeAudio(buffer, onProgress)
  if (notes.length === 0) {
    throw new Error(`We couldn't find any singing in "${file.name}". Try a recording with a clear solo vocal.`)
  }
  return {
    id: crypto.randomUUID(),
    file,
    fileName: file.name,
    buffer,
    peaks,
    notes,
    f0,
    approximateNotes: usedFallback,
  }
}
