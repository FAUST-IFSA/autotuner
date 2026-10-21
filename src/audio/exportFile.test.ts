import { describe, expect, it } from 'vitest'
import { tunedFileName } from './exportFile'

describe('tunedFileName', () => {
  it('replaces the extension and adds -tuned', () => {
    expect(tunedFileName('raise-your-lighters.mp3', 'wav')).toBe('raise-your-lighters-tuned.wav')
    expect(tunedFileName('take 3.final.flac', 'mp3')).toBe('take 3.final-tuned.mp3')
    expect(tunedFileName('noext', 'wav')).toBe('noext-tuned.wav')
  })
})
