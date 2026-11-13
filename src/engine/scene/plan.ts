import { z } from 'zod'
import type { GameState } from '@engine/state'
import { characterById, knowerOf, type Pack } from '@engine/pack'
import { checkNames, entryById, knows, LORE_LINE_WORDS } from '@engine/codex'
import { packNames } from './checks'
import { turnLore, type TurnLore } from './lore'
import { canSay, sceneFacts, toldPlayer } from './facts'
import type { Scene } from '@engine/state'
import { locationById } from '@engine/pack'
import {
  MAX_CHECKS,
  MAX_LINES,
  MAX_SPEAKERS,
  PlannedCheckSchema,
  QUOTED_WORDS,
  difficultyNamed,
  list,
  presentCast,
  presentId,
  silence,
  skillNamed,
  text,
  type BeatPlan,
  type ExchangeLine,
  type LoreLine,
  type Move,
  type PlannedCheck,
  type Said
} from './planShape'

/**
 * The director's plan, the situation plan (director-writer review, option B, 2026-11-07; the only plan since
 * milestone 3.6 retired the line plan). The director decides what is true, wanted and at
 * stake; the writer writes the conversation. A move is a kind of move and the facts it says, not wording, so there is
 * no planner prose for the writer to paraphrase, and facts are checked against who may say them.
 */
export const MOVE_KINDS = ['answer', 'ask', 'push back', 'dodge', 'offer', 'refuse', 'concede', 'reveal', 'agree', 'warn', 'explain'] as const

/** Something new a move brings in, at most this many words: a price, a time, a plan; never a line of dialogue. */
export const NEW_FACT_WORDS = 25

/** A lore line is a fact in plain words, at most this long (kept in the codex, whose summaries share the limit). */
export { LORE_LINE_WORDS }

const RawMoveSchema = z.object({
  who: z.string(),
  answers: z.union([z.number(), z.string()]).catch('player'),
  move: text,
  uses: list(z.string()),
  new: list(z.string()),
  needs: z.string().optional().catch(undefined)
})

