import { z } from 'zod'
import type { CheckResult, Difficulty, Edge, Ruleset, Skill } from '@engine/rules'
import type { GameState, Scene } from '@engine/state'
import { characterById, locationById, type Pack } from '@engine/pack'

/**
 * The director's beat plan (narrator-scene-engine §4), read leniently: a field the model leaves out or gets the wrong
 * shape of becomes empty rather than failing the turn. `validatePlan` then checks it against the scene.
 */
export const text = z.string().catch('')
export const list = <T extends z.ZodType>(item: T) => z.array(z.unknown()).catch([]).transform((xs) => xs.flatMap((x) => {
  const parsed = item.safeParse(x)
  return parsed.success ? [parsed.data as z.infer<T>] : []
}))

export const PlannedSpeakerSchema = z.object({
  id: z.string(),
  /** The older one-line form: what their single line gets across. `exchange` replaces it; read when it's missing. */
  point: text.optional(),
  intent: text,
  mood: text,
  knows: text.optional(),
  hiding: text.optional(),
  approach: text.optional(),
  depends_on_check: z.string().optional().catch(undefined)
})

export const PlannedCheckSchema = z.object({
  id: z.string(),
  who: z.string(),
  skill: z.string(),
  difficulty: z.string(),
  stakes: text,
  /** A character present who helps. The game decides what their help is worth. */
  assist: z.string().optional().catch(undefined),
  /** Suggested with a reason; the game applies it, never stacked. */
  edge: z.enum(['advantage', 'disadvantage']).optional().catch(undefined),
  edge_reason: text.optional()
})

/**
 * One line of the turn's conversation (round 0, session 2026-11-06_2313_c313): who says it, what it answers (the
 * player, or an earlier line by its 1-based number) and its point, so each line builds on the one before.
 */
export const ExchangeLineSchema = z.object({
  who: z.string(),
  answers: z.union([z.number(), z.string()]).catch('player'),
  point: text
})

export const RawPlanSchema = z.object({
  speakers: list(PlannedSpeakerSchema),
  exchange: list(ExchangeLineSchema),
  reactions: list(z.object({ id: z.string(), beat: z.string() })),
  checks: list(PlannedCheckSchema),
  walk_ons: list(z.object({ id: z.string(), line: z.string() })),
  texture: list(z.string()),
  contrast: text,
  avoid: list(z.string()),
  /** Characters who leave this beat. */
  leaves: list(z.string()),
  end_scene: z.boolean().catch(false)
})
export type RawPlan = z.infer<typeof RawPlanSchema>

export interface PlannedCheck {
  id: string
  who: string
  skill: Skill
  difficulty: Difficulty
  stakes: string
  assist?: string
  edge?: 'advantage' | 'disadvantage'
  /** Filled in by the game once rolled. */
  result?: CheckResult
  /** What the assist was worth, once rolled: a bonus, an edge, or nothing (no skill, or not enough of the assist meter). */
  assisted?: { by: string; bonus: number; edge: Edge; meter: number }
  /** The line shown to the player, e.g. "Ada — Search 17 vs 15: success". */
  line?: string
}

/** A line after validation: `answers` is "player" or the 1-based number of an earlier line. */
export interface ExchangeLine {
  who: string
  answers: 'player' | number
  point: string
}

/** Something a move says: a fact by id, or something new the plan brought in. `unheard`: the player hasn't been told it. */
export interface Said {
  text: string
  id?: string
  unheard: boolean
}

/** A move after validation (director-writer review, option B): who, what it answers, what kind of move, and what it says. */
export interface Move {
  who: string
  answers: 'player' | number
  move: string
  says: Said[]
}

/**
 * The validated plan. `moves`, `player_action` and `change` come from the situation plan (`plan2.ts`); a plan from
 * the older director has none of them, and `exchange` then carries the lines.
 */
export type BeatPlan = Omit<RawPlan, 'checks' | 'exchange'> & {
  checks: PlannedCheck[]
  exchange: ExchangeLine[]
  moves?: Move[]
  player_action?: { doing: string; uncertain: boolean }
  change?: string
}

