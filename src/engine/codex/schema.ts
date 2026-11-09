import { z } from 'zod'
import { FACTION_LEVELS, type FactionLevel } from '@engine/world'

/**
 * What a codex entry is about. Locations form the map tree (layer 1 → 2 → 3, read from the path); the rest are
 * grouped by folder. The primer isn't an entry: it's the pack's `setting/primer.md`, part of the stage.
 */
export const CODEX_KINDS = ['location', 'faction', 'species-culture', 'species-drawable', 'philosophy', 'concept', 'event', 'world'] as const
export type CodexKind = (typeof CODEX_KINDS)[number]

/** Who may know an entry: everyone, people in certain circles, or only those who hold it as a secret. */
export const KNOWLEDGE = ['common', 'circles', 'secret'] as const
export type Knowledge = (typeof KNOWLEDGE)[number]

/** The LLM calls an entry may reach. */
export const AUDIENCES = ['director', 'writer', 'chronicler', 'drafting', 'summary', 'message'] as const
export type Audience = (typeof AUDIENCES)[number]

/** Where an entry came from: written in the pack, or added during a playthrough (later milestones). */
export const ORIGINS = ['authored', 'chronicler', 'scene'] as const

/** The top-level folders under `codex/`, and the kinds an entry in each may be. */
export const CODEX_FOLDERS: Record<string, { prefix: string; kinds: readonly CodexKind[] }> = {
  locations: { prefix: 'location', kinds: ['location'] },
  factions: { prefix: 'faction', kinds: ['faction'] },
  species: { prefix: 'species', kinds: ['species-culture', 'species-drawable'] },
  philosophies: { prefix: 'philosophy', kinds: ['philosophy'] },
  concepts: { prefix: 'concept', kinds: ['concept'] },
  events: { prefix: 'event', kinds: ['event'] },
  world: { prefix: 'world', kinds: ['world'] }
}

/** How deep the map tree goes: tier, region, place. */
export const MAX_LOCATION_LAYER = 3

/**
 * One way of saying who counts, in `circle`, `also` and `known-by`:
 * - `<faction> [level+]` — a faction (or sub-group) at that level or above (member+ when no level is given);
 * - `occupation <words>`, `tier <id>`, `species <id>`, `character <id>`.
 */
export type Selector =
  | { by: 'faction'; faction: string; level: FactionLevel }
  | { by: 'occupation'; occupation: string }
  | { by: 'tier'; tier: string }
  | { by: 'species'; species: string }
  | { by: 'character'; character: string }

const SELECTOR_WORDS = ['occupation', 'tier', 'species', 'character'] as const

export function parseSelector(text: string): Selector | string {
  const words = text.trim().split(/\s+/)
  const [first, ...rest] = words
  if (!first) return 'an empty selector'
  if ((SELECTOR_WORDS as readonly string[]).includes(first)) {
    const what = rest.join(' ').trim()
    if (!what) return `"${first}" needs a value`
    const by = first as (typeof SELECTOR_WORDS)[number]
    if (by === 'occupation') return { by, occupation: what.toLowerCase() }
    if (by === 'tier') return { by, tier: what }
    if (by === 'species') return { by, species: what }
    return { by, character: what }
  }
  const faction = first === 'faction' ? rest.shift() : first
  if (!faction) return '"faction" needs a value'
  if (rest.length > 1) return `"${text}" has too many words`
  let level: FactionLevel = 'member'
  if (rest[0]) {
    const m = rest[0].match(/^([a-z]+)\+$/)
    if (!m || !(FACTION_LEVELS as readonly string[]).includes(m[1]!)) return `"${rest[0]}" isn't a level (${FACTION_LEVELS.map((l) => `${l}+`).join(', ')})`
    level = m[1] as FactionLevel
  }
  return { by: 'faction', faction, level }
}

export const selectorText = (s: Selector): string =>
  s.by === 'faction' ? `${s.faction} ${s.level}+` : `${s.by} ${s.by === 'occupation' ? s.occupation : s.by === 'tier' ? s.tier : s.by === 'species' ? s.species : s.character}`

const list = z.array(z.string().min(1)).default([])

/** The header fields as written (kebab-case keys), before selectors are read. */
export const EntryHeaderSchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(CODEX_KINDS),
    keywords: list,
    aliases: list,
    summary: z.string().min(1),
    stage: z.string().min(1).optional(),
    knowledge: z.enum(KNOWLEDGE).default('common'),
    circle: z.string().min(1).optional(),
    also: list,
    'known-by': list,
    cap: z.coerce.number().int().positive().optional(),
    audience: z.array(z.enum(AUDIENCES)).optional(),
    belief: z.boolean().default(false),
    related: list,
    source: z.string().min(1).optional(),
    origin: z.enum(ORIGINS).default('authored'),
    'save-scoped': z.boolean().default(false),
    expires: z.string().min(1).optional()
  })
  .strict()

/** A codex entry, loaded and read. */
export interface CodexEntry {
  /** From the file's path: `factions/guild/main.md` → `faction.guild`. */
  id: string
  /** The file it was read from, relative to `codex/`. */
  file: string
  name: string
  kind: CodexKind
  keywords: string[]
  aliases: string[]
  summary: string
  /** The body: a short paragraph written as prompt text. */
  full: string
  audience: Audience[]
  knowledge: Knowledge
  /** Circles entries: who's inside (defaults to the entry's own faction, member and above). */
  circle?: Selector
  /** Circles entries: outsiders who also count. */
  also: Selector[]
  /** Secret entries: who may hold it, and at most how many characters. */
  knownBy: Selector[]
  cap?: number
  belief: boolean
  related: string[]
  /** The one-line public version that goes on the stage. */
  stage?: string
  source?: string
  origin: (typeof ORIGINS)[number]
  saveScoped: boolean
  expires?: string
  /** Locations: 1 tier, 2 region, 3 place. */
  layer?: number
  /** Faction entries: the faction (or sub-group) the entry belongs to. */
  faction?: string
}
