import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Pack } from '@engine/pack'
import { TracedError } from '@engine/core'
import { consolidate, endScene, judgeScene } from '@engine/relationships'
import { applyRecords, runTurn } from '@engine/scene'
import { FlagSchema } from '@engine/review'
import { detailsOf, PlayLogs, roleModels, summarized, type FlagInput } from '@platform/logs'
import { GameStateSchema, SaveRequestSchema, SlotIdSchema, stateProblems, type GameState } from '@engine/state'
import { chatCompletion, isConfigured, listModels, ListModelsRequestSchema, LLM_PROFILE_IDS, SettingsUpdateSchema, toView, type LlmProfileId } from '@llm'
import { discoverPacks, type PackListing, type PackSource } from '@platform/packs'
import { bookkeeperLlm, bookkeeperWaitMs, bookkeepWithin, summaryLlm, turnLlm } from '@platform/roles'
import { SaveStore } from '@platform/saves'
import { SettingsStore, type KeyCipher } from '@platform/settings'
import {
  IPC,
  type ChoosePackResponse,
  type LoadResponse,
  type SaveResponse,
  type SceneEndResponse,
  type ConsolidateResponse,
  type SceneTiesResponse,
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

  // The last turn's bookkeeper (milestone 4c, decision B, 2026-11-18): started as soon as the turn is returned, so it
  // runs while the player reads, and held by the turn's id. It doesn't hold `turning`. The next turn, either half of
  // the scene's end and a save wait for it (up to its timeout, decisions A and C) and apply its records to the state
  // they were sent; applying them is idempotent, so the save's copy and the next turn's agree. A state whose last turn
  // isn't this one (a save loaded, a new game) ignores it.
  let recording: { turnId: string; done: Promise<Awaited<ReturnType<typeof bookkeepWithin>>>; settled: boolean } | null = null
  const record = (turnId: string, done: Promise<Awaited<ReturnType<typeof bookkeepWithin>>>) => {
    const held = { turnId, done, settled: false }
    void done.finally(() => (held.settled = true))
    recording = held
  }
  const recorded = async (state: GameState, notify: (event: SceneEvent) => void): Promise<GameState> => {
    const pending = recording
    if (!pending || state.scene?.turns.at(-1)?.id !== pending.turnId) return state
    if (pending.settled) return applyRecords(state, (await pending.done).records)
    notify({ type: 'catching-up' })
    try {
      return applyRecords(state, (await pending.done).records)
    } finally {
      notify({ type: 'caught-up' })
    }
  }
  const tell = (event: Electron.IpcMainInvokeEvent) => (sceneEvent: SceneEvent) => {
    if (!event.sender.isDestroyed()) event.sender.send(IPC.sceneEvent, sceneEvent)
  }
  ipcMain.handle(IPC.sceneTurn, async (event, request: unknown): Promise<SceneTurnResponse> => {
    if (turning) return { ok: false, error: 'A turn is already running.' }
    turning = true
    try {
      const { pack, logs } = current()
      const { state: raw, input } = request as { state: unknown; input: unknown }
      if (typeof input !== 'string' || input.trim().length === 0) return { ok: false, error: 'Say or do something first.' }
      const send = tell(event)
      const state = await recorded(GameStateSchema.parse(raw), send)
      const session = logs.sessionForTurn()
      const scene = state.scene
      // Scene ids are random and unique; the number makes the turn id read in order.
      const turnId = scene ? `${scene.id}-${scene.turns.length + 1}` : undefined
      try {
        const outcome = await runTurn(pack, state, input.trim(), turnLlm(settings.get()), send, { ...(turnId && { turnId }), ...(session && { log: session }), loreBudgets: settings.getLoreBudgets() })
        const details = logs.turn(outcome.trace, { location: scene!.locationId, cast: scene!.cast }) ?? detailsOf('', outcome.trace)
        // The turn is shown now; its bookkeeper reads it while the player does, and is logged when it is done.
        const last = outcome.state.scene!.turns.at(-1)!
        const now = settings.get()
        const done = bookkeepWithin(pack, state, { id: last.id, input: input.trim(), beats: last.beats, plan: outcome.plan }, bookkeeperLlm(now), bookkeeperWaitMs(now))
        void done.then((kept) => logs.bookkeeping(kept.trace, kept.late))
        record(last.id, done)
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

  ipcMain.handle(IPC.sceneEnd, async (event, raw: unknown): Promise<SceneEndResponse> => {
    if (turning) return { ok: false, error: 'A turn is still running.' }
    turning = true
    try {
      const { pack, logs } = current()
      const state = await recorded(GameStateSchema.parse(raw), tell(event))
      try {
        const { state: next, reports, trace } = await endScene(pack, state, summaryLlm(settings.get()))
        logs.sceneEnd(trace)
        const session = logs.current
        const details = { ...(session && { session }), end: summarized(trace) }
        recording = null
        return { ok: true, state: next, reports, details }
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

  // The first half of a scene's end, with the summary model (relationships §3; milestone 4c): every witness's
  // relationship call, and the ties settled from them. A failed call changes nothing for that witness and is logged;
  // the scene still ends.
  ipcMain.handle(IPC.sceneTies, async (event, raw: unknown): Promise<SceneTiesResponse> => {
    if (turning) return { ok: false, error: 'A turn is still running.' }
    turning = true
    try {
      const { pack, logs } = current()
      const state = await recorded(GameStateSchema.parse(raw), tell(event))
      const { state: next, trace } = await judgeScene(pack, state, summaryLlm(settings.get()))
      if (trace.calls.length > 0) logs.ties(trace)
      const session = logs.current
      return { ok: true, state: next, details: { ...(session && { session }), ties: summarized(trace) } }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    } finally {
      turning = false
    }
  })

  // Consolidation runs between scenes, after Next day's upkeep, with the summary model (memory §7; milestone 4b).
  ipcMain.handle(IPC.consolidate, async (_event, raw: unknown): Promise<ConsolidateResponse> => {
    if (turning) return { ok: false, error: 'A turn is still running.' }
    turning = true
    try {
      const { pack, logs } = current()
      const state = GameStateSchema.parse(raw)
      if (state.scene) return { ok: false, error: 'Memories are merged between scenes only.' }
      try {
        const { state: next, trace } = await consolidate(pack, state, summaryLlm(settings.get()))
        if (trace.groups.length > 0) logs.consolidation(trace)
        return { ok: true, state: next, merged: trace.groups.filter((g) => g.made).length }
      } catch (error) {
        logs.error('app', (error as Error).message, { ...(error instanceof TracedError && { calls: error.calls }) })
        throw error
      }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    } finally {
      turning = false
    }
  })

  ipcMain.handle(IPC.listSaves, () => (playing ? playing.saves.list() : []))
  // A save waits for the last turn's bookkeeper like the next turn does (milestone 4c, decision C), so it keeps the records.
  ipcMain.handle(IPC.saveGame, async (event, request: unknown): Promise<SaveResponse> => {
    try {
      const { slotId, state, name } = SaveRequestSchema.parse(request)
      return { ok: true, summary: current().saves.save(slotId, await recorded(state, tell(event)), new Date(), name) }
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
  ipcMain.handle(IPC.callText, (_event, session: unknown, callId: unknown) =>
    typeof session === 'string' && typeof callId === 'string' ? current().logs.call(session, callId) : null
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
