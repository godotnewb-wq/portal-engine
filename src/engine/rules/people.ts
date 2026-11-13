import { z } from 'zod'

/**
 * The words a pack describes people in (npc design §3–8, §11; relationships §3): personality axes, attachment, values,
 * moral foundations, emotions and masking, the requirement ladder, gates and their links, motives, growth words,
 * haunt limits and relationship tags. The engine knows only the shapes; every word and number is the pack's.
 */

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'ids are lower-case words joined by hyphens')
const word = z.string().min(1)

/** A scale of named stages between two poles, lowest first, e.g. five stages from "ruthless" to "principled". */
export const AxisSchema = z.object({
  id,
  name: z.string().min(1),
  stages: z.array(word).min(2),
  /** What it mainly drives, for authors and the director. */
  drives: z.string().default('')
})
export type Axis = z.infer<typeof AxisSchema>

/** A requirement on a meter, as a word on the ladder (npc design §6). */
const MeterWords = z.record(id, word)

/** A default shift of a gate requirement when a character's card has a layer entry (npc design §6, How a requirement is worked out). */
export const LinkSchema = z
  .object({
    /** The layer entry that triggers it: an axis or attachment stage, or a value at a strength. */
    axis: id.optional(),
    stage: word.optional(),
    value: id.optional(),
    strength: word.optional(),
    /** The gated action and meter it shifts, and by how many rungs (up is stricter). */
    action: id,
    meter: id,
    shift: z.number().int()
  })
  .refine((l) => (l.axis ? !!l.stage && !l.value : !!l.value && !!l.strength), { message: 'a link names an axis and a stage, or a value and a strength' })
export type Link = z.infer<typeof LinkSchema>

export const PeopleRulesSchema = z.object({
  /** Age stages, youngest first (npc design §3), and which of them the child guard covers. */
  ages: z.object({ stages: z.array(id).min(1), minors: z.array(id).default([]) }),
  /** Personality axes (§4.1). A card lists only those that matter; an unlisted axis counts as its middle stage. */
  axes: z.array(AxisSchema).min(1),
  /** Attachment axes (§4.2), the same shape. */
  attachment: z.array(AxisSchema).default([]),
  /** The values a card can hold (§4.3), each in a group; and the strength words, weakest first. */
  values: z.object({
    list: z.array(z.object({ id, name: z.string().min(1), group: id })).min(1),
    strengths: z.array(word).min(1)
  }),
  /** Moral foundations (§4.4) and the sensitivity words, least first. */
  foundations: z.object({ list: z.array(z.object({ id, name: z.string().min(1) })).min(1), sensitivities: z.array(word).min(1) }),
  /**
   * Emotions (§7): core families, which carry the systems, and shades, the words prompts use. A shade can belong to
   * more than one family. `intensity` is its typical range on 1–5. A mood-only family never becomes aftermath and
   * needs no masking or display line.
   */
  emotions: z.object({
    families: z.array(z.object({ id, name: z.string().min(1), moodOnly: z.boolean().default(false) })).min(1),
    shades: z.array(z.object({ word, families: z.array(id).min(1), intensity: z.tuple([z.number().int(), z.number().int()]) })).min(1)
  }),
  /**
   * Masking (§7): the words, least first (their position is the amount masked), and the default for each stage of the
   * axis that sets it (Composure, in the design's terms).
   */
  masking: z.object({ levels: z.array(word).min(2), axis: id, byStage: z.record(word, word) }),
  /**
   * The requirement ladder (§6), loosest first: the first rung has no requirement (`min` left out), the last is
   * `blocked`, and the rungs between need a meter at `min` or above.
   */
  ladder: z.array(z.object({ word, min: z.number().int().optional(), blocked: z.boolean().default(false) })).min(3),
  /** Default requirements per gated action (e.g. assist), as ladder words per meter. */
  gates: z.record(id, MeterWords).default({}),
  /** Default link shifts from layer entries (§6). */
  links: z.array(LinkSchema).default([]),
  /**
   * Motives (§6): types, each with the lowest rung it can push each meter's requirement to (`floors`; left out, it
   * doesn't shift at all) and whether it shifts the assist gate; strength words with their steps; the most a
   * character can hold.
   */
  motives: z.object({
    types: z.array(z.object({ id, floors: MeterWords.optional(), shiftsAssist: z.boolean().default(true) })).min(1),
    strengths: z.array(z.object({ word, steps: z.number().int().min(0) })).min(1),
    max: z.number().int().min(1)
  }),
  /** Growth words (§8): how easily a character changes, and per-field locks. Their numbers come with growth (milestone 9). */
  malleability: z.array(word).min(1),
  fieldLocks: z.array(word).min(1),
  /** How many haunts a card may list, by tier (§3). */
  haunts: z.record(id, z.object({ min: z.number().int().min(0), max: z.number().int().min(0) })).default({})
})
export type PeopleRules = z.infer<typeof PeopleRulesSchema>

/**
 * Relationship tags (relationships §3): a fixed list, each with its counterpart (itself when symmetric), display words
 * a card chooses between, whether it may be one-sided, and whether it is family (never removed; counts toward the
 * limit like any other). `max`: the most tags one character holds toward one person.
 */
export const TiesRulesSchema = z.object({
  max: z.number().int().min(1),
  groups: z.array(z.object({ id, name: z.string().min(1) })).min(1),
  tags: z
    .array(
      z.object({
        id,
        group: id,
        counterpart: id,
        words: z.array(word).min(1),
        oneSided: z.boolean().default(false),
        family: z.boolean().default(false)
      })
    )
    .min(1)
})
export type TiesRules = z.infer<typeof TiesRulesSchema>

