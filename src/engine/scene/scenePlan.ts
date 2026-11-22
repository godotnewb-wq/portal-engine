import { z } from 'zod'
import type { Feeling } from '@engine/characters'
import { firstName } from '@engine/core'
import { characterById, type Pack } from '@engine/pack'
import type { GameState } from '@engine/state'
import { justSaid, type Gathered, type LiveRecord, type PoolFact, type SecretOption, type TieOption } from './gather'
import { feltNow, NEW_FACT_WORDS, playerChecks, RawFeelsSchema, validateChecks, validateLeaves, validateWalkOns } from './plan'
import { sceneFacts } from './facts'
import { sharedWords } from './phrases'
import { list, MAX_SPEAKERS, oneOrList, PlannedCheckSchema, presentId, QUOTED_WORDS, text, type BeatPlan, type PlannedCheck, type Read } from './planShape'

/**
 * The `scene` pipeline's plan (scene system redesign §4 "The director: a game master, not a playwright"; Milestone 5
 * plan, task 1). The director sets the situation and what is at stake and plans no lines: no moves, no order, no
 * wording. It says who the moment is about, how what just happened lands on each of them and what they want right now,
 * at most one pressure each (from what the game found could be live), the facts each may draw on (from the pool the
 * game built), and the checks. The game checks all of it before the writer runs.
 */

/** How what just happened lands on someone in focus, and what they want right now (Q3: `feels` plus a line in words). */
export interface Moment {
  who: string
  /** What they feel now, checked and eased as in the situation plan; left out, their feeling from before carries. */
  feels?: Feeling
  /** How what just happened lands on them, in plain situational words. */
  lands: string
  /** What they want right now, in this exchange. */
  wants: string
}

/** A pressure played live this turn: at most one per character, from what the game found could be live (Q5). */
export interface LivePressure {
  who: string
  kind: 'goal' | 'secret' | 'tie'
  /** A goal by its holder's id, a secret by its fact id, a tie by the other person (an id, or `player`). */
  ref: string
  /** For the writer: the aim, the secret in full, or the tie in words with its note. */
  text: string
  /** A goal's strength word. */
  strength?: string
  /** A secret: what touched it, as the game found it. A tie: whether the other person is here or was just named. */
  how?: SecretOption['how'] | TieOption['how']
  /** A secret: the words that touched it. */
  touched?: string
  /** A secret: how they handle it this turn (redesign §5.2). */
  approach?: Approach
}

/** How someone handles a live secret (redesign §5.2): engine words the writer reads, as the situation plan's were. */
export const APPROACHES = ['deflect', 'partial truth', 'lie'] as const
export type Approach = (typeof APPROACHES)[number]

export interface ScenePlan {
  pipeline: 'scene'
  player_action: { doing: string; uncertain: boolean; reading?: string }
  checks: PlannedCheck[]
  /** Reading checks that succeeded, once rolled. */
  reads?: Read[]
  /** Who the moment is about, at most `MAX_SPEAKERS`. Anyone else present may react or say a little. */
  focus: string[]
  moments: Moment[]
  /** Each present character's aim strength after this turn, as a ruleset pressure word. */
  strengths: Record<string, string>
  pressures: LivePressure[]
  /** The facts each character in focus may draw on: a pool, not a script. */
  pools: Record<string, PoolFact[]>
  /** What this turn could settle or change, and what a check result changes (Q4: replaces `change`). */
  stakes: string
  walk_ons: { id: string; line: string }[]
  leaves: string[]
  end_scene: boolean
  /** Phrases the writer should keep off, the director's avoid list (redesign §6.4). */
  avoid: string[]
}

export const RawScenePlanSchema = z.object({
  player_action: z.object({ doing: text, uncertain: z.boolean().catch(false), reading: z.string().optional().catch(undefined) }).catch({ doing: '', uncertain: false }),
  checks: list(PlannedCheckSchema),
  focus: oneOrList(z.string()),
  moments: list(z.object({ who: z.string(), feels: RawFeelsSchema.optional().catch(undefined), lands: text, wants: text, pressure: text })),
  pressures: list(z.object({ who: z.string(), kind: text, secret: text, with: text, touched: text, approach: text })),
  draws_on: list(z.object({ who: z.string(), facts: oneOrList(z.string()) })),
  details: list(z.object({ who: z.string(), text })),
  stakes: text,
  walk_ons: list(z.object({ id: z.string(), line: z.string() })),
  leaves: oneOrList(z.string()),
  end_scene: z.boolean().catch(false),
  avoid: oneOrList(z.string())
})
export type RawScenePlan = z.infer<typeof RawScenePlanSchema>

