// Adapted from Breedhaven University, src/main/settings/store.ts (GPL-3.0-only). See NOTICE.md.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { LLM_PROFILE_IDS, SettingsSchema, type LlmProfile, type Settings, type SettingsUpdate } from '@llm'

/** Encrypts API keys at rest. Backed by Electron's safeStorage in the app. */
export interface KeyCipher {
  encrypt(plain: string): string
  decrypt(stored: string): string
}

type StoredProfile = Omit<LlmProfile, 'apiKey'> & { apiKey: string; apiKeyEncrypted: boolean }

/**
 * Persists settings as JSON: the LLM profiles, and the extra folders to look for packs in. Without a cipher, API keys
 * are written in plain text.
 */
export class SettingsStore {
  private settings: Settings
  private packFolders: string[] = []

  constructor(
    private readonly path: string,
    private readonly cipher?: KeyCipher
  ) {
    this.settings = this.read()
  }

  get(): Settings {
    return this.settings
  }

  /** Extra folders to look for packs in (architecture §9), for pack authors working outside the app-data folder. */
  getPackFolders(): string[] {
    return this.packFolders
  }

  setPackFolders(folders: string[]): string[] {
    this.packFolders = [...new Set(folders.map((f) => f.trim()).filter((f) => f.length > 0))]
    this.write()
    return this.packFolders
  }

  update(update: SettingsUpdate): Settings {
    const next: Record<string, unknown> = {}
    for (const id of LLM_PROFILE_IDS) {
      const { apiKey, ...rest } = update[id]
      next[id] = { ...rest, apiKey: apiKey ?? this.settings[id].apiKey }
    }
    this.settings = SettingsSchema.parse(next)
    this.write()
    return this.settings
  }

  private read(): Settings {
    let raw: Record<string, Partial<StoredProfile> | undefined>
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8'))
      const folders = (raw as { packFolders?: unknown }).packFolders
      if (Array.isArray(folders)) this.packFolders = folders.filter((f): f is string => typeof f === 'string')
    } catch {
      // Missing or unreadable file: start from defaults.
      return SettingsSchema.parse({})
    }
    const profiles: Record<string, unknown> = {}
    for (const id of LLM_PROFILE_IDS) {
      if (!raw[id]) continue
      const { apiKeyEncrypted, ...profile } = raw[id]
      if (apiKeyEncrypted) profile.apiKey = this.decrypt(profile.apiKey ?? '')
      profiles[id] = profile
    }
    const parsed = SettingsSchema.safeParse(profiles)
    return parsed.success ? parsed.data : SettingsSchema.parse({})
  }

  private decrypt(stored: string): string {
    try {
      return this.cipher ? this.cipher.decrypt(stored) : ''
    } catch {
      // Key was encrypted on another machine or user account; it has to be re-entered.
      return ''
    }
  }

  private write(): void {
    const stored: Record<string, StoredProfile> = {}
    for (const id of LLM_PROFILE_IDS) {
      const profile = this.settings[id]
      const encrypt = this.cipher !== undefined && profile.apiKey.length > 0
      stored[id] = { ...profile, apiKey: encrypt ? this.cipher!.encrypt(profile.apiKey) : profile.apiKey, apiKeyEncrypted: encrypt }
    }
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify({ ...stored, packFolders: this.packFolders }, null, 2))
  }
}
