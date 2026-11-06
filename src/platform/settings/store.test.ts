import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LlmProfileSchema, toView } from '@llm'
import { SettingsStore, type KeyCipher } from './store'

const cipher: KeyCipher = { encrypt: (p) => `enc:${p}`, decrypt: (s) => s.replace(/^enc:/, '') }
const pathIn = () => join(mkdtempSync(join(tmpdir(), 'npn-settings-')), 'settings.json')
const blank = () => LlmProfileSchema.omit({ apiKey: true }).parse({})

describe('SettingsStore', () => {
  it('starts from per-role defaults when there is no file', () => {
    const settings = new SettingsStore(pathIn()).get()
    expect(settings.director.temperature).toBe(0.3)
    expect(settings.writer.temperature).toBe(0.9)
    expect(settings.summary.temperature).toBe(0.2)
  })

  it('encrypts keys at rest, keeps a saved key when none is sent, and reads it back', () => {
    const path = pathIn()
    const store = new SettingsStore(path, cipher)
    store.update({ director: { ...blank(), model: 'fast', apiKey: 'sk-d' }, writer: blank(), summary: blank(), nsfw: blank() })
    store.update({ director: { ...blank(), model: 'faster' }, writer: blank(), summary: blank(), nsfw: blank() })
    expect(readFileSync(path, 'utf8')).toContain('enc:sk-d')
    const again = new SettingsStore(path, cipher).get()
    expect(again.director).toMatchObject({ model: 'faster', apiKey: 'sk-d' })
    expect(toView(again).director.hasApiKey).toBe(true)
    expect('apiKey' in toView(again).director).toBe(false)
  })
})
