import type { Content } from './game/content'
import type { Beat, GameState } from './model'
import type { ListModelsRequest, ListModelsResponse, LlmProfileId, SettingsUpdate, SettingsView } from './settings'

/** IPC channel names, shared by main and preload. */
export const IPC = {
  getContent: 'content:get',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  listModels: 'settings:list-models',
  testConnection: 'settings:test',
  sceneTurn: 'scene:turn',
  sceneEvent: 'scene:event'
} as const

export interface TestConnectionResult {
  ok: boolean
  /** What the model said, or why it failed. */
  detail: string
}

export interface SceneTurnRequest {
  state: GameState
  input: string
}

/** What a turn sends back. The renderer owns game state, so the new state comes back whole. */
export type SceneTurnResponse =
  | {
      ok: true
      state: GameState
      beats: Beat[]
      checks: string[]
      calls: number
      corrections: string[]
      /** Fixes asked of the rewrite, if there was one. */
      rewrite: string[]
    }
  | { ok: false; error: string }

/** Streamed while a turn runs (see TurnEvent in main/scene/runTurn.ts). */
export type SceneEvent =
  | { type: 'planned'; speakers: string[]; checks: string[]; corrections: string[]; fallback: boolean }
  | { type: 'delta'; text: string }
  | { type: 'restart'; reason: 'fallback-profile' | 'rewrite'; problems?: string[] }

/** What the preload script exposes to the renderer as `window.api`. */
export interface RendererApi {
  getContent(): Promise<Content>
  getSettings(): Promise<SettingsView>
  saveSettings(update: SettingsUpdate): Promise<SettingsView>
  listModels(request: ListModelsRequest): Promise<ListModelsResponse>
  testConnection(profileId: LlmProfileId): Promise<TestConnectionResult>
  sceneTurn(request: SceneTurnRequest): Promise<SceneTurnResponse>
  /** Listens for a running turn's events; returns a function that stops listening. */
  onSceneEvent(listener: (event: SceneEvent) => void): () => void
}
