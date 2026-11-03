# Third-party license register

One row per dependency that ships to users (plus Vite, which injects a small helper into the build), and the Basic Pitch model weights. Dev-only tools (TypeScript, Vitest, oxlint, the license checker, the `@types/*` packages and the Vite React plugin) are not listed; they are never shipped. Licenses were read from each installed
package's own LICENSE file (copied to `texts/`). Where a package ships no license file, the text was fetched
from the upstream repository at the matching tag. Not shown on the site for now.

- `npm run licenses:check` scans the full tree, including transitive dependencies. It fails on GPL, AGPL,
  LGPL or unknown licenses; lamejs is the only allowlisted exception.
- `node scripts/licenses-collect.mjs` refreshes `texts/` for runtime dependencies and prints versions.
- For the full tree, including transitive packages, run `npm run licenses:check`; it prints the license counts.

Where it runs:

- **browser**: shipped to users (main bundle or the analysis worker)
- **dev**: build, test or lint only; never shipped

Versions are as resolved in `package-lock.json` on 2026-10-13.

| Package | Version | License (SPDX) | Source | Where it runs | Obligations | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| react | 19.3.0 | MIT | https://github.com/facebook/react | browser | Keep copyright + license notice | From the team scaffold |
| react-dom | 19.3.0 | MIT | https://github.com/facebook/react | browser | Keep copyright + license notice | From the team scaffold |
| konva | 10.7.1 | MIT | https://github.com/konvajs/konva | browser | Keep copyright + license notice | From the team scaffold |
| react-konva | 19.3.0 | MIT | https://github.com/konvajs/react-konva | browser | Keep copyright + license notice | From the team scaffold |
| react-dropzone | 20.1.3 | MIT | https://github.com/react-dropzone/react-dropzone | browser | Keep copyright + license notice | From the team scaffold |
| @spotify/basic-pitch | 1.0.1 | Apache-2.0 | https://github.com/spotify/basic-pitch-ts | browser (analysis worker) | Include the license; state changes if modified; carry any NOTICE | The npm package ships LICENSE only. The upstream Python repo has a NOTICE, but the npm package we ship does not, so there is none to carry. The README's license section also mentions "the GPL License" and "either license", which reads as boilerplate; the only license file is Apache-2.0, and we use it under Apache-2.0. |
| Basic Pitch model weights (`model.json`, `group1-shard1of1.bin`) | from @spotify/basic-pitch 1.0.1 | Apache-2.0 | https://github.com/spotify/basic-pitch-ts/tree/main/model | browser (served from `public/models/basic-pitch/`) | As above. The LICENSE is copied next to the weights. | No separate model license exists in the package or the upstream repos; the package's Apache-2.0 LICENSE covers the weights. |
| @tensorflow/tfjs | 4.22.0 | Apache-2.0 | https://github.com/tensorflow/tfjs | browser (analysis worker) | Include the license; state changes if modified | The npm package ships no LICENSE file; text taken from upstream tag `tfjs-v4.22.0` (no NOTICE file there). Pinned to 4.22.0 for Basic Pitch via `overrides`. |
| @tensorflow/tfjs-backend-wasm | 4.22.0 | Apache-2.0 | https://github.com/tensorflow/tfjs/tree/master/tfjs-backend-wasm | browser (analysis worker; `.wasm` served from `public/tfjs-wasm/`) | Include the license; state changes if modified | Same monorepo and license text as tfjs. Ships prebuilt WASM (XNNPACK). |
| idb-keyval | 6.3.0 | Apache-2.0 | https://github.com/jakearchibald/idb-keyval | browser | Include license; state changes if modified | Recent projects in IndexedDB (stays on the user's device) |
| pitchy | 4.1.0 | MIT | https://github.com/ianprime0509/pitchy | browser (analysis worker) | Keep copyright + license notice | |
| signalsmith-stretch | 1.3.2 | MIT | https://github.com/Signalsmith-Audio/signalsmith-stretch | browser (AudioWorklet, precompiled WASM, unmodified) | Keep copyright + license notice | npm package ships **no LICENSE file**; text from upstream `LICENSE.txt` (© 2022 Geraint Luff / Signalsmith Audio Ltd). Types are our own (`src/audio/signalsmith-stretch.d.ts`). |
| @breezystack/lamejs | 1.2.7 | LGPL-3.0 | https://github.com/shijinyu/lamejs (fork of https://github.com/zhuker/lamejs) | browser, **MP3 worker chunk only** (`mp3.worker-*.js`) | LGPL: shipped unmodified as its own separately loaded file so it can be replaced; keep the LICENSE text and a source link with the app; don't statically merge it into our code | The only allowlisted copyleft package. Chosen over `lamejs` 1.2.1 (last published 2022; its npm build throws `MPEGMode is not defined` in bundlers). Imported only by `src/audio/mp3.ts`, used only by `mp3.worker.ts`. Constants live in `mp3Limits.ts` so the main bundle never imports it (verified in the production build: the encoder appears only in the worker chunk). **License texts:** the package's `LICENSE` file is LAME's usage note, not the license itself (kept as `texts/@breezystack__lamejs.LAME-usage-note.txt`). The full LGPL-3.0 text and the GPL-3.0 text it builds on come from gnu.org. Upstream LAME is LGPL-2.0-or-later, so the package's LGPL-3.0 declaration is compatible. |
| vite | 8.3.4 | MIT | https://github.com/vitejs/vite | dev (a small preload helper is injected into the build output) | Keep copyright + license notice | Only Vite's own MIT notice is kept in `texts/`; the long list of licenses for Vite's build-time dependencies was dropped. Pulls in `lightningcss` (MPL-2.0), which runs at build time only and is not shipped |
