import type { Content } from './game/content'
import type { ListModelsRequest, ListModelsResponse, LlmProfileId, SettingsUpdate, SettingsView } from './settings'

/** IPC channel names, shared by main and preload. */
export const IPC = {
  getContent: 'content:get',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  listModels: 'settings:list-models',
  testConnection: 'settings:test'
} as const

export interface TestConnectionResult {
  ok: boolean
  /** What the model said, or why it failed. */
  detail: string
}

/** What the preload script exposes to the renderer as `window.api`. */
export interface RendererApi {
  getContent(): Promise<Content>
  getSettings(): Promise<SettingsView>
  saveSettings(update: SettingsUpdate): Promise<SettingsView>
  listModels(request: ListModelsRequest): Promise<ListModelsResponse>
  testConnection(profileId: LlmProfileId): Promise<TestConnectionResult>
}
