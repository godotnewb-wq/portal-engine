import { z } from 'zod'
import type { CheckResult, Difficulty, Edge, Ruleset, Skill } from '@engine/rules'
import type { Scene } from '@engine/state'
import { characterById, type Pack } from '@engine/pack'

/**
 * What the director's plan is once checked (director writer §4): its types, its limits, and the helpers that read
 * it and the scene. `plan.ts` reads the director's reply into this shape and checks it. Raw fields are read leniently:
 * a field the model leaves out or gets the wrong shape of becomes empty rather than failing the turn.
 */
export const text = z.string().catch('')
export const list = <T extends z.ZodType>(item: T) => z.array(z.unknown()).catch([]).transform((xs) => xs.flatMap((x) => {
  const parsed = item.safeParse(x)
  return parsed.success ? [parsed.data as z.infer<T>] : []
}))

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

/**
 * A speaker's brief after validation. The situation plan fills `pressure`, `hiding`, `approach`, `kept`, `tell` and
 * `framing`. `point`, `knows` and `depends_on_check` come only from turns logged by the retired line-plan director;
 * read-outs of older logs still read them.
 */
export interface PlannedSpeaker {
  id: string
  intent: string
  mood: string
  /** How hard their aim for the scene presses this turn, as a ruleset pressure word. */
  pressure?: string
  /** The secrets they keep this turn, in full, for the writer. */
  hiding?: string
  approach?: string
  /** The fact ids of the secrets they keep this turn (each touched by something just said). */
  kept?: string[]
  /** The kept secret's tell, when the game lets it show this turn. */
  tell?: string
  /** How they colour what they say about the world ("resentful, street-level view"). */
  framing?: string
  point?: string
  knows?: string
  depends_on_check?: string
}

/**
 * One line of the turn's conversation, for read-outs: who says it, what it answers (the player, or an earlier line
 * by its 1-based number) and its point. The situation plan derives it from its moves; older logs planned it directly.
 */
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

/** A move after validation (director writer review, option B): who, what it answers, what kind of move, and what it says. */
export interface Move {
  who: string
  answers: 'player' | number
  move: string
  says: Said[]
  /** A check this move depends on: it happens only if the check succeeds (someone seeing through a lie). */
  needs?: string
}

/**
 * A line of world lore the writer may draw on this turn (lore injection.md §8): the codex entry it comes from,
 * the fact in plain words, and, for insider knowledge, the one speaker who would say it.
 */
export interface LoreLine {
  entry: string
  /** The entry's title, for read-outs. */
  title: string
  line: string
  who?: string
}

/** The validated plan. `exchange` is derived from `moves`, for read-outs and the beat trace. */
export interface BeatPlan {
  speakers: PlannedSpeaker[]
  exchange: ExchangeLine[]
  reactions: { id: string; beat: string }[]
  checks: PlannedCheck[]
  walk_ons: { id: string; line: string }[]
  texture: string[]
  avoid: string[]
  /** Characters who leave this turn. */
  leaves: string[]
  end_scene: boolean
  moves?: Move[]
  /** A pool of lore lines, apart from the moves. */
  lore?: LoreLine[]
  player_action?: { doing: string; uncertain: boolean }
  change?: string
  /** Older logs only: the line-plan director's note on how the speakers' voices differ. */
  contrast?: string
}

/**
 * At most three speakers a turn, so a group of three can all talk (play: with a cap of two, the third was always
 * silent), and few enough checks to keep the turn quick.
 */
export const MAX_SPEAKERS = 3
export const MAX_CHECKS = 2
/** Lines in a turn's exchange: one for each of three speakers and two replies, inside the beat budget (tune). */
export const MAX_LINES = 5
/**
 * After this many turns without a line, the director is shown what a character cares about (round 0 F3). A reminder
 * to look, never a quota: whether they speak stays the director's call (director writer §6).
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

/** Words in quotes: double quotes, or single quotes around a phrase (an apostrophe inside a word doesn't count). */
export const QUOTED_WORDS = /["“”]|(?:^|[\s(—–-])'[^']+'(?=$|[\s.,;:!?)—–-])/

/** How many turns since each present character last had a speaking slot (the whole scene if never). */
export function silence(scene: Scene): Record<string, number> {
  const result: Record<string, number> = {}
  for (const id of presentCast(scene)) {
    const last = scene.turns.findLastIndex((t) => t.speakers.includes(id))
    result[id] = last < 0 ? scene.turns.length : scene.turns.length - 1 - last
  }
  return result
}
