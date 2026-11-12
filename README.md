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

To compare ways of applying pitch shifts by ear, open `/compare.html` on the dev server (`src/dev/compare.ts`;
dev only, not built). It renders one passage of a vocal several ways through the export renderer, with the
backing track; it reads `fixtures/pairs/` by default (see `fixtures/pairs/README.md`, local files only).

Build plan: `PLAN.md`. Decisions and deviations: `docs/DECISIONS.md`. Known limitations: `docs/LIMITATIONS.md`. License register: `docs/licenses/`.