/** A director's detail sharing this many content words with a secret is about the secret, and dropped (*tune*). */
export const DETAIL_SECRET_WORDS = 3

/** Words for a moment's line or the stakes before the rest is cut (*tune*): a situation, not a script. */
export const MOMENT_WORDS = 30
export const STAKES_WORDS = 40

/** Reads the scene plan out of a reply; null when there's no JSON object with a focus or moments in it. */
export function parseScenePlan(reply: string): RawScenePlan | null {
  // Reasoning models may think aloud first; the plan is what follows.
  const stripped = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const plan = RawScenePlanSchema.parse(JSON.parse(stripped.slice(start, end + 1)) as unknown)
    return plan.focus.length > 0 || plan.moments.length > 0 ? plan : null
  } catch {
    return null
  }
}

const KINDS = ['goal', 'secret', 'tie'] as const

/** A line of situation in words: trimmed, no dialogue, cut at `limit` words. */
function situationLine(raw: string, what: string, limit: number, fix: (why: string) => void): string {
  const t = raw.trim()
  if (QUOTED_WORDS.test(t)) fix(`${what} quotes dialogue`)
  const w = t.split(/\s+/).filter(Boolean)
  if (w.length <= limit) return t
  fix(`${what} was ${w.length} words; cut to ${limit}`)
  return w.slice(0, limit).join(' ')
}

/** Who a tie names: the player, someone by id or name, as the game listed them. */
function tieFor(content: Pack, state: GameState, options: TieOption[], written: string): TieOption | undefined {
  const w = written.trim().toLowerCase()
  if (!w) return undefined
  if (w === 'player' || w === state.player.name.toLowerCase()) return options.find((t) => t.with === 'player')
  return options.find((t) => {
    const c = characterById(content, t.with)
    return t.with === w || (c && (c.name.toLowerCase() === w || firstName(c.name).toLowerCase() === w))
  })
}

/**
 * Checks the scene plan against the scene and what the game gathered, and fixes what it can; every change is a
 * correction, counted as the situation plan's are.
 * - **Focus:** people present, at most `MAX_SPEAKERS`; when the director gives none, the moments' people.
 * - **Moments:** for people in focus; a feeling checked and eased as in the situation plan; the lines in plain words.
 *   Someone in focus without one is moved out of focus (still present), unless no one has one.
 * - **Aim strength:** a ruleset pressure word, moving at most one step a turn from the gathered strength.
 * - **Pressures:** at most one each, for people in focus, and only from the gathered options: a secret something just
 *   said touched, a tie in play, or an aim stronger than the weakest word (a background aim shapes choices silently
 *   and is never the topic on its own: redesign §5.3).
 * - **Facts:** only from the character's gathered pool.
 * - **Checks, walk-ons, departures:** as the situation plan checks them.
 */
