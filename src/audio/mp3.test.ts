import { describe, expect, it } from 'vitest'
import { MP3_KBPS, encodeMp3 } from './mp3'

const tone = (seconds: number, sr: number) =>
  Float32Array.from({ length: seconds * sr }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr))

describe('encodeMp3', () => {
  it('encodes stereo at about 192 kbps, starting with an MP3 frame sync', () => {
    const progress: number[] = []
    const chunks = encodeMp3([tone(2, 44100), tone(2, 44100)], 44100, (p) => progress.push(p))
    const bytes = chunks.reduce((n, c) => n + c.length, 0)
    const first = chunks[0]
    // Frame sync: 11 set bits.
    expect(first[0]).toBe(0xff)
    expect(first[1] & 0xe0).toBe(0xe0)
    expect(bytes).toBeGreaterThan(((MP3_KBPS * 1000) / 8) * 2 * 0.9)
    expect(bytes).toBeLessThan(((MP3_KBPS * 1000) / 8) * 2 * 1.15)
    expect(progress.at(-1)).toBe(1)
  })

  it('encodes mono', () => {
    expect(encodeMp3([tone(1, 48000)], 48000).length).toBeGreaterThan(0)
  })
})
