import type { Project } from '../types'
import type { AnalysisRequest, AnalysisResult } from './analysis.worker'

export const MAX_DURATION_SECONDS = 10 * 60

let audioContext: AudioContext | null = null

export function getAudioContext(): AudioContext {
  audioContext ??= new AudioContext()
  return audioContext
}

async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const data = await file.arrayBuffer()
  try {
    return await getAudioContext().decodeAudioData(data)
  } catch {
    throw new Error(`Couldn't decode "${file.name}". Try a WAV, MP3, OGG or FLAC file.`)
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

function analyzeAudio(buffer: AudioBuffer): Promise<AnalysisResult> {
  const samples = mixToMono(buffer)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<AnalysisResult>) => {
      resolve(event.data)
      worker.terminate()
    }
    worker.onerror = (event) => {
      reject(new Error(event.message || 'Audio analysis failed.'))
      worker.terminate()
    }
    const request: AnalysisRequest = { samples, sampleRate: buffer.sampleRate }
    worker.postMessage(request, [samples.buffer])
  })
}

export async function loadAudioFile(file: File): Promise<Project> {
  const buffer = await decodeAudioFile(file)
  if (buffer.duration > MAX_DURATION_SECONDS) {
    throw new Error(`"${file.name}" is longer than ${MAX_DURATION_SECONDS / 60} minutes.`)
  }
  const { peaks, notes } = await analyzeAudio(buffer)
  return { fileName: file.name, buffer, peaks, notes }
}
