// MP3 encoding off the main thread. lamejs (LGPL) is only imported here, so it ships as its own,
// unmodified, replaceable chunk.
import { encodeMp3 } from './mp3'

export interface Mp3Request {
  channels: Float32Array[]
  sampleRate: number
}

export type Mp3Message =
  { type: 'progress'; fraction: number } | { type: 'done'; chunks: Uint8Array[] } | { type: 'error'; message: string }

const post = (message: Mp3Message, transfer: Transferable[] = []) => self.postMessage(message, { transfer })

self.onmessage = (event: MessageEvent<Mp3Request>) => {
  try {
    let last = 0
    const chunks = encodeMp3(event.data.channels, event.data.sampleRate, (fraction) => {
      if (fraction - last >= 0.02 || fraction === 1) {
        last = fraction
        post({ type: 'progress', fraction })
      }
    })
    post(
      { type: 'done', chunks },
      chunks.map((c) => c.buffer),
    )
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
