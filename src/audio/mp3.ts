import { Mp3Encoder } from '@breezystack/lamejs'
import { MP3_KBPS } from './mp3Limits'

export { MP3_KBPS } from './mp3Limits'
/** Samples per encode call: a multiple of the 1152-sample MP3 frame. */
const CHUNK = 1152 * 20

const toInt16 = (x: Float32Array) => Int16Array.from(x, (s) => Math.max(-32768, Math.min(32767, Math.round(s * 32767))))

/** Encodes mono or stereo audio (more channels are folded into stereo) to MP3 chunks. */
export function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  onProgress: (fraction: number) => void = () => {},
): Uint8Array[] {
  const stereo = channels.length > 1
  const left = channels[0]
  const right = stereo ? channels[1] : undefined
  if (channels.length > 2) {
    // Fold extra channels evenly into both sides.
    for (let c = 2; c < channels.length; c++) {
      for (let i = 0; i < left.length; i++) {
        left[i] += channels[c][i] / 2
        right![i] += channels[c][i] / 2
      }
    }
  }
  const encoder = new Mp3Encoder(stereo ? 2 : 1, sampleRate, MP3_KBPS)
  const out: Uint8Array[] = []
  for (let i = 0; i < left.length; i += CHUNK) {
    const l = toInt16(left.subarray(i, i + CHUNK))
    const chunk = right ? encoder.encodeBuffer(l, toInt16(right.subarray(i, i + CHUNK))) : encoder.encodeBuffer(l)
    if (chunk.length) out.push(new Uint8Array(chunk))
    onProgress(Math.min(1, (i + CHUNK) / left.length))
  }
  const end = encoder.flush()
  if (end.length) out.push(new Uint8Array(end))
  return out
}
