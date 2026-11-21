// Adapted from Breedhaven University, src/main/settings/store.ts (GPL-3.0-only). See NOTICE.md.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { LLM_PROFILE_IDS, SettingsSchema, type LlmProfile, type Settings, type SettingsUpdate } from '@llm'
import { cleanLoreBudgets, type LoreBudgetOverrides } from '@engine/rules'
import { DEFAULT_PIPELINE, isPipeline, type Pipeline } from '@engine/scene'

/** Encrypts API keys at rest. Backed by Electron's safeStorage in the app. */
export interface KeyCipher {
  encrypt(plain: string): string
  decrypt(stored: string): string
}

type StoredProfile = Omit<LlmProfile, 'apiKey'> & { apiKey: string; apiKeyEncrypted: boolean }

/**
 * Persists settings as JSON: the LLM profiles, the extra folders to look for packs in, the lore budgets the player
 * set over the packs' own, and which pipeline makes the turns. Without a cipher, API keys are written in plain text.
 */
export class SettingsStore {
  private settings: Settings
  private packFolders: string[] = []
  /** Whether play is logged (milestone 2, A2). On until the game is public, so playtests always leave evidence. */
  private logging = true
  /** Lore budgets over every pack's defaults (milestone 3, task 10); a field left out uses the pack's. */
  private loreBudgets: LoreBudgetOverrides = {}
  /** Which pipeline makes the turns (Milestone 5 plan, task 3): `situation` until `scene` replaces it. */
  private pipeline: Pipeline = DEFAULT_PIPELINE

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

  getLogging(): boolean {
    return this.logging
  }

  setLogging(on: boolean): boolean {
    this.logging = on
    this.write()
    return this.logging
  }

  getPipeline(): Pipeline {
    return this.pipeline
  }

  /** Saves the pipeline the turns are made by; anything but a known pipeline leaves it as it was. Returns what was kept. */
  setPipeline(raw: unknown): Pipeline {
    if (typeof raw === 'string' && isPipeline(raw)) this.pipeline = raw
    this.write()
    return this.pipeline
  }

  getLoreBudgets(): LoreBudgetOverrides {
    return this.loreBudgets
  }

  /** Saves the player's lore budgets, cleaned (numbers only, rounded, within bounds). Returns what was kept. */
  setLoreBudgets(raw: unknown): LoreBudgetOverrides {
    this.loreBudgets = cleanLoreBudgets(raw).overrides
    this.write()
    return this.loreBudgets
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
      const logging = (raw as { logging?: unknown }).logging
      if (typeof logging === 'boolean') this.logging = logging
      // A hand-edited value out of bounds is brought back in rather than refused.
      this.loreBudgets = cleanLoreBudgets((raw as { loreBudgets?: unknown }).loreBudgets).overrides
      const pipeline = (raw as { pipeline?: unknown }).pipeline
      if (typeof pipeline === 'string' && isPipeline(pipeline)) this.pipeline = pipeline
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
    writeFileSync(this.path, JSON.stringify({ ...stored, packFolders: this.packFolders, logging: this.logging, loreBudgets: this.loreBudgets, pipeline: this.pipeline }, null, 2))
  }
}
