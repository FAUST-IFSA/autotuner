import type { TuningParams } from '../audio/params'

/** What to do to the detected notes before rendering. `range` limits it to notes overlapping those seconds. */
export type SweepEdit = ({ shift: number } | { snap: true }) & { range?: [number, number] }

export interface SweepConfig {
  /**
   * Which files from `sweep/inputs/` to use: any whose name contains one of these. All of them if omitted.
   * Files from anywhere else can be added with the file picker on the page.
   */
  files?: string[]
  /**
   * `{ shift: 3 }` moves every note up 3 semitones, which is the clearest way to hear what was left unshifted.
   * `{ snap: true }` snaps every note to the nearest semitone (plain autotune). Add `range: [10, 20]` to
   * edit only that section and leave the rest as it was.
   */
  edit: SweepEdit
  /** The one parameter to vary, and the values to try. Each value is rendered to its own audio file. */
  sweep: { param: keyof TuningParams; values: number[] }
  /** Other parameters to hold at a value other than their default while sweeping. */
  base?: Partial<TuningParams>
  /** Show and play only this part of the output (seconds). Analysis still sees the whole file. */
  window?: [number, number]
}

export const defineSweep = (config: SweepConfig) => config
