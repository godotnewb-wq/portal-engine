import { z } from 'zod'
import { IdSchema } from '@engine/core'

/**
 * Everyone's standing in a faction is one of four levels, the same in every pack (lore-injection §7): connected but not
 * inside, a member, senior and relied on, or leading. Titles ("handler", "deacon") are free text on the character.
 */
export const FACTION_LEVELS = ['affiliated', 'member', 'trusted', 'leadership'] as const
export const FactionLevelSchema = z.enum(FACTION_LEVELS)
export type FactionLevel = z.infer<typeof FactionLevelSchema>
export const levelRank = (l: FactionLevel) => FACTION_LEVELS.indexOf(l)

/**
 * A sub-group's standing counts one level lower in its parent, and never above trusted: the head of one House isn't
 * the head of all the Houses. Affiliated in a sub-group counts for nothing in the parent.
 */
export function parentLevel(l: FactionLevel): FactionLevel | undefined {
  const i = Math.min(levelRank(l) - 1, levelRank('trusted'))
  return i < 0 ? undefined : FACTION_LEVELS[i]
}

/** Stances between factions have five levels, warmest first; each pack names them in its own words. */
export const STANCE_LEVEL_COUNT = 5

/**
 * A pack's world as data (architecture §5): its name, the tiers or regions places belong to, its peoples, factions
 * and currency. The engine names none of these; prompts and checks read them from here.
 */
export const SettingSchema = z.object({
  /** What the world is called in prompts, e.g. a city's name. */
  name: z.string().min(1),
  /** The wider world it sits in, if any (a planet, a continent). */
  world: z.string().optional(),
  /** Regions or tiers a location belongs to, in the order the setting lists them. */
  tiers: z
    .array(
      z.object({
        id: IdSchema,
        name: z.string(),
        /** What it's like, for prompts. */
        feel: z.string().default(''),
        /** What makes it dangerous, for prompts. */
        danger: z.string().default('')
      })
    )
    .min(1),
  /** Peoples. A character's species must be one of these. */
  species: z
    .array(
      z.object({
        id: IdSchema,
        name: z.string(),
        /** Fixed drawable traits, for art and description. */
        drawable: z.string().default(''),
        /** A color for placeholder sprites until art exists. */
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
      })
    )
    .min(1),
  /** Factions. A character's faction, if any, must be one of these. */
  factions: z
    .array(
      z.object({
        id: IdSchema,
        name: z.string(),
        summary: z.string().default(''),
        /** A sub-group with an identity of its own names the faction it belongs to; membership rolls up to it. */
        parent: IdSchema.optional()
      })
    )
    .default([]),
  /**
   * Official stances, one way, from one faction toward another, in the pack's stance words. Only the ones that matter
   * are written: a faction with none toward another has none, and nothing is mirrored from the other side.
   */
  stances: z.array(z.object({ from: IdSchema, toward: IdSchema, stance: z.string().min(1) })).default([]),
  currency: z.object({ name: z.string(), note: z.string().default('') }).optional()
})
export type Setting = z.infer<typeof SettingSchema>

export const tierById = (s: Setting, id: string) => s.tiers.find((t) => t.id === id)
export const speciesById = (s: Setting, id: string) => s.species.find((x) => x.id === id)
export const factionById = (s: Setting, id: string) => s.factions.find((f) => f.id === id)

/** A faction and the factions it belongs to, nearest first: a sub-group, then its parent. */
export function factionChain(s: Setting, id: string): Setting['factions'] {
  const chain: Setting['factions'] = []
  for (let f = factionById(s, id); f && !chain.includes(f); f = f.parent ? factionById(s, f.parent) : undefined) chain.push(f)
  return chain
}

/** Problems inside a setting its schema can't see: ids used twice, sub-groups of nothing, stances between strangers. */
export function settingProblems(s: Setting): string[] {
  const problems: string[] = []
  for (const [what, ids] of [
    ['tier', s.tiers.map((t) => t.id)],
    ['species', s.species.map((x) => x.id)],
    ['faction', s.factions.map((f) => f.id)]
  ] as const) {
    for (const x of ids.filter((x, i) => ids.indexOf(x) !== i)) problems.push(`${what} "${x}" is defined twice`)
  }
  for (const f of s.factions) {
    if (!f.parent) continue
    if (!factionById(s, f.parent)) problems.push(`faction "${f.id}" is a sub-group of unknown faction "${f.parent}"`)
    else if (factionChain(s, f.id).at(-1)?.parent) problems.push(`faction "${f.id}" is part of a loop of sub-groups`)
  }
  const pairs = new Set<string>()
  for (const st of s.stances) {
    for (const id of [st.from, st.toward]) if (!factionById(s, id)) problems.push(`a stance names unknown faction "${id}"`)
    if (st.from === st.toward) problems.push(`faction "${st.from}" has a stance toward itself`)
    const key = `${st.from}>${st.toward}`
    if (pairs.has(key)) problems.push(`the stance from "${st.from}" toward "${st.toward}" is written twice`)
    pairs.add(key)
  }
  return problems
}
