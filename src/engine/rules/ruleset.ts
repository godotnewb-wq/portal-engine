import { z } from 'zod'

/**
 * A pack's rules as data (architecture §5): the engine supplies the mechanics, the ruleset their parameters and
 * vocabulary. Packs never contain formulas or scripts; a different core mechanic is a new `resolution` strategy in
 * the engine.
 */

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'ids are lower-case words joined by hyphens')

export const RESOLUTION_STRATEGIES = ['d20-vs-dc'] as const

export const RulesetSchema = z.object({
  /** How a check is resolved. The engine ships one strategy for now. */
  resolution: z.enum(RESOLUTION_STRATEGIES),
  attributes: z.object({
    list: z.array(z.object({ id, name: z.string() })).min(1),
    min: z.number().int(),
    max: z.number().int(),
    /** The score of an average adult, used for anyone without a stat block yet. */
    average: z.number().int(),
    /** Modifier = floor((score − base) / divisor). */
    modifier: z.object({ base: z.number().int(), divisor: z.number().int().positive() })
  }),
  skills: z
    .array(
      z.object({
        id,
        name: z.string(),
        /** The attribute the skill usually rolls with. */
        attribute: id,
        /** One line for the director: what the skill is for. */
        description: z.string().default('')
      })
    )
    .min(1),
  ranks: z.object({
    max: z.number().int().positive(),
    /** The highest rank allowed up to each level, in rising order; the last entry covers every level above it. */
    capByLevel: z.array(z.object({ upTo: z.number().int().positive(), cap: z.number().int().nonnegative() })).min(1)
  }),
  levels: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
  /** The words the director may use for a check's difficulty, easiest first, and what each means. */
  difficulties: z.array(z.object({ word: z.string().min(1), dc: z.number().int() })).min(1),
  degrees: z.object({
    /** Beat the target by this much or more: a strong success. */
    strongMargin: z.number().int().positive(),
    /** Miss by up to this much: success at a cost. Miss by more: failure. */
    costMargin: z.number().int().nonnegative()
  }),
  criticals: z.object({
    /** A die showing this moves the result one step up… */
    hit: z.number().int(),
    /** …and this, one step down. */
    miss: z.number().int()
  }),
  /** How much a helper's feelings toward the one rolling make their help worth. */
  assists: z.object({
    /** The relationship meter that decides it, e.g. trust. */
    meter: id,
    /** The helper needs at least this rank in the skill. */
    minRank: z.number().int().nonnegative(),
    /** From this meter value, help adds `bonus`… */
    bonusFrom: z.number(),
    bonus: z.number().int(),
    /** …and from this one, it gives advantage instead. */
    advantageFrom: z.number()
  }),
  meters: z.object({
    /** The relationship meters every character keeps toward the player and toward each other. */
    list: z.array(z.object({ id, name: z.string(), description: z.string() })).min(1),
    min: z.number(),
    max: z.number()
  }),
  /** The words a summary judges each meter's change in, worst to best, and what each moves a meter by. */
  wordScale: z.array(z.object({ word: z.string().min(1), value: z.number() })).min(2),
  relations: z.object({
    /** Where a relation starts when two characters first share a scene. */
    start: z.record(id, z.number()),
    /**
     * Labels by meter bands, checked in order; the first that fits wins. A band fits when every `min` is met and every
     * `max` is not exceeded. A seeded label is kept until the meters move into another band.
     */
    bands: z.array(z.object({ label: z.string(), min: z.record(id, z.number()).default({}), max: z.record(id, z.number()).default({}) })),
    otherwise: z.string()
  }),
  /**
   * How hard a character's aim for the scene presses on them, weakest first (e.g. "idle", "keen", "driven"). The
   * director picks a word each turn; the weakest keeps the aim out of the writer's brief, the strongest makes it
   * what drives them (claude/scene-system-redesign.md §5.3).
   */
  pressures: z.array(z.string().min(1)).min(2),
  /**
   * Codex tuning (claude/lore-injection.md §4–5): the most words an entry's full text may have, the rough token
   * budgets for the scene-scoped and triggered layers, and the most lore lines the director may give the writer a
   * turn (generous starting points, tuned from the bench). The player can override the budgets in Settings
   * (`loreBudgets`); these are the pack's defaults.
   */
  codex: z
    .object({
      fullWords: z.number().int().positive().default(120),
      sceneTokens: z.number().int().min(0).default(1200),
      triggeredTokens: z.number().int().min(0).default(800),
      loreLines: z.number().int().min(0).default(3),
      /**
       * Per character, the extra estimated tokens the director's sheet may spend showing secrets in full rather than as
       * short cues: one budget for secrets linked to the codex, one for personal secrets (claude/lore-injection.md §7.1).
       */
      linkedSecretTokens: z.number().int().min(0).default(200),
      personalSecretTokens: z.number().int().min(0).default(100),
      /** An authored character starting with more secrets than this gets an authoring warning. */
      startingSecrets: z.number().int().min(0).default(3)
    })
    .default({ fullWords: 120, sceneTokens: 1200, triggeredTokens: 800, loreLines: 3, linkedSecretTokens: 200, personalSecretTokens: 100, startingSecrets: 3 })
})
export type Ruleset = z.infer<typeof RulesetSchema>

/** Problems inside a ruleset that its schema can't see: references between its own lists. */
export function rulesetProblems(r: Ruleset): string[] {
  const problems: string[] = []
  const unique = (what: string, ids: string[]) => {
    for (const x of ids.filter((x, i) => ids.indexOf(x) !== i)) problems.push(`${what} "${x}" is defined twice`)
  }
  const attributes = r.attributes.list.map((a) => a.id)
  const meters = r.meters.list.map((m) => m.id)
  unique('attribute', attributes)
  unique('skill', r.skills.map((s) => s.id))
  unique('difficulty', r.difficulties.map((d) => d.word))
  unique('meter', meters)
  unique('scale word', r.wordScale.map((w) => w.word))
  unique('pressure word', r.pressures)
  for (const s of r.skills) if (!attributes.includes(s.attribute)) problems.push(`skill "${s.id}" uses unknown attribute "${s.attribute}"`)
  if (!meters.includes(r.assists.meter)) problems.push(`assists use unknown meter "${r.assists.meter}"`)
  for (const m of meters) if (!(m in r.relations.start)) problems.push(`relations.start has no value for meter "${m}"`)
  for (const m of Object.keys(r.relations.start)) if (!meters.includes(m)) problems.push(`relations.start names unknown meter "${m}"`)
  for (const band of r.relations.bands) {
    for (const m of [...Object.keys(band.min), ...Object.keys(band.max)]) if (!meters.includes(m)) problems.push(`band "${band.label}" names unknown meter "${m}"`)
  }
  if (!r.wordScale.some((w) => w.value === 0)) problems.push('the word scale needs a word worth 0 (no change)')
  if (r.attributes.min > r.attributes.max) problems.push('attributes.min is above attributes.max')
  return problems
}

export const meterIds = (r: Ruleset): string[] => r.meters.list.map((m) => m.id)
export const skillById = (r: Ruleset, id: string) => r.skills.find((s) => s.id === id)
export const difficultyDc = (r: Ruleset, word: string): number | undefined => r.difficulties.find((d) => d.word === word)?.dc

/** The scale word worth nothing: what a summary means when it leaves a meter out. */
export const neutralWord = (r: Ruleset): string => r.wordScale.find((w) => w.value === 0)!.word
