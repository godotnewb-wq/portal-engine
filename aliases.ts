import { resolve } from 'node:path'

/** The layer aliases, shared by electron-vite, Vitest and the preview build (tsconfig.json has the same list). */
export const aliases = {
  '@llm': resolve(__dirname, 'src/llm/index.ts'),
  '@engine': resolve(__dirname, 'src/engine'),
  '@platform': resolve(__dirname, 'src/platform'),
  '@app': resolve(__dirname, 'src/app'),
  '@tests': resolve(__dirname, 'tests')
}
