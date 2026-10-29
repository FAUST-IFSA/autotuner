import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_SAMPLE_RATE,
  computeF0,
  curveForDisplay,
  dropShortRuns,
  f0Median,
  f0Support,
  medianFilterVoicedRuns,
} from './f0'
import { midiToHz } from './music'

function tone(midi: number, seconds: number, sr = ANALYSIS_SAMPLE_RATE) {
  const hz = midiToHz(midi)
  return Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => 0.4 * Math.sin((2 * Math.PI * hz * i) / sr))
}

describe('medianFilterVoicedRuns', () => {
  it('removes a single-frame spike', () => {
    expect(medianFilterVoicedRuns([60, 60, 72, 60, 60], 5)).toEqual([60, 60, 60, 60, 60])
  })

  it('never reaches across unvoiced gaps', () => {
    expect(medianFilterVoicedRuns([60, 60, null, 70, 70], 5)).toEqual([60, 60, null, 70, 70])
  })
})

describe('computeF0', () => {
  it('tracks a steady tone', () => {
    const f0 = computeF0(tone(57.3, 1))
    const voiced = f0.midi.filter((m): m is number => m !== null)
    expect(voiced.length).toBeGreaterThan(f0.midi.length * 0.8)
    for (const m of voiced) expect(m).toBeCloseTo(57.3, 1)
  })

  it('marks silence unvoiced', () => {
    const samples = new Float32Array(ANALYSIS_SAMPLE_RATE)
    samples.set(tone(60, 0.5))
    const f0 = computeF0(samples)
    const lastQuarter = f0.midi.slice(Math.floor(f0.midi.length * 0.75))
    expect(lastQuarter.every((m) => m === null)).toBe(true)
  })

  it('aligns frame times with sample times', () => {
    const samples = new Float32Array(ANALYSIS_SAMPLE_RATE * 2)
    samples.set(tone(64, 0.5), ANALYSIS_SAMPLE_RATE)
    const f0 = computeF0(samples)
    expect(f0Median(f0, 0, 0.9)).toBeNull()
    expect(f0Median(f0, 1.05, 1.45)).toBeCloseTo(64, 1)
  })
})

describe('f0Median', () => {
  const f0 = { hopSec: 0.01, midi: [null, 60.2, 60.1, 72.1, 60.3, null], clarity: [0, 0.7, 0.9, 0.9, 0.9, 0] }

  it('ignores frames far from the reference pitch (octave errors)', () => {
    expect(f0Median(f0, 0, 0.05, 60)).toBeCloseTo(60.2)
  })

  it('returns null without enough voiced frames', () => {
    expect(f0Median(f0, 0, 0.015)).toBeNull()
  })
})

describe('weak frames inside notes', () => {
  // Frame 1 is weak (0.7): it counts near a note's pitch, but not on its own.
  const f0 = { hopSec: 0.01, midi: [60.1, 60.2, 60.1, 67, null], clarity: [0.9, 0.7, 0.9, 0.7, 0] }

  it('counts weak frames only when they agree with a reference pitch', () => {
    expect(f0Median(f0, 0, 0.02, undefined, 2)).toBeCloseTo(60.1)
    expect(f0Support(f0, 0, 0.04, 60)).toBeCloseTo(3 / 5)
  })

  it('shows weak frames only inside a matching note', () => {
    expect(curveForDisplay(f0, []).midi).toEqual([null, null, null, null, null])
    expect(curveForDisplay(f0, [{ start: 0, end: 0.04, detectedMidi: 60 }]).midi).toEqual([
      60.1,
      60.2,
      60.1,
      null,
      null,
    ])
  })
})

describe('dropShortRuns', () => {
  it('hides voiced runs shorter than the minimum', () => {
    expect(dropShortRuns([60, null, 61, 61, 61, null, 62], 2)).toEqual([null, null, 61, 61, 61, null, null])
  })
})