/**
 * At most three speakers a turn, so a group of three can all talk (play: with a cap of two, the third was always
 * silent), and few enough checks to keep the turn quick.
 */
export const MAX_SPEAKERS = 3
export const MAX_CHECKS = 2
export const MAX_TEXTURE = 3
/** Lines in a turn's exchange: one for each of three speakers and two replies, inside the beat budget (tune). */
export const MAX_LINES = 5
/**
 * After this many turns without a line, the director is shown what a character cares about (round 0 F3). A reminder
 * to look, never a quota: whether they speak stays the director's call (director-writer §6).
 */
export const QUIET_TURNS = 2

/**
 * A plan's lines for showing, also for plans logged before the exchange existed (a point per speaker): read-outs
 * read old sessions too.
 */
export function planLines(plan: Pick<BeatPlan, 'speakers'> & { exchange?: ExchangeLine[] }): ExchangeLine[] {
  return plan.exchange ?? plan.speakers.flatMap((s) => (s.point ? [{ who: s.id, answers: 'player' as const, point: s.point }] : []))
}

/** "1. Ada → the player: …", for read-outs. */
export const lineText = (lines: ExchangeLine[], i: number, nameOf: (id: string) => string): string => {
  const l = lines[i]!
  return `${i + 1}. ${nameOf(l.who)} → ${l.answers === 'player' ? 'the player' : `${l.answers}`}: ${l.point}`
}

/** Pulls the JSON object out of a reply that may wrap it in a code fence or a sentence. */
export function parsePlan(reply: string): RawPlan | null {
  const stripped = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return null
  }
  const parsed = RawPlanSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

/** A skill as the director wrote it, by id or by name. */
export function skillNamed(r: Ruleset, written: string): Skill | undefined {
  const asked = normalize(written)
  return r.skills.find((s) => normalize(s.id) === asked || normalize(s.name) === asked)?.id
}

export function difficultyNamed(r: Ruleset, written: string): Difficulty | undefined {
  const asked = normalize(written)
  return r.difficulties.find((d) => normalize(d.word) === asked)?.word
}

/** Who is here now: the persistent cast minus anyone who left. */
export const presentCast = (scene: Scene): string[] => scene.cast.filter((id) => !scene.departed.includes(id))

/** Who is meant: an id, a full name or a first name, for someone present. */
export function presentId(content: Pack, scene: Scene, written: string): string | undefined {
  const asked = normalize(written)
  return presentCast(scene).find((id) => {
    const c = characterById(content, id)
    return id === asked || (c && (normalize(c.name) === asked || normalize(c.name.split(' ')[0]!) === asked))
  })
}

/**
 * Checks the plan against the scene and fixes what it can: unknown people are dropped, speakers capped at two,
 * checks with skills or difficulties that don't exist removed, texture capped. Returns what was changed and why,
 * so the test bench can show how often the director strays.
 */
