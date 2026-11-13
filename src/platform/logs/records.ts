import { createHash } from 'node:crypto'
import { isConfigured, profileFor, type LlmRole, type Settings } from '@llm'
import type { CallTrace, Prompt } from '@engine/core'
import type { SceneEndTrace } from '@engine/relationships'
import type { TurnTrace } from '@engine/scene'

/**
 * The log layout (milestone 2, A2): a folder per session, a file per concern, each file with one writer, joined by
 * id. These are the lines of each file.
 */
export const FILES = {
  session: 'session.json',
  turns: 'turns.jsonl',
  calls: 'calls.jsonl',
  prompts: 'prompts.jsonl',
  scenes: 'scenes.jsonl',
  flags: 'flags.jsonl',
  scores: 'scores.jsonl',
  errors: 'errors.jsonl'
} as const

/** The model a role used, never its key, headers or address. */
export interface RoleModel {
  profile: string
  model: string
  temperature?: number
}

/** `session.json`: who, what, when. The only file rewritten rather than appended to. */
export interface SessionRecord {
  id: string
  kind: 'play' | 'bench'
  pack: { id: string; version: string }
  engine: string
  /** A hash of the prompt templates, style guide, phrase lists and tone (`promptSources`). */
  prompts: string
  models: Record<string, RoleModel>
  startedAt: string
  /** Missing when the session didn't close cleanly. */
  endedAt?: string
  /** What the session started from: a save slot, a new game, or a bench scenario. */
  from?: string
  /** Bench sessions: the scenario, its options and the repeat number. */
  bench?: { run: string; scenario: string; repeat: number; seed: number; forceNatural?: number; watchFor: string; title: string; location: string }
}

/** `turns.jsonl`: the readable part of a turn trace; calls by id. */
export type TurnRecord = Omit<TurnTrace, 'calls'> & { calls: string[] }

/** `calls.jsonl`: a call with its prompt as section ids into `prompts.jsonl`. */
export type CallRecord = Omit<CallTrace, 'prompt'> & { prompt: { system: string[]; user: string[] } }

/** `prompts.jsonl`: each distinct prompt section once. */
export interface PromptRecord {
  id: string
  text: string
}

/** `scenes.jsonl`. */
export type SceneRecord =
  | { type: 'start'; sceneId: string; at: string; location: string; cast: string[] }
  | ({ type: 'end' } & Omit<SceneEndTrace, 'calls'> & { calls: string[] })

/** `errors.jsonl`: anything that went wrong, with the turn or scene it happened in. */
export interface ErrorRecord {
  at: string
  where: 'turn' | 'scene-end' | 'scorer' | 'app'
  message: string
  turnId?: string
  sceneId?: string
  /** Calls made before the failure, in `calls.jsonl`. */
  calls?: string[]
}

/**
 * Prompt sections: a prompt is cut before each Markdown heading that starts a paragraph, so the parts that repeat
 * every turn (style guide, character cards, location) are stored once. Joining the sections gives back the prompt
 * exactly.
 */
export const SECTION_BREAK = '\n\n'
export function sections(text: string): string[] {
  if (text.length === 0) return []
  return text.split(/\n\n(?=#{1,2} )/)
}
export const joinSections = (parts: string[]): string => parts.join(SECTION_BREAK)

export const sectionId = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** The prompt version: a short hash of the texts prompts are built from. */
export const promptVersion = (sources: string[]): string => createHash('sha256').update(sources.join('\u0000')).digest('hex').slice(0, 12)

/** A prompt as stored, and the sections it needs. */
export function splitPrompt(prompt: Prompt): { ref: CallRecord['prompt']; parts: PromptRecord[] } {
  const system = sections(prompt.system).map((text) => ({ id: sectionId(text), text }))
  const user = sections(prompt.user).map((text) => ({ id: sectionId(text), text }))
  return { ref: { system: system.map((s) => s.id), user: user.map((s) => s.id) }, parts: [...system, ...user] }
}

/** A session folder's name: local date and time, and a short random part (e.g. `2026-11-05_2003_a1b2`). */
export function sessionName(at: Date, random: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}${pad(at.getMinutes())}_${random}`
}

/**
 * The model each role will use, for `session.json`: the profile it goes to and that profile's model and
 * temperature. Keys and addresses are left out on purpose; this is the only way settings reach a log.
 */
export function roleModels(settings: Settings, roles: readonly LlmRole[] = ['director', 'writer', 'summary']): Record<string, RoleModel> {
  const models: Record<string, RoleModel> = {}
  for (const role of roles) {
    const id = profileFor(settings, role)
    if (isConfigured(settings[id])) models[role] = { profile: id, model: settings[id].model, temperature: settings[id].temperature }
  }
  if (isConfigured(settings.nsfw)) models['nsfw'] = { profile: 'nsfw', model: settings.nsfw.model, temperature: settings.nsfw.temperature }
  return models
}