/** Problems inside the people and tie vocabularies that their schemas can't see. */
export function peopleProblems(p: PeopleRules, t: TiesRules, meters: string[], composure = p.masking.axis): string[] {
  const problems: string[] = []
  const unique = (what: string, ids: string[]) => {
    for (const x of ids.filter((x, i) => ids.indexOf(x) !== i)) problems.push(`${what} "${x}" is defined twice`)
  }
  const axes = [...p.axes, ...p.attachment]
  unique('axis', axes.map((a) => a.id))
  unique('value', p.values.list.map((v) => v.id))
  unique('foundation', p.foundations.list.map((f) => f.id))
  unique('emotion family', p.emotions.families.map((f) => f.id))
  unique('shade', p.emotions.shades.map((s) => s.word))
  unique('ladder word', p.ladder.map((r) => r.word))
  unique('motive type', p.motives.types.map((m) => m.id))
  unique('tag', t.tags.map((x) => x.id))
  for (const m of p.ages.minors) if (!p.ages.stages.includes(m)) problems.push(`ages.minors names unknown age stage "${m}"`)
  for (const a of axes) unique(`stage of axis "${a.id}"`, a.stages)

  const families = p.emotions.families.map((f) => f.id)
  for (const s of p.emotions.shades) {
    for (const f of s.families) if (!families.includes(f)) problems.push(`shade "${s.word}" names unknown family "${f}"`)
    const [lo, hi] = s.intensity
    if (lo < 1 || hi > 5 || lo > hi) problems.push(`shade "${s.word}" needs a typical intensity within 1–5, low first`)
  }

  const axis = axes.find((a) => a.id === composure)
  if (!axis) problems.push(`masking.axis names unknown axis "${composure}"`)
  else {
    for (const stage of axis.stages) if (!(stage in p.masking.byStage)) problems.push(`masking.byStage has no level for "${stage}"`)
    for (const [stage, level] of Object.entries(p.masking.byStage)) {
      if (!axis.stages.includes(stage)) problems.push(`masking.byStage names "${stage}", not a stage of "${composure}"`)
      if (!p.masking.levels.includes(level)) problems.push(`masking.byStage gives "${stage}" the unknown level "${level}"`)
    }
  }

  const ladder = p.ladder
  if (ladder[0]!.min !== undefined || ladder[0]!.blocked) problems.push('the ladder must start with a rung that has no requirement')
  if (!ladder.at(-1)!.blocked) problems.push('the ladder must end with a blocked rung')
  const mids = ladder.slice(1, -1)
  mids.forEach((r, i) => {
    if (r.min === undefined || r.blocked) problems.push(`ladder rung "${r.word}" needs a min`)
    else if (i > 0 && mids[i - 1]!.min !== undefined && r.min <= mids[i - 1]!.min!) problems.push(`ladder rung "${r.word}" must ask more than the one before`)
  })
  const rungs = ladder.map((r) => r.word)
  const meterWords = (where: string, m: Record<string, string>) => {
    for (const [meter, w] of Object.entries(m)) {
      if (!meters.includes(meter)) problems.push(`${where} names unknown meter "${meter}"`)
      if (!rungs.includes(w)) problems.push(`${where} uses "${w}", which isn't on the ladder`)
    }
  }
  for (const [action, m] of Object.entries(p.gates)) meterWords(`gates.${action}`, m)
  for (const t of p.motives.types) if (t.floors) meterWords(`motive "${t.id}"'s floors`, t.floors)

  const values = p.values.list.map((v) => v.id)
  p.links.forEach((l, i) => {
    const where = `link ${i + 1}`
    if (!meters.includes(l.meter)) problems.push(`${where} names unknown meter "${l.meter}"`)
    if (l.axis) {
      const a = axes.find((x) => x.id === l.axis)
      if (!a) problems.push(`${where} names unknown axis "${l.axis}"`)
      else if (!a.stages.includes(l.stage!)) problems.push(`${where} names "${l.stage}", not a stage of "${l.axis}"`)
    } else {
      if (!values.includes(l.value!)) problems.push(`${where} names unknown value "${l.value}"`)
      if (!p.values.strengths.includes(l.strength!)) problems.push(`${where} names unknown strength "${l.strength}"`)
    }
  })

  const groups = t.groups.map((g) => g.id)
  const tags = t.tags.map((x) => x.id)
  for (const x of t.tags) {
    if (!groups.includes(x.group)) problems.push(`tag "${x.id}" is in unknown group "${x.group}"`)
    const c = t.tags.find((y) => y.id === x.counterpart)
    if (!tags.includes(x.counterpart)) problems.push(`tag "${x.id}" has unknown counterpart "${x.counterpart}"`)
    else if (c!.counterpart !== x.id) problems.push(`tag "${x.id}"'s counterpart "${x.counterpart}" doesn't point back to it`)
    else if (c!.oneSided !== x.oneSided || c!.family !== x.family) problems.push(`tag "${x.id}" and its counterpart "${x.counterpart}" disagree on oneSided or family`)
  }
  return problems
}

/** The ladder rung a word names, by position (0 = no requirement). */
export const rungIndex = (p: PeopleRules, word: string): number => p.ladder.findIndex((r) => r.word === word)
