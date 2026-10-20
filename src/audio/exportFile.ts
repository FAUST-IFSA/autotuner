import type { Project } from '../types'
import { channelsOf, renderTuned, resample } from './export'
import { MP3_MAX_SAMPLE_RATE } from './mp3Limits'
import type { Mp3Message, Mp3Request } from './mp3.worker'
import { encodeWav } from './wav'

export type ExportFormat = 'wav' | 'mp3'

export interface ExportStatus {
  stage: 'render' | 'encode'
  fraction: number
}

/** "vocal.mp3" -> "vocal-tuned.wav" */
export const tunedFileName = (fileName: string, format: ExportFormat) =>
  `${fileName.replace(/\.[^.]+$/, '') || 'vocal'}-tuned.${format}`

function encodeMp3InWorker(channels: Float32Array[], sampleRate: number, onProgress: (f: number) => void) {
  return new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<Mp3Message>) => {
      const message = event.data
      if (message.type === 'progress') return onProgress(message.fraction)
      worker.terminate()
      if (message.type === 'done') resolve(new Blob(message.chunks as BlobPart[], { type: 'audio/mpeg' }))
      else reject(new Error(message.message))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'MP3 encoding failed.'))
    }
    const request: Mp3Request = { channels, sampleRate }
    worker.postMessage(
      request,
      channels.map((c) => c.buffer),
    )
  })
}

/** Renders the edited vocal at full quality and encodes it. */
export async function exportTuned(
  project: Project,
  format: ExportFormat,
  onStatus: (status: ExportStatus) => void = () => {},
): Promise<{ blob: Blob; fileName: string }> {
  const render = (fraction: number) => onStatus({ stage: 'render', fraction })
  let source = project.buffer
  // MP3 tops out at 48 kHz; WAV always keeps the original rate.
  if (format === 'mp3' && source.sampleRate > MP3_MAX_SAMPLE_RATE) source = await resample(source, MP3_MAX_SAMPLE_RATE)
  const rendered = await renderTuned(source, project.notes, render)
  const channels = channelsOf(rendered)
  const blob =
    format === 'wav'
      ? new Blob([encodeWav(channels, rendered.sampleRate)], { type: 'audio/wav' })
      : await encodeMp3InWorker(channels, rendered.sampleRate, (fraction) => onStatus({ stage: 'encode', fraction }))
  return { blob, fileName: tunedFileName(project.fileName, format) }
}

/** Hands a file to the browser's downloads. */
export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // Give the download a moment to start before releasing the data.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
