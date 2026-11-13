import { z } from 'zod'
import { PeopleRulesSchema, TiesRulesSchema, peopleProblems } from './people'

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
  /**
   * Assists (core rules §1): only companions present help, each when their assist gate (people.gates.assist, shifted
   * by their layers and motives) is met toward whoever rolls and they have at least `minRank` in the skill. The bonus
   * goes by how many help: `bonus[n]` for n helpers, the last entry for more. Never advantage.
   */
  assists: z.object({
    minRank: z.number().int().nonnegative(),
    bonus: z.array(z.number().int().min(0)).min(2)
  }),
  meters: z.object({
    /**
     * The relationship meters every character keeps toward the player and toward each other (relationships §1). Each
     * has word bands, lowest first: prompts and the summary screen show the band a value falls in, never the number.
     */
    list: z
      .array(
        z.object({
          id,
          name: z.string(),
          /** What the meter means, in a few words; prompts use it so the LLM keeps the meters apart. */
          description: z.string(),
          /** From each `from` up to the next band's: lowest first, the first starting at `min`. */
          bands: z.array(z.object({ from: z.number(), word: z.string().min(1) })).min(1)
        })
      )
      .min(1),
    /** Signed: below `neutral` is a real feeling the other way (distrust, disapproval, aversion), not "not much yet". */
    min: z.number(),
    max: z.number(),
    /** No settled feeling either way: where a meter with no value reads. */
    neutral: z.number()
  }),
  /** The words a summary judges each meter's change in, worst to best, and what each moves a meter by. */
  wordScale: z.array(z.object({ word: z.string().min(1), value: z.number() })).min(2),
  relations: z.object({
    /** Where a relation starts when two characters first share a scene: a true stranger. */
    start: z.record(id, z.number())
  }),
  /** How a pack describes people: layers, emotions, gates, motives, growth words, haunt limits (npc design §11). */
  people: PeopleRulesSchema,
  /** Relationship tags (relationships §3). */
  ties: TiesRulesSchema,
  /** The party (party §4): how many companions the player can have at once. */
  party: z.object({ max: z.number().int().min(0) }).default({ max: 3 }),
  /**
   * Memory tuning (memory §3, §11): how many memories a character brings to a scene, by tier. A Major Character keeps
   * the same budget in the party or out of it.
   */
  memory: z
    .object({ recall: z.object({ recurring: z.number().int().min(0), major: z.number().int().min(0) }) })
    .default({ recall: { recurring: 4, major: 8 } }),
  /**
   * How hard a character's aim for the scene presses on them, weakest first (e.g. "idle", "keen", "driven"). The
   * director picks a word each turn; the weakest keeps the aim out of the writer's brief, the strongest makes it
   * what drives them (scene system redesign.md §5.3).
   */
  pressures: z.array(z.string().min(1)).min(2),
  /**
   * Lines the game narrates itself, in the pack's words, with `{name}` for a character's first name. `departure`: a
   * planned departure the turn's kept prose doesn't show (milestone 3.6, task 6a), so nobody vanishes without a word.
   */
  narration: z.object({ departure: z.string().min(1) }),
  /**
   * Codex tuning (lore injection.md §4–5): the most words an entry's full text may have, the rough token
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
       * short cues: one budget for secrets linked to the codex, one for personal secrets (lore injection.md §7.1).
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
  if (r.assists.bonus[0] !== 0) problems.push('assists.bonus[0] is for no helpers and must be 0')
  for (const m of meters) if (!(m in r.relations.start)) problems.push(`relations.start has no value for meter "${m}"`)
  for (const m of Object.keys(r.relations.start)) if (!meters.includes(m)) problems.push(`relations.start names unknown meter "${m}"`)
  const inRange = (v: number) => v >= r.meters.min && v <= r.meters.max
  if (r.meters.min >= r.meters.max) problems.push('meters.min is not below meters.max')
  if (!inRange(r.meters.neutral)) problems.push(`meters.neutral ${r.meters.neutral} is outside ${r.meters.min}–${r.meters.max}`)
  for (const [m, v] of Object.entries(r.relations.start)) if (!inRange(v)) problems.push(`relations.start for "${m}" is outside ${r.meters.min}–${r.meters.max}`)
  for (const m of r.meters.list) {
    if (m.bands[0]!.from !== r.meters.min) problems.push(`meter "${m.id}"'s first band must start at ${r.meters.min}`)
    m.bands.forEach((b, i) => {
      if (!inRange(b.from)) problems.push(`meter "${m.id}"'s band "${b.word}" starts outside ${r.meters.min}–${r.meters.max}`)
      if (i > 0 && b.from <= m.bands[i - 1]!.from) problems.push(`meter "${m.id}"'s bands must rise: "${b.word}" starts at or below the one before`)
    })
  }
  if (!r.wordScale.some((w) => w.value === 0)) problems.push('the word scale needs a word worth 0 (no change)')
  if (r.attributes.min > r.attributes.max) problems.push('attributes.min is above attributes.max')
  problems.push(...peopleProblems(r.people, r.ties, meters))
  for (const [tier, f] of Object.entries(r.people.forms)) {
    if (!['recurring', 'major'].includes(tier)) problems.push(`people.forms names unknown tier "${tier}"`)
    for (const [k, [lo, hi]] of Object.entries({ haunts: f.haunts, axes: f.axes, values: f.values, tells: f.tells })) if (lo > hi) problems.push(`people.forms.${tier}.${k} must be low first`)
  }
  if (!r.narration.departure.includes('{name}')) problems.push('narration.departure needs {name}, for who leaves')
  return problems
}

export const meterIds = (r: Ruleset): string[] => r.meters.list.map((m) => m.id)

/** The word band a meter's value falls in (relationships §1); a value outside the range reads as the nearest end. */
export function bandWord(r: Ruleset, meter: string, value: number): string {
  const m = r.meters.list.find((x) => x.id === meter)
  if (!m) return String(value)
  return [...m.bands].reverse().find((b) => value >= b.from)?.word ?? m.bands[0]!.word
}

/** A character's feelings as prompts show them, in bands: "approval: approves; trust: undecided; interest: intrigued". */
export const meterWords = (r: Ruleset, m: Record<string, number>): string =>
  r.meters.list.map((x) => `${x.id}: ${bandWord(r, x.id, m[x.id] ?? r.meters.neutral)}`).join('; ')
export const skillById = (r: Ruleset, id: string) => r.skills.find((s) => s.id === id)
export const difficultyDc = (r: Ruleset, word: string): number | undefined => r.difficulties.find((d) => d.word === word)?.dc

/** The scale word worth nothing: what a summary means when it leaves a meter out. */
export const neutralWord = (r: Ruleset): string => r.wordScale.find((w) => w.value === 0)!.word