export function validateScenePlan(content: Pack, state: GameState, raw: RawScenePlan, gathered: Gathered, input = ''): { plan: ScenePlan; corrections: string[] } {
  const scene = state.scene!
  const r = content.ruleset
  const corrections: string[] = []
  const fix = (why: string) => corrections.push(why)
  const who = (written: string) => presentId(content, scene, written)

  const focus: string[] = []
  const wanted = raw.focus.length > 0 ? raw.focus : raw.moments.map((m) => m.who)
  for (const f of wanted) {
    const id = who(f)
    if (!id) fix(`dropped "${f}" from focus: not present`)
    else if (focus.includes(id)) continue
    else if (focus.length >= MAX_SPEAKERS) fix(`dropped "${id}" from focus: at most ${MAX_SPEAKERS}`)
    else focus.push(id)
  }

  const moments: Moment[] = []
  const strengths: Record<string, string> = Object.fromEntries(Object.entries(gathered.options).map(([id, o]) => [id, o.goal.strength]))
  for (const m of raw.moments) {
    const id = who(m.who)
    if (!id || !focus.includes(id)) {
      fix(`dropped the moment for "${m.who}": not in focus`)
      continue
    }
    if (moments.some((x) => x.who === id)) {
      fix(`dropped a second moment for ${id}`)
      continue
    }
    const felt = feltNow(content, state, id, m.feels, fix)
    moments.push({ who: id, ...felt, lands: situationLine(m.lands, `${id}'s moment`, MOMENT_WORDS, fix), wants: situationLine(m.wants, `what ${id} wants`, MOMENT_WORDS, fix) })
    const goal = gathered.options[id]?.goal
    const asked = r.pressures.findIndex((w) => w.toLowerCase() === m.pressure.trim().toLowerCase())
    if (m.pressure.trim() && asked < 0) fix(`${id}: no pressure word "${m.pressure.trim()}"`)
    if (goal && asked >= 0) {
      let level = asked
      if (Math.abs(level - goal.level) > 1) {
        level = goal.level + Math.sign(level - goal.level)
        fix(`${id}'s pressure moved one step, to ${r.pressures[level]}`)
      }
      strengths[id] = r.pressures[level]!
    }
  }
  // Someone in focus with no moment would be written as wanting "to answer what was asked", pulling in a speaker
  // with nothing to say (34 times in m5-core-scene): they stay present, out of focus. With no moments at all, focus
  // stands and the writer answers what was asked.
  if (moments.length > 0)
    for (const id of [...focus])
      if (!moments.some((m) => m.who === id)) {
        focus.splice(focus.indexOf(id), 1)
        fix(`${id} is in focus with no moment: here, out of focus`)
      }

  const pressures: LivePressure[] = []
  const { texts, written } = justSaid(state, input)
  const said = [...texts, ...written].join(' ').toLowerCase()
  for (const p of raw.pressures) {
    const id = who(p.who)
    const kind = KINDS.find((k) => k === p.kind.trim().toLowerCase())
    const options = id ? gathered.options[id] : undefined
    if (!id || !focus.includes(id) || !options) {
      fix(`dropped a pressure for "${p.who}": not in focus`)
      continue
    }
    if (pressures.some((x) => x.who === id)) {
      fix(`dropped a second pressure for ${id}: at most one`)
      continue
    }
    if (!kind) {
      fix(`dropped ${id}'s pressure: no kind "${p.kind.trim()}"`)
      continue
    }
    if (kind === 'goal') {
      const strength = strengths[id]!
      if (r.pressures.indexOf(strength) <= 0) {
        fix(`dropped ${id}'s aim as a pressure: at ${strength} it shapes their choices, never the topic`)
        continue
      }
      pressures.push({ who: id, kind, ref: id, text: options.goal.text, strength })
    } else if (kind === 'secret') {
      const option = options.secrets.find((s) => s.id === p.secret.trim())
      if (!option) {
        fix(`dropped ${id}'s secret "${p.secret.trim()}": nothing just said touches it`)
        continue
      }
      // The game found what touched it; a quote the director invented doesn't replace that.
      if (p.touched.trim() && !said.includes(p.touched.trim().toLowerCase())) fix(`${id}'s secret: "${p.touched.trim()}" isn't in what was just said; "${option.by}" touched it`)
      const approach = APPROACHES.find((a) => a === p.approach.trim().toLowerCase()) ?? 'deflect'
      if (p.approach.trim() && approach !== p.approach.trim().toLowerCase()) fix(`${id}'s secret: no approach "${p.approach.trim()}"; deflect`)
      pressures.push({ who: id, kind, ref: option.id, text: option.text, how: option.how, touched: option.by, approach })
    } else {
      const tie = tieFor(content, state, options.ties, p.with)
      if (!tie) {
        fix(`dropped ${id}'s tie to "${p.with.trim()}": not in play`)
        continue
      }
      pressures.push({ who: id, kind, ref: tie.with, text: [tie.words, tie.note].filter(Boolean).join('; '), how: tie.how })
    }
  }

  const pools: Record<string, PoolFact[]> = {}
  // Concrete details the director wants on hand (task 4; a move's `new` before): short facts in one person's pool,
  // never wording for a line. Not a secret, and within the ruleset's count. Said on screen, they become common ground.
  const secretTexts = sceneFacts(content, state).filter((f) => f.kind === 'secret').map((f) => f.text)
  for (const d of raw.details) {
    const id = who(d.who)
    const text = d.text.trim()
    const n = Object.values(pools).flat().filter((f) => f.source === 'plan').length
    if (!text) continue
    if (!id || !focus.includes(id)) fix(`dropped the detail for "${d.who}": not in focus`)
    else if (text.split(/\s+/).length > NEW_FACT_WORDS) fix(`dropped ${id}'s detail "${text}": over ${NEW_FACT_WORDS} words`)
    else if (secretTexts.some((t) => sharedWords(text, t) >= DETAIL_SECRET_WORDS)) fix(`dropped ${id}'s detail "${text}": it says a secret`)
    else if (n >= r.scene.details) fix(`dropped ${id}'s detail "${text}": over the limit of ${r.scene.details}`)
    else (pools[id] ??= []).push({ id: `detail.${scene.turns.length + 1}.${n + 1}`, text, source: 'plan', unheard: true })
  }
  for (const d of raw.draws_on) {
    const id = who(d.who)
    if (!id || !focus.includes(id)) {
      fix(`dropped the facts for "${d.who}": not in focus`)
      continue
    }
    const offered = gathered.pools[id] ?? []
    for (const f of d.facts.map((x) => x.trim().replace(/^\[|\]$/g, ''))) {
      const fact = offered.find((x) => x.id === f)
      if (!fact) fix(`${id} can't draw on "${f}": not in their pool`)
      else if (!(pools[id] ?? []).includes(fact)) (pools[id] ??= []).push(fact)
    }
  }

  const felt: Record<string, Feeling> = { ...scene.moods, ...Object.fromEntries(moments.flatMap((m) => (m.feels ? [[m.who, m.feels]] : []))) }
  const walk_ons = validateWalkOns(content, state, raw.walk_ons, fix)
  const reading = raw.player_action.reading ? who(raw.player_action.reading) : undefined
  const checks = playerChecks(content, state, validateChecks(content, state, raw.checks, felt, fix), { uncertain: raw.player_action.uncertain, ...(reading && { reading }) }, felt, { walk_ons }, fix)

  // Seeing through someone takes a roll (redesign §5.2; criterion 5). A live secret is always dodged or lied about, never
  // simply told, so when someone here could see through the holder and no one is reading them, the plan missed the read
  // (Milestone 5 plan, task 2: no companion read in any run before this milestone). Noted, counted, not added: whether
  // the moment calls for a read stays the director's call.
  for (const p of pressures.filter((x) => x.kind === 'secret')) {
    const readers = gathered.readers[p.who] ?? []
    if (readers.length > 0 && !checks.some((c) => c.target === p.who && c.skill === r.people.reading.skill)) fix(`${p.who} plays ${p.ref} live with ${readers.map((x) => x.who).join(' or ')} here to see through it, and no one reads them`)
  }

  return {
    plan: {
      pipeline: 'scene',
      player_action: { doing: raw.player_action.doing.trim(), uncertain: raw.player_action.uncertain, ...(reading && { reading }) },
      checks,
      focus,
      moments,
      strengths,
      pressures,
      pools,
      stakes: situationLine(raw.stakes, 'the stakes', STAKES_WORDS, fix),
      walk_ons,
      leaves: validateLeaves(content, state, raw.leaves, fix),
      end_scene: raw.end_scene,
      avoid: raw.avoid.map((a) => a.trim()).filter(Boolean)
    },
    corrections
  }
}

