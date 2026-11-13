import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Pack } from '@engine/pack'
import { TracedError } from '@engine/core'
import { endScene } from '@engine/relationships'
import { runTurn } from '@engine/scene'
import { FlagSchema } from '@engine/review'
import { detailsOf, PlayLogs, roleModels, type FlagInput } from '@platform/logs'
import { GameStateSchema, SaveRequestSchema, SlotIdSchema, stateProblems } from '@engine/state'
import { chatCompletion, isConfigured, listModels, ListModelsRequestSchema, LLM_PROFILE_IDS, SettingsUpdateSchema, toView, type LlmProfileId } from '@llm'
import { discoverPacks, type PackListing, type PackSource } from '@platform/packs'
import { summaryLlm, turnLlm } from '@platform/roles'
import { SaveStore } from '@platform/saves'
import { SettingsStore, type KeyCipher } from '@platform/settings'
import {
  IPC,
  type ChoosePackResponse,
  type LoadResponse,
  type SaveResponse,
  type SceneEndResponse,
  type SceneEvent,
  type SceneTurnResponse,
  type TestConnectionResult
} from '../ipc'

/** Bundled packs: beside the app when packaged, the repository's `packs/` when run from source. */
const bundledPacksDir = (): string => (app.isPackaged ? join(process.resourcesPath, 'packs') : join(app.getAppPath(), 'packs'))
/** Packs the player installs: dropped into the app-data folder (architecture §9). */
const userPacksDir = (): string => join(app.getPath('userData'), 'packs')
/** Each pack's saves in a folder of their own. */
const savesDir = (packId: string): string => join(app.getPath('userData'), 'saves', packId)
/** Play logs, a folder per pack: never inside the pack, which is read-only. */
const logsRoot = (): string => join(app.getPath('userData'), 'logs')

