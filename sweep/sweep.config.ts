// Edit this file, save, and the page at /sweep.html re-renders. Start it with `npm run sweep`.
// Put the audio to test in sweep/inputs/ (it is git-ignored). See src/dev/sweepConfig.ts for every option.
import { defineSweep } from '../src/dev/sweepConfig'

export default defineSweep({
  // files: ['talking'],
  edit: { shift: 3 },
  sweep: { param: 'bridgeMaxGapSeconds', values: [0, 0.1, 0.3, 0.6] },
  // window: [10, 25],
})
