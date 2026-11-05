import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { IPC, type SceneEvent, type SceneTurnResponse, type TestConnectionResult } from '../shared/ipc'
import { GameStateSchema } from '../shared/model'
import { ListModelsRequestSchema, SettingsUpdateSchema, isConfigured, toView, LLM_PROFILE_IDS, type LlmProfileId } from '../shared/settings'
import type { Content } from '../shared/game/content'
import { chatCompletion, listModels } from './ai/openai'
import { loadContent } from './content/load'
import { turnLlm } from './scene/llm'
import { runTurn } from './scene/runTurn'
import { SettingsStore, type KeyCipher } from './settings/store'

/** Where content lives: beside the app when packaged, the repository's `content/` when run from source. */
function contentDir(): string {
  const root = app.isPackaged ? join(process.resourcesPath, 'content') : join(app.getAppPath(), 'content')
  return join(root, 'default')
}

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
    title: 'Neonpunk Nights',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  // electron-vite sets ELECTRON_RENDERER_URL when running the dev server.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

const profileId = (value: unknown): LlmProfileId => {
  if (!LLM_PROFILE_IDS.includes(value as LlmProfileId)) throw new Error(`Unknown profile "${String(value)}"`)
  return value as LlmProfileId
}

app.whenReady().then(() => {
  let content: Content
  try {
    content = loadContent(contentDir())
  } catch (error) {
    dialog.showErrorBox('The game content could not be loaded', (error as Error).message)
    app.quit()
    return
  }
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), keyCipher())

  ipcMain.handle(IPC.getContent, () => content)
  ipcMain.handle(IPC.getSettings, () => toView(settings.get()))
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
        messages: [{ role: 'user', content: 'Say hello to Spire City.' }],
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
      const { state: raw, input } = request as { state: unknown; input: unknown }
      const state = GameStateSchema.parse(raw)
      if (typeof input !== 'string' || input.trim().length === 0) return { ok: false, error: 'Say or do something first.' }
      const send = (sceneEvent: SceneEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC.sceneEvent, sceneEvent)
      }
      const outcome = await runTurn(content, state, input.trim(), turnLlm(settings.get(), state.scene?.nsfw ?? false), send)
      return {
        ok: true,
        state: outcome.state,
        beats: outcome.beats,
        checks: outcome.plan.checks.flatMap((c) => (c.line ? [c.line] : [])),
        calls: outcome.calls,
        corrections: outcome.corrections,
        rewrite: outcome.problems.map((p) => p.fix)
      }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    } finally {
      turning = false
    }
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
