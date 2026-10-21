import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The analysis worker imports these lazily; pre-bundling them up front stops Vite from
  // discovering them mid-analysis and reloading the page.
  optimizeDeps: {
    include: ['@spotify/basic-pitch', '@tensorflow/tfjs', '@tensorflow/tfjs-backend-wasm', 'pitchy', 'signalsmith-stretch'],
  },
})
