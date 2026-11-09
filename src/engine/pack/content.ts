import { z } from 'zod'
import { CharacterSchema, PlayerSchema, type Character, type Meters, type Player } from '@engine/characters'
import { rankCap, RulesetSchema, rulesetProblems, type Ruleset, type StatBlock } from '@engine/rules'
import { buildCodex, codexProblems, type CodexEntry, type CodexFile } from '@engine/codex'
import { LocationSchema, SettingSchema, settingProblems, speciesById, factionById, tierById, STANCE_LEVEL_COUNT, type Location, type Setting } from '@engine/world'
import { ENGINE_VERSION, PackManifestSchema, satisfies, type PackManifest } from './manifest'

/**
 * The pack's own words for things the engine says to the LLM or the player (`setting/phrases.json`): phrases its prose
 * over-uses, the words for the five stance levels, words that suggest prose is stating a stance, and the generic words
 * the name check ignores when comparing names.
 */
export const PhrasesSchema = z
  .object({
    overused: z.array(z.string().min(1)).default([]),
    /** Warmest first, exactly five when the setting has stances. */
    stanceWords: z.array(z.string().min(1)).default([]),
    stanceWarnings: z.array(z.string().min(1)).default([]),
    genericWords: z.array(z.string().min(1)).default([])
  })
  .strict()
  .default({ overused: [], stanceWords: [], stanceWarnings: [], genericWords: [] })
export type Vocabulary = Omit<z.infer<typeof PhrasesSchema>, 'overused'>

/** Everything one game is played with: a loaded, validated pack. */
export interface Pack {
  manifest: PackManifest
  ruleset: Ruleset
  setting: Setting
  /** The always-on world primer every scene prompt opens with. */
  primer: string
  /** Tone and style notes for the writer, in the pack's own words. */
  tone: string
  /** Phrases this world's prose over-uses, on top of the engine's own list. */
  phrases: string[]
  /** Stance words, stance warnings and generic words, from the same file. */
  vocabulary: Vocabulary
  /** Lore entries, from `codex/` (claude/lore-injection.md). */
  codex: CodexEntry[]
  characters: Character[]
  locations: Location[]
  player: Player
}

/** A pack's files as read from disk, before anything is checked. Each named so problems can say where they are. */
export interface PackFiles {
  manifest: unknown
  ruleset: unknown
  setting: unknown
  primer: string
  tone: string
  phrases?: unknown
  player: unknown
  characters: { file: string; data: unknown }[]
  locations: { file: string; data: unknown }[]
  /** Every `.md` file under `codex/`, by path relative to it. */
  codex: CodexFile[]
}

export type BuiltPack =
  | { ok: true; pack: Pack }
  /** The manifest is kept when it reads, so a pack picker can still show which pack is broken. */
  | { ok: false; problems: string[]; manifest?: PackManifest }

function parse<S extends z.ZodType>(schema: S, file: string, data: unknown, problems: string[]): z.infer<S> | undefined {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data
  for (const i of parsed.error.issues) problems.push(`${file}: ${i.path.join('.') || '(root)'}: ${i.message}`)
  return undefined
}

/**
 * The one step that turns a pack's files into a pack (architecture §12: overlays will slot in before it): every file
 * against its schema, then the ruleset and setting against themselves, then the content against both.
 */
export function buildPack(files: PackFiles): BuiltPack {
  const problems: string[] = []
  const manifest = parse(PackManifestSchema, 'pack.json', files.manifest, problems)
  const ruleset = parse(RulesetSchema, 'ruleset/ruleset.json', files.ruleset, problems)
  const setting = parse(SettingSchema, 'setting/setting.json', files.setting, problems)
  const words = parse(PhrasesSchema, 'setting/phrases.json', files.phrases, problems)
  const player = parse(PlayerSchema, 'player.json', files.player, problems)
  const characters = files.characters.flatMap((f) => parse(CharacterSchema, `characters/${f.file}`, f.data, problems) ?? [])
  const locations = files.locations.flatMap((f) => parse(LocationSchema, `locations/${f.file}`, f.data, problems) ?? [])
  const codex = buildCodex(files.codex)
  problems.push(...codex.problems)
  if (manifest && !satisfies(ENGINE_VERSION, manifest.engine)) problems.push(`pack.json: needs engine ${manifest.engine}; this is ${ENGINE_VERSION}`)
  if (ruleset) problems.push(...rulesetProblems(ruleset).map((p) => `ruleset/ruleset.json: ${p}`))
  if (setting) problems.push(...settingProblems(setting).map((p) => `setting/setting.json: ${p}`))
  if (!files.primer.trim()) problems.push('setting/primer.md: missing or empty')
  if (problems.length > 0 || !manifest || !ruleset || !setting || !player || !words) return { ok: false, problems, ...(manifest && { manifest }) }

  const { overused, ...vocabulary } = words
  const pack: Pack = { manifest, ruleset, setting, primer: files.primer.trim(), tone: files.tone.trim(), phrases: overused, vocabulary, codex: codex.entries, characters, locations, player }
  const cross = packProblems(pack)
  return cross.length > 0 ? { ok: false, problems: cross, manifest } : { ok: true, pack }
}