/** `exchange: false` leaves the lines to the caller (the situation plan validates its own moves). */
export function validatePlan(content: Pack, state: GameState, raw: RawPlan, options: { exchange?: boolean } = {}): { plan: BeatPlan; corrections: string[] } {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const corrections: string[] = []
  const fix = (why: string) => corrections.push(why)

  const speakers: BeatPlan['speakers'] = []
  for (const s of raw.speakers) {
    const id = presentId(content, scene, s.id)
    if (!id) fix(`dropped speaker "${s.id}": not present`)
    else if (speakers.some((x) => x.id === id)) fix(`dropped duplicate speaker "${id}"`)
    else if (speakers.length >= MAX_SPEAKERS) fix(`dropped speaker "${id}": at most ${MAX_SPEAKERS}`)
    else speakers.push({ ...s, id })
  }

  const reactions: BeatPlan['reactions'] = []
  for (const r of raw.reactions) {
    const id = presentId(content, scene, r.id)
    if (!id) fix(`dropped reaction for "${r.id}": not present`)
    else if (speakers.some((s) => s.id === id)) fix(`dropped reaction for "${id}": they speak this beat`)
    else if (!reactions.some((x) => x.id === id)) reactions.push({ id, beat: r.beat })
  }

  const checks: PlannedCheck[] = []
  for (const c of raw.checks) {
    const who = normalize(c.who) === 'player' || normalize(c.who) === normalize(state.player.name) ? 'player' : presentId(content, scene, c.who)
    const skill = skillNamed(content.ruleset, c.skill)
    const difficulty = difficultyNamed(content.ruleset, c.difficulty)
    if (!who) fix(`dropped check "${c.id}": "${c.who}" is not present`)
    else if (!skill) fix(`dropped check "${c.id}": no skill "${c.skill}"`)
    else if (!difficulty) fix(`dropped check "${c.id}": no difficulty "${c.difficulty}"`)
    else if (checks.length >= MAX_CHECKS) fix(`dropped check "${c.id}": at most ${MAX_CHECKS}`)
    else if (checks.some((x) => x.id === c.id)) fix(`dropped duplicate check "${c.id}"`)
    else {
      const assist = c.assist ? presentId(content, scene, c.assist) : undefined
      if (c.assist && (!assist || assist === who)) fix(`dropped assist "${c.assist}" on check "${c.id}"`)
      checks.push({
        id: c.id,
        who,
        skill,
        difficulty,
        stakes: c.stakes,
        ...(assist && assist !== who && { assist }),
        ...(c.edge && { edge: c.edge })
      })
    }
  }
  for (const s of speakers) {
    if (s.depends_on_check && !checks.some((c) => c.id === s.depends_on_check)) {
      fix(`removed ${s.id}'s dependency on unknown check "${s.depends_on_check}"`)
      delete s.depends_on_check
    }
  }
  const exchange = options.exchange === false ? [] : validateExchange(content, scene, raw, speakers, fix)

  const location = locationById(content, scene.locationId)!
  const walk_ons = raw.walk_ons.flatMap((w) => {
    const card = location.walkOns.find((x) => scene.walkOns.includes(x.id) && [x.id, x.label, x.name ?? ''].some((n) => normalize(n) === normalize(w.id)))
    if (!card) {
      fix(`dropped walk-on "${w.id}": not here`)
      return []
    }
    return [{ id: card.id, line: w.line }]
  })

  let texture = raw.texture.filter((t) => t.trim().length > 0)
  if (texture.length > MAX_TEXTURE) {
    fix(`kept ${MAX_TEXTURE} of ${texture.length} texture details`)
    texture = texture.slice(0, MAX_TEXTURE)
  }
  if (texture.length === 0) texture = freshTexture(content, scene, 2)

  const leaves = raw.leaves.flatMap((l) => {
    const id = presentId(content, scene, l)
    if (!id) fix(`ignored departure of "${l}": not present`)
    return id ? [id] : []
  })

  return { plan: { ...raw, speakers, exchange, reactions, checks, walk_ons, texture, leaves }, corrections }
}

