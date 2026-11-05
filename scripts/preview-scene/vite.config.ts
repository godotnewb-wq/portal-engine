import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A browser build of the renderer with a mock window.api, to look at screens without Electron or an LLM.
export default defineConfig({ root: __dirname, plugins: [react()], build: { outDir: 'dist', emptyOutDir: true } })
