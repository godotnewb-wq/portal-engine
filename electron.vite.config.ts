import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { aliases } from './aliases'

export default defineConfig({
  main: { resolve: { alias: aliases }, build: { rollupOptions: { input: resolve(__dirname, 'src/app/main/index.ts') } } },
  preload: { resolve: { alias: aliases }, build: { rollupOptions: { input: resolve(__dirname, 'src/app/preload/index.ts') } } },
  renderer: {
    root: resolve(__dirname, 'src/app/renderer'),
    resolve: { alias: aliases },
    build: { rollupOptions: { input: resolve(__dirname, 'src/app/renderer/index.html') } },
    plugins: [react()]
  }
})
