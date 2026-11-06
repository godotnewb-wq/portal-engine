import { z } from 'zod'
import { IdSchema } from '@engine/core'

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
  factions: z.array(z.object({ id: IdSchema, name: z.string(), summary: z.string().default('') })).default([]),
  currency: z.object({ name: z.string(), note: z.string().default('') }).optional()
})
export type Setting = z.infer<typeof SettingSchema>

export const tierById = (s: Setting, id: string) => s.tiers.find((t) => t.id === id)
export const speciesById = (s: Setting, id: string) => s.species.find((x) => x.id === id)
export const factionById = (s: Setting, id: string) => s.factions.find((f) => f.id === id)

/** Problems inside a setting its schema can't see: ids used twice. */
export function settingProblems(s: Setting): string[] {
  const problems: string[] = []
  for (const [what, ids] of [
    ['tier', s.tiers.map((t) => t.id)],
    ['species', s.species.map((x) => x.id)],
    ['faction', s.factions.map((f) => f.id)]
  ] as const) {
    for (const x of ids.filter((x, i) => ids.indexOf(x) !== i)) problems.push(`${what} "${x}" is defined twice`)
  }
  return problems
}