/** Words in quotes: double quotes, or single quotes around a phrase (an apostrophe inside a word doesn't count). */
export const QUOTED_WORDS = /["“”]|(?:^|[\s(—–-])'[^']+'(?=$|[\s.,;:!?)—–-])/

/**
 * The turn's lines in order. A line by someone who isn't a speaker is dropped, a reply to a dropped or later line
 * answers the player instead, and the list is capped. A plan in the older form (a point per speaker, no exchange)
 * becomes one line each, and a speaker left without a line gets one, so an imperfect reply never costs the turn.
 */
function validateExchange(content: Pack, scene: Scene, raw: RawPlan, speakers: BeatPlan['speakers'], fix: (why: string) => void): ExchangeLine[] {
  const lines: ExchangeLine[] = []
  // Raw line number → its number once dropped lines are gone, so replies keep pointing at the right line.
  const renumbered = new Map<number, number>()
  raw.exchange.forEach((l, i) => {
    const id = presentId(content, scene, l.who)
    if (!id || !speakers.some((s) => s.id === id)) return fix(`dropped line ${i + 1}: "${l.who}" is not a speaker`)
    if (lines.length >= MAX_LINES) return fix(`dropped line ${i + 1}: at most ${MAX_LINES}`)
    const asked = typeof l.answers === 'number' ? l.answers : /^\d+$/.test(l.answers.trim()) ? Number(l.answers) : undefined
    let answers: ExchangeLine['answers'] = 'player'
    if (asked !== undefined) {
      const earlier = renumbered.get(asked)
      if (earlier !== undefined && asked <= i) answers = earlier
      else fix(`line ${i + 1} answered line ${asked}, which isn't an earlier line; it answers the player`)
    }
    lines.push({ who: id, answers, point: l.point })
    renumbered.set(i + 1, lines.length)
  })
  for (const s of speakers) {
    if (lines.some((l) => l.who === s.id)) continue
    if (raw.exchange.length > 0) fix(`speaker "${s.id}" had no line; gave them one`)
    if (lines.length < MAX_LINES) lines.push({ who: s.id, answers: 'player', point: s.point ?? '' })
  }
  // Counted, not dropped: a line without a point is the filler round 0 found (F2), and a point with quoted words is
  // the director writing the line itself, which the writer then copies (session 2026-11-07_0013_714e).
  lines.forEach((l, i) => {
    if (!l.point.trim()) fix(`line ${i + 1} (${l.who}) has no point`)
    else if (QUOTED_WORDS.test(l.point)) fix(`line ${i + 1} (${l.who}) quotes dialogue in its point`)
  })
  return lines
}

/** Location details not used in the last few turns, so description doesn't repeat. */
export function freshTexture(content: Pack, scene: Scene, count: number): string[] {
  const location = locationById(content, scene.locationId)!
  const used = new Set(scene.turns.slice(-3).flatMap((t) => t.texture))
  const all = [...location.texture.sights, ...location.texture.sounds, ...location.texture.smells]
  const fresh = all.filter((t) => !used.has(t))
  // Rotate by turn so a run of fallback plans doesn't always open on the same detail.
  const pool = fresh.length >= count ? fresh : all
  const start = scene.turns.length % pool.length
  return [...pool.slice(start), ...pool.slice(0, start)].slice(0, count)
}

/** How many turns since each present character last had a speaking slot (the whole scene if never). */
export function silence(scene: Scene): Record<string, number> {
  const result: Record<string, number> = {}
  for (const id of presentCast(scene)) {
    const last = scene.turns.findLastIndex((t) => t.speakers.includes(id))
    result[id] = last < 0 ? scene.turns.length : scene.turns.length - 1 - last
  }
  return result
}

/**
 * The plan the game makes itself when the director's reply can't be read, so a bad reply costs no extra call:
 * whoever the player named speaks, else whoever has been silent longest; everyone else reacts.
 */
export function fallbackPlan(content: Pack, state: GameState, input: string): BeatPlan {
  const scene = state.scene!
  const present = presentCast(scene)
  const quiet = silence(scene)
  const named = present.find((id) => {
    const c = characterById(content, id)!
    return new RegExp(`\\b(${[c.id, c.name, c.name.split(' ')[0]].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i').test(input)
  })
  const speaker = named ?? [...present].sort((a, b) => quiet[b]! - quiet[a]!)[0]
  return {
    speakers: speaker ? [{ id: speaker, intent: 'Answer what the player just said, in character, pursuing their own aims.', mood: scene.moods[speaker] ?? '' }] : [],
    exchange: speaker ? [{ who: speaker, answers: 'player', point: 'Answer what the player just said, directly.' }] : [],
    reactions: present.filter((id) => id !== speaker).map((id) => ({ id, beat: 'reacts in keeping with their mood' })),
    checks: [],
    walk_ons: [],
    texture: freshTexture(content, scene, 2),
    contrast: '',
    avoid: [],
    leaves: [],
    end_scene: false
  }
}
