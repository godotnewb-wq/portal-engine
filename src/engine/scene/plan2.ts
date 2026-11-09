import { z } from 'zod'
import type { GameState } from '@engine/state'
import { characterById, knowerOf, type Pack } from '@engine/pack'
import { entryById, knows } from '@engine/codex'
import { turnLore, type TurnLore } from './lore'
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
  type LoreLine,
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

/** Lore lines a turn: a small optional pool for the writer, never one per spoken line (claude/lore-injection.md §8; tune). */
export const MAX_LORE_LINES = 3
/** A lore line is a fact in plain words, at most this long. */
export const LORE_LINE_WORDS = 30

const RawMoveSchema = z.object({
  who: z.string(),
  answers: z.union([z.number(), z.string()]).catch('player'),
  move: text,
  uses: list(z.string()),
  new: list(z.string()),
  needs: z.string().optional().catch(undefined)
})

export const RawPlan2Schema = z.object({
  player_action: z.object({ doing: text, uncertain: z.boolean().catch(false) }).catch({ doing: '', uncertain: false }),
  speakers: list(z.object({ id: z.string(), goal: text, mood: text, pressure: text, keeps: list(z.string()), touched: text, approach: text.optional(), framing: text.optional() })),
  moves: list(RawMoveSchema),
  lore: list(z.object({ entry: z.string(), who: z.string().optional().catch(undefined), line: text })),
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

/** Short words a trigger shares with anything; they don't show that something was touched. */
const COMMON = new Set(['that', 'this', 'with', 'what', 'when', 'were', 'they', 'them', 'their', 'there', 'then', 'than', 'have', 'from', 'your', 'just', 'about', 'would', 'could', 'into', 'some', 'here', 'will', 'been', 'only', 'said', 'asks', 'says'])
const triggerWords = (t: string) => [...new Set(t.toLowerCase().match(/\p{L}{4,}/gu) ?? [])].filter((w) => !COMMON.has(w))

/** What was just said or done: the player's input and the last turn, where a trigger for a secret must be found. */
function justSaid(state: GameState, input: string): string {
  const last = state.scene!.turns.at(-1)
  return [input, last?.player ?? '', ...(last?.beats.map((b) => b.text) ?? [])].join(' ').toLowerCase()
}

/**
 * Checks the situation plan against the scene. Shared fields (speakers, checks, reactions, walk-ons, departures) go
 * through `validatePlan`; then each move is checked: its speaker must be one of the turn's, a reply must answer an
 * earlier move, and every fact it uses must be one its speaker can say. A fact the speaker can't say is dropped from
 * the move and counted: that is a character saying what only someone else knows.
 *
 * Relevance (claude/scene-system-redesign.md §5): a secret is kept only when something just said touches it, named
 * in `touched` and found in the player's words or the last turn, so a secret isn't in play every turn (round 0: 96–100%
 * of speaker slots). An aim's pressure moves at most one step a turn. A move's facts are a pool it may draw on, so a
 * move with none is fine.
 */
export function validatePlan2(content: Pack, state: GameState, raw: RawPlan2, input = '', lore: TurnLore = turnLore(content, state, input)): { plan: BeatPlan; corrections: string[] } {
  const scene = state.scene!
  const facts = new Map(sceneFacts(content, state).map((f) => [f.id, f]))
  const words = content.ruleset.pressures
  const ground = justSaid(state, input)
  const early: string[] = []
  const shared: RawPlan = {
    speakers: raw.speakers.map((s) => {
      const who = presentId(content, scene, s.id) ?? s.id
      const own = s.keeps.map((id) => facts.get(id.trim())).filter((f): f is NonNullable<typeof f> => f !== undefined && f.kind === 'secret' && f.owner === who)
      if (own.length < s.keeps.length) early.push(`${who} keeps something that isn't one of their secrets`)
      const grounded = triggerWords(s.touched).some((w) => ground.includes(w))
      if (own.length > 0 && !grounded) early.push(`${who}'s secret isn't in play: ${s.touched.trim() ? `"${s.touched.trim()}" isn't in what was just said` : 'nothing named touches it'}`)
      const kept = grounded ? own : []

      const asked = words.findIndex((w) => w.toLowerCase() === s.pressure.trim().toLowerCase())
      const before = scene.pressures[who]
      let level = asked >= 0 ? asked : (before ?? 0)
      if (asked < 0 && s.pressure.trim()) early.push(`${who}: no pressure word "${s.pressure.trim()}"`)
      if (before !== undefined && Math.abs(level - before) > 1) {
        level = before + Math.sign(level - before)
        early.push(`${who}'s pressure moved one step, to ${words[level]}`)
      }
      return {
        id: s.id,
        intent: s.goal,
        mood: s.mood,
        pressure: words[level]!,
        ...(s.framing?.trim() && { framing: s.framing.trim() }),
        ...(kept.length > 0 && { hiding: kept.map((f) => f.text).join(' '), approach: s.approach || 'deflect', kept: kept.map((f) => f.id) })
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
  corrections.unshift(...early)
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
      const w = t.split(/\s+/)
      says.push({ text: w.length > NEW_FACT_WORDS ? w.slice(0, NEW_FACT_WORDS).join(' ') : t, unheard: true })
    }
    const needs = m.needs?.trim()
    if (needs && !plan.checks.some((c) => c.id === needs)) fix(`move ${n} needs unknown check "${needs}"; it happens either way`)
    moves.push({ who, answers, move: m.move.trim().toLowerCase() || 'answer', says, ...(needs && plan.checks.some((c) => c.id === needs) && { needs }) })
    renumbered.set(n, moves.length)
  })
  for (const id of speakers) if (!moves.some((m) => m.who === id)) fix(`speaker "${id}" had no move`)

  const exchange: ExchangeLine[] = moves.map((m) => ({ who: m.who, answers: m.answers, point: moveText(m) }))
  const loreLines = validateLore(content, state, raw, lore, speakers, fix)
  return {
    plan: { ...plan, exchange, moves, player_action: raw.player_action, change: raw.change, ...(loreLines.length > 0 && { lore: loreLines }) },
    corrections
  }
}

/**
 * The plan's lore lines, checked the way `canSay` checks facts (claude/lore-injection.md §8): the entry must be one
 * the director was given this turn, never a secret; an insider entry's line needs a `who`, a speaker who knows it,
 * and only they would say it; a common entry's line may be said by anyone, or used in narration. A line that fails
 * is dropped and counted as a correction. At most `MAX_LORE_LINES`, each a fact in plain words, not dialogue.
 */
function validateLore(content: Pack, state: GameState, raw: RawPlan2, lore: TurnLore, speakers: Set<string>, fix: (why: string) => void): LoreLine[] {
  const given = new Set([...lore.layers.scene.entries, ...lore.layers.triggered.entries].map((e) => e.id))
  const lines: LoreLine[] = []
  raw.lore.forEach((l, i) => {
    const n = i + 1
    const id = l.entry.trim().replace(/^\[|\]$/g, '')
    const line = l.line.trim()
    const entry = entryById(content.codex, id)
    if (!line) return fix(`dropped lore line ${n}: it says nothing`)
    if (!entry || !given.has(id)) return fix(`dropped lore line ${n}: "${id}" wasn't given this turn`)
    if (entry.knowledge === 'secret') return fix(`dropped lore line ${n}: "${id}" is a secret`)
    if (lines.length >= MAX_LORE_LINES) return fix(`dropped lore line ${n}: at most ${MAX_LORE_LINES}`)
    if (QUOTED_WORDS.test(line)) fix(`lore line ${n} quotes dialogue`)
    const w = line.split(/\s+/)
    const said = w.length > LORE_LINE_WORDS ? w.slice(0, LORE_LINE_WORDS).join(' ') : line
    const who = l.who?.trim() ? presentId(content, state.scene!, l.who.trim()) : undefined
    if (entry.knowledge === 'circles') {
      const c = who ? characterById(content, who) : undefined
      if (!who || !speakers.has(who) || !c) return fix(`dropped lore line ${n}: insider knowledge needs a speaker who knows it`)
      if (!knows(content.setting, entry, knowerOf(c))) return fix(`dropped lore line ${n}: ${who} doesn't know ${id}`)
      return void lines.push({ entry: id, name: entry.name, line: said, who })
    }
    if (l.who?.trim() && (!who || !speakers.has(who))) fix(`lore line ${n}: "${l.who.trim()}" isn't a speaker; anyone may use it`)
    lines.push({ entry: id, name: entry.name, line: said, ...(who && speakers.has(who) && { who }) })
  })
  return lines
}

/**
 * The plan once its checks are rolled. A move that needs a check happens only if the check succeeded (round 0,
 * criterion 5: catching a lie takes the roll); replies to a dropped move answer what it answered. A kept secret's
 * tell is given to the writer the first time in a scene, or again when someone else's check this turn succeeded
 * (they were looking closely); otherwise the secret is kept without showing.
 */
export function settlePlan2(content: Pack, state: GameState, plan: BeatPlan): BeatPlan {
  const scene = state.scene!
  const passed = new Set(plan.checks.filter((c) => c.result && c.result.degree !== 'failure').map((c) => c.id))
  let moves = plan.moves
  if (moves && moves.some((m) => m.needs && !passed.has(m.needs))) {
    const keep = moves.map((m) => !m.needs || passed.has(m.needs))
    const number = new Map<number, number>()
    moves.forEach((_, i) => keep[i] && number.set(i + 1, number.size + 1))
    const target = (a: Move['answers']): Move['answers'] => {
      while (a !== 'player' && !keep[a - 1]) a = moves![a - 1]!.answers
      return a === 'player' ? 'player' : number.get(a)!
    }
    moves = moves.filter((_, i) => keep[i]).map((m) => ({ ...m, answers: target(m.answers) }))
  }
  const speakers = plan.speakers.map((s) => {
    if (!s.kept?.length) return s
    const secrets = s.kept
    const watched = plan.checks.some((c) => c.who !== s.id && passed.has(c.id))
    const first = secrets.some((id) => !scene.tells.includes(id))
    const tells = (characterById(content, s.id)?.secrets ?? []).filter((x) => secrets.includes(`${s.id}.${x.id}`)).map((x) => x.tell)
    return (first || watched) && tells.length > 0 ? { ...s, tell: tells.join('; ') } : s
  })
  const exchange = moves ? moves.map((m) => ({ who: m.who, answers: m.answers, point: moveText(m) })) : plan.exchange
  return { ...plan, speakers, ...(moves && { moves }), exchange }
}
