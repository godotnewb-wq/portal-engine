/// <reference types="vite/client" />
import type { RendererApi } from '../../ipc'

declare global {
  interface Window {
    api: RendererApi
  }
}

export {}