function keyCipher(): KeyCipher | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined
  return {
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (stored) => safeStorage.decryptString(Buffer.from(stored, 'base64'))
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0d0b12',
    title: 'Portal Engine',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  // electron-vite sets ELECTRON_RENDERER_URL when running the dev server.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Set once the app is ready: ends the open log session. */
let closeLogs: (() => void) | undefined

const profileId = (value: unknown): LlmProfileId => {
  if (!LLM_PROFILE_IDS.includes(value as LlmProfileId)) throw new Error(`Unknown profile "${String(value)}"`)
  return value as LlmProfileId
}

app.whenReady().then(() => {
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), keyCipher())

  // The packs found at the last scan, and the one being played. Everything a game does goes through `playing`.
  let found: { listings: PackListing[]; packs: Map<string, Pack> } = { listings: [], packs: new Map() }
  let playing: { pack: Pack; saves: SaveStore; logs: PlayLogs } | null = null
  const sources = (): PackSource[] => [
    { kind: 'bundled', dir: bundledPacksDir() },
    { kind: 'user', dir: userPacksDir() },
    ...settings.getPackFolders().map((dir): PackSource => ({ kind: 'extra', dir }))
  ]
  const current = (): { pack: Pack; saves: SaveStore; logs: PlayLogs } => {
    if (!playing) throw new Error('No pack is chosen yet.')
    return playing
  }

  ipcMain.handle(IPC.listPacks, () => {
    found = discoverPacks(sources())
    return found.listings
  })
  ipcMain.handle(IPC.choosePack, (_event, key: unknown): ChoosePackResponse => {
    const pack = typeof key === 'string' ? found.packs.get(key) : undefined
    if (!pack) {
      const listing = found.listings.find((l) => l.key === key)
      return { ok: false, error: listing ? `This pack can't be played: ${listing.problems.join('; ')}` : 'That pack is no longer there.' }
    }
    playing?.logs.end()
    const logs = new PlayLogs(join(logsRoot(), pack.manifest.id), pack, () => ({ engine: app.getVersion(), models: roleModels(settings.get()) }), () => settings.getLogging())
    playing = { pack, saves: new SaveStore(savesDir(pack.manifest.id), { id: pack.manifest.id, version: pack.manifest.version }), logs }
    return { ok: true, pack }
  })
  ipcMain.handle(IPC.openPacksFolder, async () => {
    const dir = userPacksDir()
    mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
    return dir
  })
  ipcMain.handle(IPC.getPackFolders, () => settings.getPackFolders())
  ipcMain.handle(IPC.setPackFolders, (_event, folders: unknown) =>
    settings.setPackFolders(Array.isArray(folders) ? folders.filter((f): f is string => typeof f === 'string') : [])
  )
  ipcMain.handle(IPC.chooseFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.getSettings, () => toView(settings.get()))
  ipcMain.handle(IPC.getLoreBudgets, () => settings.getLoreBudgets())
  ipcMain.handle(IPC.setLoreBudgets, (_event, budgets: unknown) => settings.setLoreBudgets(budgets))
  ipcMain.handle(IPC.saveSettings, (_event, update: unknown) => toView(settings.update(SettingsUpdateSchema.parse(update))))
  ipcMain.handle(IPC.listModels, async (_event, request: unknown) => {
    const { profileId: id, baseUrl, apiKey } = ListModelsRequestSchema.parse(request)
    try {
      return { models: await listModels({ baseUrl, apiKey: apiKey ?? settings.get()[id].apiKey }) }
    } catch (error) {
      return { models: [], error: (error as Error).message }
    }
  })
  ipcMain.handle(IPC.testConnection, async (_event, id: unknown): Promise<TestConnectionResult> => {
    const profile = settings.get()[profileId(id)]
    if (!isConfigured(profile)) return { ok: false, detail: 'Set an endpoint and a model first.' }
    try {
      const reply = await chatCompletion(profile, {
        system: 'Reply with one short sentence.',
        messages: [{ role: 'user', content: 'Say hello.' }],
        maxTokens: 60,
        timeoutMs: 30_000
      })
      return { ok: true, detail: reply }
    } catch (error) {
      return { ok: false, detail: (error as Error).message }
    }
  })

  // One turn at a time: a second request while one runs would be answered from a stale state.
  let turning = false
  ipcMain.handle(IPC.sceneTurn, async (event, request: unknown): Promise<SceneTurnResponse> => {
    if (turning) return { ok: false, error: 'A turn is already running.' }
    turning = true
    try {
      const { pack, logs } = current()
      const { state: raw, input } = request as { state: unknown; input: unknown }
      const state = GameStateSchema.parse(raw)
      if (typeof input !== 'string' || input.trim().length === 0) return { ok: false, error: 'Say or do something first.' }
      const send = (sceneEvent: SceneEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.sceneEvent, sceneEvent)
      }
      const session = logs.sessionForTurn()
      const scene = state.scene
      // Scene ids are random and unique; the number makes the turn id read in order.
      const turnId = scene ? `${scene.id}-${scene.turns.length + 1}` : undefined
      try {
        const outcome = await runTurn(pack, state, input.trim(), turnLlm(settings.get()), send, { ...(turnId && { turnId }), ...(session && { log: session }), loreBudgets: settings.getLoreBudgets() })
        const details = logs.turn(outcome.trace, { location: scene!.locationId, cast: scene!.cast }) ?? detailsOf('', outcome.trace)
        return {
          ok: true,
          state: outcome.state,
          beats: outcome.beats,
          checks: outcome.plan.checks.flatMap((c) => (c.line ? [c.line] : [])),
          calls: outcome.calls,
          corrections: outcome.corrections,
          rewrite: outcome.problems.map((p) => p.fix),
          details
        }
      } catch (error) {
        logs.error('turn', (error as Error).message, { ...(turnId && { turnId }), ...(scene && { sceneId: scene.id }), ...(error instanceof TracedError && { calls: error.calls }) })
        throw error
      }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    } finally {
      turning = false
    }
  })

  ipcMain.handle(IPC.sceneEnd, async (_event, raw: unknown): Promise<SceneEndResponse> => {
    if (turning) return { ok: false, error: 'A turn is still running.' }
    turning = true
    try {
      const { pack, logs } = current()
      const state = GameStateSchema.parse(raw)
      try {
        const { state: next, reports, trace } = await endScene(pack, state, summaryLlm(settings.get()))
        logs.sceneEnd(trace)
        return { ok: true, state: next, reports }
      } catch (error) {
        logs.error('scene-end', (error as Error).message, { ...(state.scene && { sceneId: state.scene.id }), ...(error instanceof TracedError && { calls: error.calls }) })
        throw error
      }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    } finally {
      turning = false
    }
  })

  ipcMain.handle(IPC.listSaves, () => (playing ? playing.saves.list() : []))
  ipcMain.handle(IPC.saveGame, (_event, request: unknown): SaveResponse => {
    try {
      const { slotId, state, name } = SaveRequestSchema.parse(request)
      return { ok: true, summary: current().saves.save(slotId, state, new Date(), name) }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  })
  ipcMain.handle(IPC.loadGame, (_event, slotId: unknown): LoadResponse => {
    try {
      const { pack, saves } = current()
      const state = saves.load(SlotIdSchema.parse(slotId))
      // A save from another version of the pack loads only if it still fits the pack's content.
      const problems = stateProblems(pack, state)
      if (problems.length > 0) return { ok: false, error: `This save doesn't fit ${pack.manifest.name} ${pack.manifest.version}: ${problems.join('; ')}` }
      return { ok: true, state }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  })
  ipcMain.handle(IPC.deleteSave, (_event, slotId: unknown) => current().saves.delete(SlotIdSchema.parse(slotId)))

  ipcMain.handle(IPC.beginLog, (_event, from: unknown) => current().logs.begin(typeof from === 'string' ? from.slice(0, 80) : 'unknown'))
  ipcMain.handle(IPC.endLog, () => playing?.logs.end())
  ipcMain.handle(IPC.getLogging, () => settings.getLogging())
  ipcMain.handle(IPC.setLogging, (_event, on: unknown) => {
    const enabled = settings.setLogging(on === true)
    if (!enabled) playing?.logs.end()
    return enabled
  })
  ipcMain.handle(IPC.openLogsFolder, async () => {
    // Removing old logs is the player's call; this makes it easy.
    const dir = playing ? playing.logs.dir : logsRoot()
    mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
    return dir
  })
  ipcMain.handle(IPC.flag, (_event, raw: unknown) => {
    const input = raw as Partial<FlagInput>
    if (typeof input?.turnSession !== 'string' || typeof input.turnId !== 'string') throw new Error('A flag needs a logged turn.')
    const beat = typeof input.beat === 'number' && Number.isInteger(input.beat) && input.beat > 0 ? input.beat : undefined
    const flag = input.flag === null ? null : FlagSchema.parse(input.flag)
    return current().logs.flag({
      turnSession: input.turnSession,
      turnId: input.turnId,
      ...(beat !== undefined && { beat }),
      ...(typeof input.speaker === 'string' && { speaker: input.speaker }),
      ...(typeof input.text === 'string' && { text: input.text }),
      flag
    })
  })
  ipcMain.handle(IPC.flagsFor, (_event, turns: unknown) =>
    current().logs.flagsFor(Array.isArray(turns) ? turns.filter((t): t is { session: string; turnId: string } => typeof t?.session === 'string' && typeof t?.turnId === 'string') : [])
  )
  ipcMain.handle(IPC.turnDetails, (_event, session: unknown, turnId: unknown) =>
    typeof session === 'string' && typeof turnId === 'string' ? current().logs.details(session, turnId) : null
  )

  closeLogs = () => playing?.logs.end()

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  // Quitting ends the session; one that ends any other way is left without an end time, which marks it.
  closeLogs?.()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
