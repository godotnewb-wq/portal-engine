import { z } from 'zod'
import type { GameState } from '@engine/state'
import type { Pack } from '@engine/pack'
import { canSay, sceneFacts, toldPlayer } from './facts'
import {
  MAX_LINES,
  PlannedCheckSchema,
  QUOTED_WORDS,
  list,
  presentId,
  text,
  validatePlan,
  type BeatPlan,
  type ExchangeLine,
  type Move,
  type RawPlan,
  type Said
} from './plan'

/**
 * The situation plan (director-writer review, option B, 2026-11-07). The director decides what is true, wanted and at
 * stake; the writer writes the conversation. A move is a kind of move and the facts it says, not wording, so there is
 * no planner prose for the writer to paraphrase, and facts are checked against who may say them.
 */
export const MOVE_KINDS = ['answer', 'ask', 'push back', 'dodge', 'offer', 'refuse', 'concede', 'reveal', 'agree', 'warn', 'explain'] as const

/** Something new a move brings in, at most this many words: a price, a time, a plan; never a line of dialogue. */
export const NEW_FACT_WORDS = 25

const RawMoveSchema = z.object({
  who: z.string(),
  answers: z.union([z.number(), z.string()]).catch('player'),
  move: text,
  uses: list(z.string()),
  new: list(z.string())
})

export const RawPlan2Schema = z.object({
  player_action: z.object({ doing: text, uncertain: z.boolean().catch(false) }).catch({ doing: '', uncertain: false }),
  speakers: list(z.object({ id: z.string(), goal: text, mood: text, keeps: list(z.string()), approach: text.optional() })),
  moves: list(RawMoveSchema),
  change: text,
  reactions: list(z.object({ id: z.string(), beat: z.string() })),
  checks: list(PlannedCheckSchema),
  walk_ons: list(z.object({ id: z.string(), line: z.string() })),
  texture: list(z.string()),
  avoid: list(z.string()),
  leaves: list(z.string()),
  end_scene: z.boolean().catch(false)
})
export type RawPlan2 = z.infer<typeof RawPlan2Schema>

/** At most one detail of the place a turn, and none needed (round 0, F7). */
export const MAX_TEXTURE_2 = 1

/** Reads the situation plan out of a reply; null when there's no JSON object with moves or speakers in it. */
export function parsePlan2(reply: string): RawPlan2 | null {
  // Reasoning models may think aloud first; the plan is what follows.
  const stripped = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const json: unknown = JSON.parse(stripped.slice(start, end + 1))
    const plan = RawPlan2Schema.parse(json)
    return plan.moves.length > 0 || plan.speakers.length > 0 ? plan : null
  } catch {
    return null
  }
}

/** A move as one line for read-outs and the older parts of the pipeline: "push back: the doors stay sealed". */
export const moveText = (m: Move): string => `${m.move}${m.says.length > 0 ? `: ${m.says.map((s) => s.text).join('; ')}` : ''}`

/**
 * Checks the situation plan against the scene. Shared fields (speakers, checks, reactions, walk-ons, departures) go
 * through `validatePlan`; then each move is checked: its speaker must be one of the turn's, a reply must answer an
 * earlier move, and every fact it uses must be one its speaker can say. A fact the speaker can't say is dropped from
 * the move and counted: that is a character saying what only someone else knows.
 */
export function validatePlan2(content: Pack, state: GameState, raw: RawPlan2): { plan: BeatPlan; corrections: string[] } {
  const scene = state.scene!
  const facts = new Map(sceneFacts(content, state).map((f) => [f.id, f]))
  const shared: RawPlan = {
    speakers: raw.speakers.map((s) => {
      const kept = s.keeps.map((id) => facts.get(id)).filter((f) => f !== undefined)
      return {
        id: s.id,
        intent: s.goal,
        mood: s.mood,
        ...(kept.length > 0 && { hiding: kept.map((f) => f.text).join(' '), approach: s.approach || 'deflect' })
      }
    }),
    exchange: [],
    reactions: raw.reactions,
    checks: raw.checks,
    walk_ons: raw.walk_ons,
    texture: raw.texture,
    contrast: '',
    avoid: raw.avoid,
    leaves: raw.leaves,
    end_scene: raw.end_scene
  }
  const { plan, corrections } = validatePlan(content, state, shared, { exchange: false })
  const fix = (why: string) => corrections.push(why)

  // Talking and asking aren't in doubt; a roll for the player belongs to an attempt (round 0, F4).
  if (!raw.player_action.uncertain && plan.checks.some((c) => c.who === 'player')) {
    fix('dropped the player check: the player action is not an uncertain attempt')
    plan.checks = plan.checks.filter((c) => c.who !== 'player')
  }
  if (plan.texture.length > MAX_TEXTURE_2) plan.texture = plan.texture.slice(0, MAX_TEXTURE_2)

  const speakers = new Set(plan.speakers.map((s) => s.id))
  const moves: Move[] = []
  const renumbered = new Map<number, number>()
  raw.moves.forEach((m, i) => {
    const n = i + 1
    const who = presentId(content, scene, m.who)
    if (!who || !speakers.has(who)) return fix(`dropped move ${n}: "${m.who}" is not a speaker`)
    if (moves.length >= MAX_LINES) return fix(`dropped move ${n}: at most ${MAX_LINES}`)
    const asked = typeof m.answers === 'number' ? m.answers : /^\d+$/.test(m.answers.trim()) ? Number(m.answers) : undefined
    let answers: Move['answers'] = 'player'
    if (asked !== undefined) {
      const earlier = renumbered.get(asked)
      if (earlier !== undefined) answers = earlier
      else fix(`move ${n} answered move ${asked}, which isn't an earlier move; it answers the player`)
    }
    const says: Said[] = []
    for (const id of m.uses) {
      const fact = facts.get(id.trim())
      if (!fact) fix(`move ${n}: no fact "${id}"`)
      else if (!canSay(scene, fact, who)) fix(`move ${n}: ${who} can't know ${fact.id}`)
      else says.push({ text: fact.text, id: fact.id, unheard: !toldPlayer(scene, fact) })
    }
    for (const t of m.new.map((x) => x.trim()).filter(Boolean)) {
      if (QUOTED_WORDS.test(t)) fix(`move ${n} quotes dialogue in what it says`)
      const words = t.split(/\s+/)
      says.push({ text: words.length > NEW_FACT_WORDS ? words.slice(0, NEW_FACT_WORDS).join(' ') : t, unheard: true })
    }
    if (says.length === 0) fix(`move ${n} (${who}) says nothing`)
    moves.push({ who, answers, move: m.move.trim().toLowerCase() || 'answer', says })
    renumbered.set(n, moves.length)
  })
  for (const id of speakers) if (!moves.some((m) => m.who === id)) fix(`speaker "${id}" had no move`)

  const exchange: ExchangeLine[] = moves.map((m) => ({ who: m.who, answers: m.answers, point: moveText(m) }))
  return {
    plan: { ...plan, exchange, moves, player_action: raw.player_action, change: raw.change },
    corrections
  }
}