function meterProblems(r: Ruleset, what: string, meters: Meters): string[] {
  const ids = r.meters.list.map((m) => m.id)
  return [
    ...ids.filter((m) => !(m in meters)).map((m) => `${what} has no "${m}" meter`),
    ...Object.keys(meters).filter((m) => !ids.includes(m)).map((m) => `${what} has unknown meter "${m}"`),
    ...Object.entries(meters).filter(([, v]) => v < r.meters.min || v > r.meters.max).map(([m, v]) => `${what}'s ${m} ${v} is outside ${r.meters.min}–${r.meters.max}`)
  ]
}

function statProblems(r: Ruleset, who: string, stats: StatBlock): string[] {
  const problems: string[] = []
  const attributes = r.attributes.list.map((a) => a.id)
  for (const a of attributes) if (!(a in stats.attributes)) problems.push(`${who} has no "${a}" attribute`)
  for (const [a, v] of Object.entries(stats.attributes)) {
    if (!attributes.includes(a)) problems.push(`${who} has unknown attribute "${a}"`)
    else if (v < r.attributes.min || v > r.attributes.max) problems.push(`${who}'s ${a} ${v} is outside ${r.attributes.min}–${r.attributes.max}`)
  }
  if (stats.level < r.levels.min || stats.level > r.levels.max) problems.push(`${who}'s level ${stats.level} is outside ${r.levels.min}–${r.levels.max}`)
  for (const [skill, rank] of Object.entries(stats.skills)) {
    if (!r.skills.some((s) => s.id === skill)) problems.push(`${who} has unknown skill "${skill}"`)
    else if (rank > rankCap(r, stats.level)) problems.push(`${who}'s ${skill} rank ${rank} is above the cap for level ${stats.level}`)
  }
  return problems
}

/**
 * Problems that span files: duplicate ids, references to people, places, tiers, species, factions, skills or meters
 * the pack doesn't define, ranks above what a level allows, and an opening scene that can't start. Empty when sound.
 */
export function packProblems(pack: Pack): string[] {
  const { ruleset: r, setting: s } = pack
  const problems: string[] = []
  const ids = new Set<string>()
  const seen = (kind: string, id: string) => {
    if (ids.has(id)) problems.push(`${kind} id "${id}" is used twice`)
    ids.add(id)
  }
  for (const c of pack.characters) seen('character', c.id)
  for (const l of pack.locations) {
    seen('location', l.id)
    for (const w of l.walkOns) seen(`walk-on in ${l.id}`, w.id)
  }
  const characters = new Set(pack.characters.map((c) => c.id))
  const species = (who: string, id: string) => {
    if (!speciesById(s, id)) problems.push(`${who} is of unknown species "${id}"`)
  }

  for (const c of pack.characters) {
    species(c.id, c.species)
    if (c.faction && !factionById(s, c.faction)) problems.push(`${c.id} belongs to unknown faction "${c.faction}"`)
    if (c.level && !c.faction) problems.push(`${c.id} has a faction level but no faction`)
    if (c.rank && !c.level) problems.push(`${c.id} has a rank title but no faction level`)
    problems.push(...meterProblems(r, c.id, c.meters))
    if (c.stats) problems.push(...statProblems(r, c.id, c.stats))
    for (const rel of c.relations) {
      if (!characters.has(rel.to)) problems.push(`${c.id} has a relation to unknown character "${rel.to}"`)
      if (rel.to === c.id) problems.push(`${c.id} has a relation to themself`)
      problems.push(...meterProblems(r, `${c.id}'s relation to ${rel.to}`, rel.meters))
    }
  }
  for (const l of pack.locations) {
    if (!tierById(s, l.tier)) problems.push(`${l.id} is in unknown tier "${l.tier}"`)
    for (const w of l.walkOns) species(`walk-on ${w.id} in ${l.id}`, w.species)
  }
  species('the player', pack.player.species)

  const stanceWords = pack.vocabulary.stanceWords
  if (s.stances.length > 0 && stanceWords.length !== STANCE_LEVEL_COUNT) problems.push(`setting/phrases.json: stanceWords needs exactly ${STANCE_LEVEL_COUNT} words, warmest first, for the setting's stances`)
  for (const st of s.stances) if (!stanceWords.includes(st.stance)) problems.push(`setting/setting.json: the stance from "${st.from}" toward "${st.toward}" is "${st.stance}", which isn't a stance word`)
  problems.push(...codexProblems(pack.codex, { setting: s, characterIds: [...characters], locations: pack.locations, fullWords: r.codex.fullWords, stanceWarnings: pack.vocabulary.stanceWarnings }))
  problems.push(...statProblems(r, 'the player', pack.player.stats))

  const start = pack.manifest.start
  if (!pack.locations.some((l) => l.id === start.location)) problems.push(`pack.json: the opening scene is at unknown location "${start.location}"`)
  for (const id of start.cast) if (!characters.has(id)) problems.push(`pack.json: the opening cast names unknown character "${id}"`)
  return problems
}

export const characterById = (pack: Pack, id: string): Character | undefined => pack.characters.find((c) => c.id === id)
export const locationById = (pack: Pack, id: string): Location | undefined => pack.locations.find((l) => l.id === id)
