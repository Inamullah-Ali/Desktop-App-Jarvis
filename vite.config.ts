import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: [
                'dotenv',
                'bufferutil',
                'utf-8-validate',
                'ws',
                'playwright',
                'playwright-core',
                '@nut-tree-fork/nut-js',
              ],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  optimizeDeps: {
    exclude: [
      'onnxruntime-web',
      'openwakeword-wasm-browser',
      'playwright',
      '@huggingface/transformers',   // ✅ Naya package
    ],
  },
  build: {
    rollupOptions: {
      external: ['playwright', 'playwright-core'],
    },
  },
  assetsInclude: ['**/*.onnx', '**/*.wasm'],
})