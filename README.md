# autotuner
Browser-based Autotune tool for Faust Studios.

## Development

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # type-check and production build
npm run lint
npm test        # unit tests + pitch-accuracy test on a generated vocal
npm run licenses:check
npm run format         # Prettier (format:check in CI)
```

Stack: React + TypeScript (Vite), Konva via `react-konva` for the editor canvas, `react-dropzone` for uploads.
Pitch analysis runs in a Web Worker: Basic Pitch (TensorFlow.js WASM backend) for notes and pitchy for the
pitch curve. Audio never leaves the browser.

Playback and drag preview use Signalsmith Stretch (WASM in an AudioWorklet). Audio acceptance checks:
see `src/dev/audioChecks.ts` (run from the browser console on the dev server).

Build plan: `PLAN.md`. Decisions and deviations: `docs/DECISIONS.md`. License register: `docs/licenses/`.