/** The pressures played live, as the turn keeps them (`Turn.live`), so the next turns' gathering sees them. */
export const liveRecords = (plan: Pick<ScenePlan, 'pressures'>): LiveRecord[] => plan.pressures.map((p) => ({ who: p.who, kind: p.kind, ref: p.ref }))

/**
 * The scene plan seen as a situation plan (Milestone 5 plan, task 3), so everything after the writer reads it as before:
 * applying the turn (feelings, aim strengths, kept secrets, reads, departures), settling the checks (tells, reads), the
 * bookkeeper, the trace and the metrics. The people in focus are its speakers: what they want is their intent, a live
 * secret is what they keep. No moves, no exchange, no reactions and no texture: the writer writes the scene. The plan
 * itself rides along as `scene`.
 */
export function sceneView(plan: ScenePlan): BeatPlan {
  const moments = new Map(plan.moments.map((m) => [m.who, m]))
  return {
    speakers: plan.focus.map((id) => {
      const m = moments.get(id)
      const secret = plan.pressures.find((p) => p.who === id && p.kind === 'secret')
      return {
        id,
        intent: m?.wants ?? '',
        ...(m?.feels && { feels: m.feels }),
        ...(plan.strengths[id] && { pressure: plan.strengths[id] }),
        ...(secret && { hiding: secret.text, approach: secret.approach ?? 'deflect', kept: [secret.ref] })
      }
    }),
    exchange: [],
    reactions: [],
    checks: plan.checks,
    ...(plan.reads && { reads: plan.reads }),
    walk_ons: plan.walk_ons,
    texture: [],
    avoid: plan.avoid,
    leaves: plan.leaves,
    end_scene: plan.end_scene,
    moves: [],
    player_action: plan.player_action,
    scene: plan
  }
}

