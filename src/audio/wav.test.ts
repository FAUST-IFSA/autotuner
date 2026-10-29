import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

function read24(view: DataView, offset: number) {
  const v = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
  return (v & 0x800000 ? v - 0x1000000 : v) / 0x800000
}

describe('encodeWav', () => {
  const left = Float32Array.from([0, 0.5, -0.5, 1, -1.2])
  const right = Float32Array.from([0.25, -0.25, 0, -1, 1.2])
  const view = new DataView(encodeWav([left, right], 44100))
  const ascii = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(o + i)))

  it('writes a 24-bit stereo PCM header', () => {
    expect(ascii(0)).toBe('RIFF')
    expect(ascii(8)).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint16(34, true)).toBe(24)
    expect(view.getUint32(40, true)).toBe(5 * 2 * 3)
    expect(view.byteLength).toBe(44 + 30)
  })

  it('interleaves samples and clamps out-of-range values', () => {
    const samples = Array.from({ length: 10 }, (_, i) => read24(view, 44 + i * 3))
    const expected = [0, 0.25, 0.5, -0.25, -0.5, 0, 1, -1, -1, 1]
    samples.forEach((s, i) => expect(s).toBeCloseTo(expected[i], 5))
  })
})
