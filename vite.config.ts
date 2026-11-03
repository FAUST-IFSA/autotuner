import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Writes the licenses of the packages in the main bundle next to the build, so the notices MIT/Apache/BSD
    // code asks for ship with the site. Known gaps: it does not cover the two worker bundles (analysis worker:
    // tfjs, Basic Pitch; MP3 worker: lamejs), and packages without a LICENSE file in their npm download
    // (signalsmith-stretch, fft.js) are listed without text.
    license: { fileName: 'third-party-licenses.md' },
  },
  // The analysis worker imports these lazily; pre-bundling them up front stops Vite from
  // discovering them mid-analysis and reloading the page.
  optimizeDeps: {
    include: [
      '@spotify/basic-pitch',
      '@tensorflow/tfjs',
      '@tensorflow/tfjs-backend-wasm',
      'pitchy',
      'signalsmith-stretch',
    ],
  },
})
