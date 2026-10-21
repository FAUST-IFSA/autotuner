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
```

Stack: React + TypeScript (Vite), Konva via `react-konva` for the editor canvas, `react-dropzone` for uploads.
Pitch analysis runs in a Web Worker: Basic Pitch (TensorFlow.js WASM backend) for notes and pitchy for the
pitch curve. Audio never leaves the browser.

Build plan: `PLAN.md`. Decisions and deviations: `docs/DECISIONS.md`. License register: `docs/licenses/`.
