import { describe, expect, it } from 'vitest'
import { backingGain, backingSpan } from './backing'

describe('backingSpan', () => {
  it('plays both from the same moment when they start together', () => {
    expect(backingSpan(12, 0, 180, 180)).toEqual({ delay: 0, start: 12, duration: 168 })
  })

  it('starts partway into the backing track when the vocal starts later in the song', () => {
    // The vocal is a 60 s verse starting 30 s into a 3-minute song; play from 5 s into the vocal.
    expect(backingSpan(5, 30, 60, 180)).toEqual({ delay: 0, start: 35, duration: 55 })
  })

  it('waits for the backing track when the vocal starts before it', () => {
    expect(backingSpan(0, -2, 60, 180)).toEqual({ delay: 2, start: 0, duration: 58 })
    expect(backingSpan(3, -2, 60, 180)).toEqual({ delay: 0, start: 1, duration: 57 })
  })

  it('stops at the end of the backing track if it ends before the vocal', () => {
    expect(backingSpan(10, 0, 200, 180)).toEqual({ delay: 0, start: 10, duration: 170 })
  })

  it('is null when there is no backing left under the vocal', () => {
    expect(backingSpan(185, 0, 200, 180)).toBeNull()
    expect(backingSpan(0, 200, 60, 180)).toBeNull()
    expect(backingSpan(0, -70, 60, 180)).toBeNull()
  })
})

describe('backingGain', () => {
  it('is silent when muted and squares the slider otherwise', () => {
    expect(backingGain({ volume: 0.8, muted: true })).toBe(0)
    expect(backingGain({ volume: 0.5, muted: false })).toBe(0.25)
    expect(backingGain({ volume: 1, muted: false })).toBe(1)
  })
})
