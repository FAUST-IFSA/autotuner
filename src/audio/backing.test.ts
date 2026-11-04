import { describe, expect, it } from 'vitest'
import { backingGain, backingSpan, clampOffset, formatSongTime, lineUpRange, sameLength } from './backing'

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

describe('lining up', () => {
  it('treats files within 0.1 s of each other as the same length', () => {
    expect(sameLength(180, 180.05)).toBe(true)
    expect(sameLength(180, 180.2)).toBe(false)
  })

  it('spans the whole backing track and wherever the vocal can go', () => {
    // A 60 s verse in a 3-minute song: margin 9 s either side.
    expect(lineUpRange(60, 180)).toEqual({ start: -9, end: 189 })
    // A vocal longer than the backing track can start before it.
    expect(lineUpRange(200, 180)).toEqual({ start: -30, end: 210 })
  })

  it('keeps the vocal in view and overlapping the backing track', () => {
    expect(clampOffset(30, 60, 180)).toBe(30)
    expect(clampOffset(-50, 60, 180)).toBe(-9)
    expect(clampOffset(500, 60, 180)).toBe(129)
    // A 3 s clip near the end must still overlap the backing track by 0.5 s.
    expect(clampOffset(185, 3, 180)).toBe(179.5)
    expect(clampOffset(-20, 3, 180)).toBe(-2.5)
  })

  it('formats song time with hundredths', () => {
    expect(formatSongTime(72.4)).toBe('1:12.40')
    expect(formatSongTime(0)).toBe('0:00.00')
    expect(formatSongTime(-1.2)).toBe('-0:01.20')
    expect(formatSongTime(59.999)).toBe('1:00.00')
  })
})
