import { describe, expect, it } from 'vitest'
import { preventClipping, tunedFileName } from './exportFile'

describe('tunedFileName', () => {
  it('replaces the extension and adds -tuned', () => {
    expect(tunedFileName('raise-your-lighters.mp3', 'wav')).toBe('raise-your-lighters-tuned.wav')
    expect(tunedFileName('take 3.final.flac', 'mp3')).toBe('take 3.final-tuned.mp3')
    expect(tunedFileName('noext', 'wav')).toBe('noext-tuned.wav')
  })
})

describe('preventClipping', () => {
  it('turns the whole file down just enough when peaks pass full scale', () => {
    const [a, b] = preventClipping([Float32Array.from([0.5, 1.2]), Float32Array.from([-0.6, 0.3])])
    expect(Math.max(...a.map(Math.abs), ...b.map(Math.abs))).toBeCloseTo(0.995)
    expect(a[0] / a[1]).toBeCloseTo(0.5 / 1.2)
  })

  it('leaves files within range untouched', () => {
    const [a] = preventClipping([Float32Array.from([0.5, -0.9])])
    expect([...a]).toEqual([0.5, Math.fround(-0.9)])
  })
})
