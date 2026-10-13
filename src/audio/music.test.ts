import { describe, expect, it } from 'vitest'
import { centsOff, hzToMidi, median, midiToHz } from './music'

describe('music helpers', () => {
  it('converts between Hz and MIDI', () => {
    expect(hzToMidi(440)).toBeCloseTo(69)
    expect(midiToHz(69)).toBeCloseTo(440)
    expect(hzToMidi(midiToHz(61.37))).toBeCloseTo(61.37)
  })

  it('measures cents from the nearest semitone', () => {
    expect(centsOff(60.25)).toBeCloseTo(25)
    expect(centsOff(59.8)).toBeCloseTo(-20)
  })

  it('takes the median', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeNaN()
  })
})