export const RawPlanSchema = z.object({
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
export type RawPlan = z.infer<typeof RawPlanSchema>

/** At most one detail of the place a turn, and none needed (round 0, F7). */
export const MAX_TEXTURE = 1

/** Reads the situation plan out of a reply; null when there's no JSON object with moves or speakers in it. */
export function parsePlan(reply: string): RawPlan | null {
  // Reasoning models may think aloud first; the plan is what follows.
  const stripped = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const json: unknown = JSON.parse(stripped.slice(start, end + 1))
    const plan = RawPlanSchema.parse(json)
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
 * Checks the plan against the scene. Speakers, checks, reactions, walk-ons, texture and departures go through
 * `validateShared`; then each move is checked: its speaker must be one of the turn's, a reply must answer an
 * earlier move, and every fact it uses must be one its speaker can say. A fact the speaker can't say is dropped from
 * the move and counted: that is a character saying what only someone else knows.
 *
 * Relevance (claude/scene-system-redesign.md §5): a secret is kept only when something just said touches it, named
 * in `touched` and found in the player's words or the last turn, so a secret isn't in play every turn (round 0: 96–100%
 * of speaker slots). An aim's pressure moves at most one step a turn. A move's facts are a pool it may draw on, so a
 * move with none is fine.
 */
export function validatePlan(content: Pack, state: GameState, raw: RawPlan, input = '', lore: TurnLore = turnLore(content, state, input)): { plan: BeatPlan; corrections: string[] } {
  const scene = state.scene!
  const facts = new Map(sceneFacts(content, state).map((f) => [f.id, f]))
  const words = content.ruleset.pressures
  const ground = justSaid(state, input)
  const early: string[] = []
  const shared: SharedPlan = {
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
        ...(kept.length > 0 && { hiding: kept.length === 1 ? kept[0]!.text : kept.map((f, i) => `(${i + 1}) ${f.text}`).join(' '), approach: s.approach || 'deflect', kept: kept.map((f) => f.id) })
      }
    }),
    exchange: [],
    reactions: raw.reactions,
    checks: raw.checks,
    walk_ons: raw.walk_ons,
    texture: raw.texture,
    avoid: raw.avoid,
    leaves: raw.leaves,
    end_scene: raw.end_scene
  }
  const { plan, corrections } = validateShared(content, state, shared)
  corrections.unshift(...early)
  const fix = (why: string) => corrections.push(why)

  // Talking and asking aren't in doubt; a roll for the player belongs to an attempt (round 0, F4).
  if (!raw.player_action.uncertain && plan.checks.some((c) => c.who === 'player')) {
    fix('dropped the player check: the player action is not an uncertain attempt')
    plan.checks = plan.checks.filter((c) => c.who !== 'player')
  }
  if (plan.texture.length > MAX_TEXTURE) plan.texture = plan.texture.slice(0, MAX_TEXTURE)

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

/** The plan's speakers once read from the director's fields, and the fields checked the same way for everyone. */
interface SharedPlan {
  speakers: BeatPlan['speakers']
  /** Always empty here; the moves fill it once checked. */
  exchange: ExchangeLine[]
  reactions: BeatPlan['reactions']
  checks: RawPlan['checks']
  walk_ons: BeatPlan['walk_ons']
  texture: string[]
  avoid: string[]
  leaves: string[]
  end_scene: boolean
}

/** More texture than this is counted as a correction before the plan keeps its one detail (`MAX_TEXTURE`). */
const NOTED_TEXTURE = 3

const normalize = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

/**
 * Checks the fields every plan shares against the scene and fixes what it can: unknown people are dropped, speakers
 * capped, checks with skills or difficulties that don't exist removed, texture capped. Returns what was changed and
 * why, so the test bench can show how often the director strays.
 */
function validateShared(content: Pack, state: GameState, raw: SharedPlan): { plan: BeatPlan; corrections: string[] } {
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
  if (texture.length > NOTED_TEXTURE) {
    fix(`kept ${NOTED_TEXTURE} of ${texture.length} texture details`)
    texture = texture.slice(0, NOTED_TEXTURE)
  }
  if (texture.length === 0) texture = freshTexture(content, scene, 2)

  const leaves = raw.leaves.flatMap((l) => {
    const id = presentId(content, scene, l)
    if (!id) fix(`ignored departure of "${l}": not present`)
    return id ? [id] : []
  })

  return { plan: { ...raw, speakers, reactions, checks, walk_ons, texture, leaves }, corrections }
}

/**
 * The plan's lore lines, checked the way `canSay` checks facts (claude/lore-injection.md §8): the entry must be one
 * the director was given this turn, never a secret; an insider entry's line needs a `who`, a speaker who knows it,
 * and only they would say it; a common entry's line may be said by anyone, or used in narration. A line that fails
 * is dropped and counted as a correction. At most the turn's `loreLines` budget (the ruleset's, or the player's setting),
 * each a fact in plain words, not dialogue.
 */
function validateLore(content: Pack, state: GameState, raw: RawPlan, lore: TurnLore, speakers: Set<string>, fix: (why: string) => void): LoreLine[] {
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
    if (lines.length >= lore.budgets.loreLines) return fix(`dropped lore line ${n}: at most ${lore.budgets.loreLines}`)
    // A line that runs long gives way to the entry's own summary: cutting it could end mid-sentence or before the words
    // that change its meaning, and the summary is a whole sentence about the same entry (kept short by the content check).
    const words = line.split(/\s+/).length
    const long = words > LORE_LINE_WORDS
    if (long) fix(`lore line ${n} was ${words} words; the most is ${LORE_LINE_WORDS}, so the entry's summary stands in`)
    const said = long ? entry.summary.trim() : line
    if (!long) {
      const bad = checkNames(line, packNames(content, [state.player.name]))[0]
      if (bad) return fix(`dropped lore line ${n}: "${bad.name}" isn't a name in this world`)
      if (QUOTED_WORDS.test(line)) fix(`lore line ${n} quotes dialogue`)
    }
    const who = l.who?.trim() ? presentId(content, state.scene!, l.who.trim()) : undefined
    if (entry.knowledge === 'circles') {
      const c = who ? characterById(content, who) : undefined
      if (!who || !speakers.has(who) || !c) return fix(`dropped lore line ${n}: insider knowledge needs a speaker who knows it`)
      if (!knows(content.setting, entry, knowerOf(c))) return fix(`dropped lore line ${n}: ${who} doesn't know ${id}`)
      return void lines.push({ entry: id, title: entry.title, line: said, who })
    }
    if (l.who?.trim() && (!who || !speakers.has(who))) fix(`lore line ${n}: "${l.who.trim()}" isn't a speaker; anyone may use it`)
    lines.push({ entry: id, title: entry.title, line: said, ...(who && speakers.has(who) && { who }) })
  })
  return lines
}

/**
 * The plan once its checks are rolled. A move that needs a check happens only if the check succeeded (round 0,
 * criterion 5: catching a lie takes the roll); replies to a dropped move answer what it answered. A kept secret's
 * tell is given to the writer the first time in a scene, or again when someone else's check this turn succeeded
 * (they were looking closely); otherwise the secret is kept without showing.
 */
export function settlePlan(content: Pack, state: GameState, plan: BeatPlan): BeatPlan {
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
    avoid: [],
    leaves: [],
    end_scene: false
  }
}
