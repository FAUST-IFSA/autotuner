import { CROSSFADE_SECONDS, type VoicePlan } from './schedule'

/**
 * Linear (equal-gain) curves: the two voices carry the same performance at nearby pitches, so they are
 * highly correlated and a linear fade keeps the level constant through the handover.
 */
const FADE_IN = Float32Array.from({ length: 16 }, (_, i) => i / 15)
const FADE_OUT = FADE_IN.map((v) => 1 - v)

/**
 * Schedules a plan's crossfades on the two voice gains. `toTime` maps a time in the original audio to
 * the AudioContext clock. Fades starting before `notBefore` are skipped (already past).
 */
export function scheduleFades(
  gains: [AudioParam, AudioParam],
  plan: VoicePlan,
  toTime: (t: number) => number,
  notBefore = 0,
) {
  for (const fade of plan.fades) {
    const start = toTime(fade.t) - CROSSFADE_SECONDS / 2
    if (start < notBefore) continue
    gains[fade.to].setValueCurveAtTime(FADE_IN, start, CROSSFADE_SECONDS)
    gains[fade.to === 0 ? 1 : 0].setValueCurveAtTime(FADE_OUT, start, CROSSFADE_SECONDS)
  }
}
