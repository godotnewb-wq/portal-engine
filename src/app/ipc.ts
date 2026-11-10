import type { Pack } from '@engine/pack'
import type { TurnEvent } from '@engine/scene'
import type { PackListing } from '@platform/packs'
import type { WitnessReport } from '@engine/relationships'
import type { SaveRequest, SaveSummary, SlotId } from '@engine/state'
import type { Beat, GameState } from '@engine/state'
import type { FlagInput, TurnDetails } from '@platform/logs'
import type { FlagRecord } from '@engine/review'
import type { ListModelsRequest, ListModelsResponse, LlmProfileId, SettingsUpdate, SettingsView } from '@llm'
import type { LoreBudgetOverrides } from '@engine/rules'

/** IPC channel names, shared by main and preload. */
export const IPC = {
  listPacks: 'packs:list',
  choosePack: 'packs:choose',
  openPacksFolder: 'packs:open-folder',
  getPackFolders: 'settings:pack-folders',
  setPackFolders: 'settings:set-pack-folders',
  chooseFolder: 'settings:choose-folder',
  getSettings: 'settings:get',
  getLoreBudgets: 'settings:lore-budgets',
  setLoreBudgets: 'settings:set-lore-budgets',
  saveSettings: 'settings:save',
  listModels: 'settings:list-models',
  testConnection: 'settings:test',
  sceneTurn: 'scene:turn',
  sceneEvent: 'scene:event',
  sceneEnd: 'scene:end',
  listSaves: 'saves:list',
  saveGame: 'saves:save',
  loadGame: 'saves:load',
  deleteSave: 'saves:delete',
  beginLog: 'logs:begin',
  endLog: 'logs:end',
  getLogging: 'logs:get-enabled',
  setLogging: 'logs:set-enabled',
  openLogsFolder: 'logs:open-folder',
  flag: 'logs:flag',
  flagsFor: 'logs:flags-for',
  turnDetails: 'logs:turn-details'
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
      /** The turn's trace for the Turn details panel; the session it was logged in, if logging is on. */
      details: TurnDetails
    }
  | { ok: false; error: string }

/** Streamed while a turn runs: the engine's turn events, passed through. */
export type SceneEvent = TurnEvent

/** The scene's close: the new state (scene cleared) and what each witness took from it. */
export type SceneEndResponse = { ok: true; state: GameState; reports: WitnessReport[] } | { ok: false; error: string }

export type SaveResponse = { ok: true; summary: SaveSummary } | { ok: false; error: string }
export type LoadResponse = { ok: true; state: GameState } | { ok: false; error: string }

export type ChoosePackResponse = { ok: true; pack: Pack } | { ok: false; error: string }

/** What the preload script exposes to the renderer as `window.api`. */
export interface RendererApi {
  /** Looks for packs again and lists every one found, sound or not (architecture §9). */
  listPacks(): Promise<PackListing[]>
  /** Plays the pack in that folder; saves and scenes then belong to it. */
  choosePack(key: string): Promise<ChoosePackResponse>
  /** Opens the user packs folder in the file manager, creating it if needed. Returns its path. */
  openPacksFolder(): Promise<string>
  getPackFolders(): Promise<string[]>
  setPackFolders(folders: string[]): Promise<string[]>
  /** Asks the player to pick a folder; null if they cancel. */
  chooseFolder(): Promise<string | null>
  getSettings(): Promise<SettingsView>
  saveSettings(update: SettingsUpdate): Promise<SettingsView>
  /** The lore budgets set over every pack's defaults; a field left out uses the pack's (milestone 3, task 10). */
  getLoreBudgets(): Promise<LoreBudgetOverrides>
  /** Saves them, cleaned; returns what was kept. They apply from the next turn. */
  setLoreBudgets(budgets: LoreBudgetOverrides): Promise<LoreBudgetOverrides>
  listModels(request: ListModelsRequest): Promise<ListModelsResponse>
  testConnection(profileId: LlmProfileId): Promise<TestConnectionResult>
  sceneTurn(request: SceneTurnRequest): Promise<SceneTurnResponse>
  /** Runs the end-of-scene summaries, one per witness, in parallel. */
  sceneEnd(state: GameState): Promise<SceneEndResponse>
  listSaves(): Promise<SaveSummary[]>
  saveGame(request: SaveRequest): Promise<SaveResponse>
  /** Loads a slot, refusing a save that no longer fits the content. */
  loadGame(slotId: SlotId): Promise<LoadResponse>
  deleteSave(slotId: SlotId): Promise<void>
  /** A game was started or loaded: a log session begins (milestone 2, A2). Returns its id, or null with logging off. */
  beginLog(from: string): Promise<string | null>
  /** Back at the title screen: the session ends. */
  endLog(): Promise<void>
  getLogging(): Promise<boolean>
  setLogging(on: boolean): Promise<boolean>
  /** Opens this pack's logs folder (or all logs, before a pack is chosen); returns its path. */
  openLogsFolder(): Promise<string>
  /** Saves (or, with `flag: null`, clears) a flag on a beat or turn. */
  flag(input: FlagInput): Promise<FlagRecord | null>
  /** The flags standing on these logged turns. */
  flagsFor(turns: { session: string; turnId: string }[]): Promise<FlagRecord[]>
  /** A logged turn's details, read back from its session. */
  turnDetails(session: string, turnId: string): Promise<TurnDetails | null>
  /** Listens for a running turn's events; returns a function that stops listening. */
  onSceneEvent(listener: (event: SceneEvent) => void): () => void
}
