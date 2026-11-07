import type { CallTrace } from '@engine/core'
import type { Meters } from '@engine/characters'
import type { Beat, GameState } from '@engine/state'
import type { Degree, Edge } from '@engine/rules'
import { characterById, type Pack } from '@engine/pack'
import { firstName } from '@engine/core'
import type { Tags } from './beats'
import type { Problem } from './checks'
import type { BeatPlan } from './plan'

/**
 * Everything one turn did, for the logs (milestone 2, A1): the engine builds it, the platform writes it. Calls are
 * kept whole here; the log writer splits their prompts into sections stored once.
 */
export interface TurnTrace {
  turnId: string
  sceneId: string
  /** 1-based, within the scene. */
  turn: number
  /** ISO time the turn started. */
  at: string
  input: string
  cast: { before: CastSnapshot[]; after: CastSnapshot[] }
  director: {
    callId: string
    /** How the reply was read: as JSON; as JSON after the endpoint refused `response_format`; or not at all, so the game planned the turn. */
    read: 'json' | 'json-retried' | 'unreadable'
    /** The plan after validation, with its checks rolled. */
    plan: BeatPlan
    corrections: string[]
    /** Which director and writer ran (`TurnOptions.pipeline`); absent in turns logged before there was a choice. */
    pipeline?: 'situation' | 'lines'
  }
  dice: { before: number; after: number }
  checks: CheckTrace[]
  /** `reshaped`: lines of the shown reply where code split speech from action (round 0 F1). */
  writer: { callId: string; reshaped?: number[] }
  /** What the code checks found in the draft; the rewrite was asked to fix these. */
  findings: Problem[]
  rewrite?: {
    callId: string
    /** Problems still in the rewrite. */
    remaining: Problem[]
    /** Set when the game salvaged the rewrite: beats dropped (1-based, in the rewrite) and how many were cut to the budget. */
    salvage?: { dropped: number[]; cut: number }
  }
  /** The beats as shown, each traced to its line in the reply it came from and to the plan item it carries out. */
  beats: BeatTrace[]
  tags: { parsed: Tags; dropped: string[] }
  cost: { calls: number; ms: number; tokens?: { input: number; output: number } }
  calls: CallTrace[]
}

/** How someone in the scene stood, before or after a turn. */
export interface CastSnapshot {
  id: string
  mood: string
  comfort: number
  expression: string
  /** Toward the player. */
  meters?: Meters
  departed?: boolean
}

export interface CheckTrace {
  id: string
  who: string
  skill: string
  attribute: string
  difficulty: string
  dc: number
  /** Every die rolled, and the one that counted. */
  rolls: number[]
  natural: number
  /** The edge the director asked for, and the edge that applied once everything was combined. */
  edgeAsked?: 'advantage' | 'disadvantage'
  edge: Edge
  modifier: number
  rank: number
  bonus: number
  assist?: { by: string; bonus: number; edge: Edge; meter: number }
  total: number
  degree: Degree
  critical: 'hit' | 'miss' | null
  line: string
  stakes: string
}

export interface BeatTrace {
  /** 1-based, as the player reads them in this turn. */
  index: number
  beat: Beat
  source: 'draft' | 'rewrite'
  /** Its line in that reply's raw text, 1-based. */
  line: number
  /** The turn was salvaged and this beat survived it. */
  salvaged: boolean
  /** Which parts of the plan it carries out: `speaker:<id>`, `line:<n>` (its exchange line), `reaction:<id>`, `walk-on:<id>`, `check:<id>`, or `narration`. */
  plan: string[]
}

export function castSnapshot(state: GameState): CastSnapshot[] {
  const scene = state.scene
  if (!scene) return []
  return scene.cast.map((id) => ({
    id,
    mood: scene.moods[id] ?? '',
    comfort: scene.comfort[id] ?? 3,
    expression: scene.expressions[id] ?? 'neutral',
    ...(state.meters[id] && { meters: state.meters[id] }),
    ...(scene.departed.includes(id) && { departed: true })
  }))
}

export function checkTraces(plan: BeatPlan): CheckTrace[] {
  return plan.checks.flatMap((c) => {
    const r = c.result
    if (!r || !c.line) return []
    return [{
      id: c.id,
      who: c.who,
      skill: r.skill,
      attribute: r.attribute,
      difficulty: r.difficulty,
      dc: r.dc,
      rolls: r.rolls,
      natural: r.natural,
      ...(c.edge && { edgeAsked: c.edge }),
      edge: r.edge,
      modifier: r.modifier,
      rank: r.rank,
      bonus: r.bonus,
      ...(c.assisted && { assist: c.assisted }),
      total: r.total,
      degree: r.degree,
      critical: r.critical,
      line: c.line,
      stakes: c.stakes
    }]
  })
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Which plan items a beat carries out. A line by a planned speaker is their brief (and the check their line depends
 * on), and their nth line in the turn is their nth line of the exchange, numbered as the writer saw it (beats in a row by
 * the same speaker, with only narration between, are one line written in parts); a walk-on's line is theirs; narration that names someone with a planned reaction is that reaction. Narration
 * naming no one is plain narration. Names are matched as whole words, by id, full name or first name.
 */
export function planItems(content: Pack, plan: BeatPlan, beat: Beat, earlier: Beat[] = []): string[] {
  if (beat.kind === 'dialogue') {
    const speaker = plan.speakers.find((s) => s.id === beat.speaker)
    if (speaker) {
      const said = earlier.flatMap((b) => (b.kind === 'dialogue' ? [b.speaker] : []))
      const runs = said.filter((w, i) => w === beat.speaker && said[i - 1] !== w).length
      const nth = said.at(-1) === beat.speaker ? runs - 1 : runs
      const line = plan.exchange.map((l, i) => ({ ...l, n: i + 1 })).filter((l) => l.who === beat.speaker)[nth]
      return [`speaker:${speaker.id}`, ...(line ? [`line:${line.n}`] : []), ...(speaker.depends_on_check ? [`check:${speaker.depends_on_check}`] : [])]
    }
    if (plan.walk_ons.some((w) => w.id === beat.speaker)) return [`walk-on:${beat.speaker}`]
    return []
  }
  const names = (id: string) => {
    const c = characterById(content, id)
    return c ? [c.name, firstName(c.name)] : [id]
  }
  const mentions = (id: string) => new RegExp(`\\b(?:${names(id).map(escape).join('|')})\\b`, 'i').test(beat.text)
  const items = [
    ...plan.reactions.filter((r) => mentions(r.id)).map((r) => `reaction:${r.id}`),
    ...plan.walk_ons.filter((w) => new RegExp(`\\b${escape(w.id.replace(/-/g, ' '))}\\b`, 'i').test(beat.text.replace(/-/g, ' '))).map((w) => `walk-on:${w.id}`)
  ]
  return items.length > 0 ? items : ['narration']
}