/**
 * The plan when the director's reply can't be read: the game's own, at no extra call, as the situation pipeline's
 * `fallbackPlan`. Whoever spoke last turn, else everyone present up to the cap, is in focus, wanting to answer what
 * was asked; nothing is live and nothing is drawn on.
 */
export function sceneFallback(state: GameState, gathered: Gathered): ScenePlan {
  const scene = state.scene!
  const last = scene.turns.at(-1)?.speakers ?? []
  const present = Object.keys(gathered.options)
  const focus = (last.filter((id) => present.includes(id)).length > 0 ? last.filter((id) => present.includes(id)) : present).slice(0, MAX_SPEAKERS)
  return {
    pipeline: 'scene',
    player_action: { doing: '', uncertain: false },
    checks: [],
    focus,
    moments: focus.map((who) => ({ who, lands: '', wants: 'to answer what was asked' })),
    strengths: Object.fromEntries(Object.entries(gathered.options).map(([id, o]) => [id, o.goal.strength])),
    pressures: [],
    pools: {},
    stakes: '',
    walk_ons: [],
    leaves: [],
    end_scene: false,
    avoid: []
  }
}

/**
 * A scene plan in read-out lines, for the logs, the bench report and Turn details (task 4): the moment for each person
 * in focus, what pressed live, the facts and details they could draw on, the stakes, and who leaves.
 */
export function scenePlanLines(plan: ScenePlan, nameOf: (id: string) => string): string[] {
  const named = (id: string) => (id === 'player' ? 'the player' : nameOf(id))
  const pressure = (p: LivePressure) =>
    p.kind === 'secret' ? `secret \`${p.ref}\`${p.approach ? ` (${p.approach})` : ''}${p.touched ? `, touched by “${p.touched}”` : ''}` : p.kind === 'tie' ? `tie with ${named(p.ref)}` : `aim${p.strength ? ` (${p.strength})` : ''}: ${p.text}`
  return [
    ...plan.moments.map((m) => `${nameOf(m.who)}: ${m.lands}; wants ${m.wants}${m.feels ? ` (feels ${m.feels.shade} ${m.feels.intensity})` : ''}${plan.strengths[m.who] ? `; aim ${plan.strengths[m.who]}` : ''}`),
    ...plan.pressures.map((p) => `Underneath, ${nameOf(p.who)}: ${pressure(p)}`),
    ...Object.entries(plan.pools).map(([who, pool]) => `${nameOf(who)} may draw on: ${pool.map((f) => (f.source === 'plan' ? `“${f.text}” (detail)` : `\`${f.id}\``)).join(', ')}`),
    plan.stakes && `Stakes: ${plan.stakes}`,
    plan.leaves.length > 0 && `Leaving: ${plan.leaves.map(nameOf).join(', ')}`,
    plan.end_scene && 'Ends the scene'
  ].filter((x): x is string => !!x)
}
