import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { IdSchema } from '@engine/core'
import { FeelingWordsSchema, feelingProblem, MetersSchema, readFeeling, SecretSchema, TieTagSchema, type Character, type Feeling } from '@engine/characters'
import { entryById } from '@engine/codex'
import { memoryId } from '@engine/memory'
import type { GameState, Memory, Relation } from '@engine/state'
import { characterById, type Pack } from '@engine/pack'
import { BeatSchema, createInitialState, dayOf, MemoryLevelSchema, MINUTES_PER_DAY, startScene, stateProblems, tagsToward, TurnSchema } from '@engine/state'
import { applyRecords, MINUTES_PER_TURN, RECENT_TURNS, SUMMARY_CHARS, turnText } from '@engine/scene'

export const ExpectedCheckSchema = z.object({ turn: z.number().int().positive(), who: IdSchema, skill: IdSchema })
export type ExpectedCheck = z.infer<typeof ExpectedCheckSchema>

/**
 * What one person should hold toward another when the play ends (Milestone 5 plan, task 7; decided 2026-11-20, user):
 * tags it must have and tags it must not. A hire for one job lacks every work tag; a wedding has spouse and lacks
 * fiancé. Read against the state the play ended on, after the player's answers.
 */
export const ExpectedTieSchema = z.object({ from: IdSchema, to: IdSchema, has: z.array(IdSchema).default([]), lacks: z.array(IdSchema).default([]) })
export type ExpectedTie = z.infer<typeof ExpectedTieSchema>

/** An expected tie as the play left it: the tags held, and whether the expectation was met. */
export interface TieResult {
  expected: ExpectedTie
  held: string[]
  met: boolean
}

/** Each expected tie read against the state a play ended on. */
export const checkTies = (state: GameState, expected: ExpectedTie[]): TieResult[] =>
  expected.map((e) => {
    const held = tagsToward(state, e.from, e.to).map((t) => t.tag)
    return { expected: e, held, met: e.has.every((t) => held.includes(t)) && !e.lacks.some((t) => held.includes(t)) }
  })

/**
 * The player cutting in on a turn (Milestone 5 task 8c): on turn `turn` (1-based, in its scene), after its first
 * `after` beats, as the app's Cut in does. The rest of the turn never happens. A turn shorter than that is read whole.
 */
export const InterruptSchema = z.object({ turn: z.number().int().positive(), after: z.number().int().positive() })

/** Starting moods, overriding the character files: a feeling in the ruleset's words, with words for it or a reason (milestone 4b). */
const MoodsSchema = z.record(IdSchema, FeelingWordsSchema.extend({ text: z.string().min(1).optional(), reason: z.string().min(1).optional() })).default({})
const DaysAgoSchema = z.number().int().min(0).default(0)

/**
 * Run-only starting state (milestone 4b, task 6; decided 2026-11-13): setup for existing characters that exists only for
 * this scenario, so couples, mourners and seeded secrets come from the shipped cast with no new cards. Ages are in days
 * before the first scene; the clock starts that many days later, so nothing is dated before the game began.
 */
export const StartSchema = z
  .object({
    /** Tags one character holds toward another or toward the player ("player"), replacing what they held. With `mirror` (the default), the other character takes each tag's counterpart too. */
    ties: z.array(z.object({ from: IdSchema, to: z.string().min(1), tags: z.array(TieTagSchema), note: z.string().optional(), meters: MetersSchema.optional(), mirror: z.boolean().default(true) })).default([]),
    /** Aftermath, or with `toward` a feeling toward a person: the intensity it has now, and how long ago it began. */
    aftermath: z.array(FeelingWordsSchema.extend({ owner: IdSchema, toward: z.string().min(1).optional(), reason: z.string().min(1), daysAgo: DaysAgoSchema })).default([]),
    /** Memories in the Memory Bank. `about`: who was there (default the player); `focus`: who it is really about. */
    memories: z.array(z.object({ owner: IdSchema, text: z.string().min(1), level: MemoryLevelSchema, reason: z.string().optional(), place: z.string().optional(), about: z.array(z.string()).default(['player']), focus: z.array(z.string()).default([]), topics: z.array(z.string()).default([]), daysAgo: DaysAgoSchema })).default([]),
    /** Secrets added to a character's card for this run, after their own (e.g. to hold more than the sheet shows, for dormancy). */
    secrets: z.record(IdSchema, z.array(SecretSchema)).default({}),
    /** When each character last saw the player, in days before the first scene. */
    lastSeen: z.record(IdSchema, z.number().int().min(0)).default({}),
    /** Secrets the player already knows, by holder and secret id (the card's or one added above), as if learned in play. */
    facts: z.record(IdSchema, z.array(IdSchema)).default({})
  })
  .prefault({})
export type ScenarioStart = z.infer<typeof StartSchema>

/** A scene after the first (milestone 4b, task 6): the days that pass before it, where, who, and the player's lines. */
export const LaterSceneSchema = z.object({
  /** Next days before it (0: the same evening). Each runs the daily upkeep, then consolidation, as the app's Next day does. */
  days: z.number().int().min(0).default(1),
  location: IdSchema,
  cast: z.array(IdSchema).min(1),
  /** The location's walk-ons present; all of them when left out, none with []. */
  walkOns: z.array(IdSchema).optional(),
  moods: MoodsSchema,
  comfort: z.record(IdSchema, z.number().int().min(1).max(5)).default({}),
  turns: z.array(z.string().min(1)).min(1),
  /** Turns of this scene (1-based) after which the game is saved and reloaded, as when a player quits mid-scene (task 7). */
  reloadAfter: z.array(z.number().int().positive()).default([]),
  /** Turns of this scene (1-based) the player cuts in on, after how many of their beats (Milestone 5 task 8c). */
  interrupts: z.array(InterruptSchema).default([])
})
export type LaterScene = z.infer<typeof LaterSceneSchema>

/**
 * A fixed scene for the test bench (director writer §10): who is where, how they feel going in, and the lines
 * the player says. Run against a prompt or model change, the same scenarios show whether characters got better.
 */
export const ScenarioSchema = z.object({
  id: IdSchema,
  title: z.string(),
  /** What the scenario tests, and what a good run looks like. Read by people, not by the game. */
  watchFor: z.string(),
  location: IdSchema,
  cast: z.array(IdSchema).min(1),
  /** The first scene's walk-ons; all of the location's when left out, none with [] (e.g. the bar after closing). */
  walkOns: z.array(IdSchema).optional(),
  seed: z.number().int().default(1),
  /** Every check rolls this natural number, so "caught" and "uncaught" runs are repeatable. */
  forceNatural: z.number().int().min(1).max(20).optional(),
  /** Starting feelings toward the player, overriding the character files. */
  meters: z.record(IdSchema, MetersSchema).default({}),
  moods: MoodsSchema,
  /** Starting comfort (1–5), overriding the default. */
  comfort: z.record(IdSchema, z.number().int().min(1).max(5)).default({}),
  /**
   * Turns already played in the scene, verbatim: a scenario made from a logged turn (`npm run logs -- to-scenario`)
   * opens on the scene as it stood, so the replayed turn sees the same history.
   */
  history: z.array(TurnSchema).default([]),
  /** The scene's opening as it was (a logged scene, from to-scenario): carried, not written again (Milestone 5 task 8). */
  opening: z.array(BeatSchema).optional(),
  turns: z.array(z.string().min(1)).min(1),
  /** Turns of the first scene (1-based) after which the game is saved and reloaded mid-scene (Milestone 5 task 7). */
  reloadAfter: z.array(z.number().int().positive()).default([]),
  /** Turns of the first scene the player cuts in on, and after how many beats (Milestone 5 task 8c). */
  interrupts: z.array(InterruptSchema).default([]),
  /** Named groups to run together, e.g. `core` (Milestone 5 plan, Q15): `npm run bench -- --set core`. */
  sets: z.array(IdSchema).default([]),
  /** A roll the scenario is designed to exercise. Turns are 1-based. */
  expectedCheck: ExpectedCheckSchema.optional(),
  /** Ties the play should end with, and ties it shouldn't; checked against the last scene's end. */
  expectedTies: z.array(ExpectedTieSchema).default([]),
  /** Run the end-of-scene summaries too. */
  summaries: z.boolean().default(true),
  /** Run-only starting state (milestone 4b). */
  start: StartSchema,
  /** Scenes after the first, in order (milestone 4b): summaries, Next day and consolidation run between them, and the state is saved and reloaded. */
  later: z.array(LaterSceneSchema).default([]),
  /** How the player answers a tie change that needs their agreement (`set_tie`): yes or no to every one. */
  answerTies: z.enum(['yes', 'no']).default('yes')
})
export type Scenario = z.infer<typeof ScenarioSchema>

export function loadScenarios(dir: string): Scenario[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => scenarioFile(join(dir, name)))
}

/**
 * The scenarios a run plays: those named, and those in the named set (task 7, Q15: the core set), in the pack's
 * order; scenario files given by path run on their own unless pack scenarios are named too. Everything with none.
 */
export function pickScenarios(all: Scenario[], named: string[], set?: string, extra: Scenario[] = []): Scenario[] {
  const missing = named.filter((id) => !all.some((s) => s.id === id))
  if (missing.length > 0) throw new Error(`No such scenario: ${missing.join(', ')}. Known: ${all.map((s) => s.id).join(', ')}`)
  const inSet = set ? all.filter((s) => s.sets.includes(set)).map((s) => s.id) : []
  if (set && inSet.length === 0) throw new Error(`No scenario is in the set "${set}". Sets: ${[...new Set(all.flatMap((s) => s.sets))].join(', ') || 'none'}`)
  const ids = [...new Set([...inSet, ...named])]
  return ids.length > 0 ? [...all.filter((s) => ids.includes(s.id)), ...extra.filter((s) => !ids.includes(s.id))] : extra.length > 0 ? extra : all
}

/** One scenario file, checked. */
export function scenarioFile(path: string): Scenario {
  const parsed = ScenarioSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) throw new Error(`${basename(path)}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return parsed.data
}

/** Every scene a scenario plays, the first included, in order. */
export function scenesOf(scenario: Scenario): (LaterScene & { n: number })[] {
  const { location, cast, walkOns, moods, comfort, turns, reloadAfter, interrupts } = scenario
  return [{ n: 1, days: 0, location, cast, ...(walkOns && { walkOns }), moods, comfort, turns, reloadAfter, interrupts }, ...scenario.later.map((s, i) => ({ ...s, n: i + 2 }))]
}

/** A scene's id: the scenario's for the first, so single-scene runs read as before ("deception-caught-2"); "<id>-s2" and on after. */
export const sceneIdOf = (scenario: Scenario, n: number): string => (n === 1 ? scenario.id : `${scenario.id}-s${n}`)

/** Problems a scenario has against the content: unknown places or people, and starting state that doesn't fit. */
export function scenarioProblems(content: Pack, scenario: Scenario): string[] {
  const problems: string[] = []
  const isCharacter = (id: string) => content.characters.some((c) => c.id === id)
  for (const scene of scenesOf(scenario)) {
    const at = scene.n === 1 ? '' : ` (scene ${scene.n})`
    const location = content.locations.find((l) => l.id === scene.location)
    if (!location) problems.push(`unknown location "${scene.location}"${at}`)
    for (const id of [...scene.cast, ...Object.keys(scene.moods), ...Object.keys(scene.comfort)]) if (!isCharacter(id)) problems.push(`unknown character "${id}"`)
    for (const id of scene.walkOns ?? []) if (location && !location.walkOns.some((w) => w.id === id)) problems.push(`unknown walk-on "${id}"${at}`)
    for (const i of scene.interrupts) if (i.turn > scene.turns.length) problems.push(`a cut-in is outside the scripted turns (turn ${i.turn})${at}`)
    for (const [id, m] of Object.entries(scene.moods)) {
      const problem = feelingProblem(content.ruleset, m)
      if (problem) problems.push(`${id}'s mood${at}: ${problem}`)
    }
  }
  for (const id of Object.keys(scenario.meters)) if (!isCharacter(id)) problems.push(`unknown character "${id}"`)
  problems.push(...startProblems(content, scenario.start))
  if (problems.length === 0) problems.push(...stateProblems(scenarioContent(content, scenario), seededState(content, scenario)).map((p) => `starting state: ${p}`))
  const expected = scenario.expectedCheck
  if (expected) {
    if (expected.turn > scenario.turns.length) problems.push(`expected check is outside the scripted turns (${expected.turn})`)
    if (expected.who !== 'player' && !scenario.cast.includes(expected.who)) problems.push(`expected check roller "${expected.who}" is not in the cast`)
    if (!content.ruleset.skills.some((skill) => skill.id === expected.skill)) problems.push(`unknown expected check skill "${expected.skill}"`)
  }
  for (const t of scenario.expectedTies) {
    if (!content.characters.some((c) => c.id === t.from)) problems.push(`an expected tie names unknown character "${t.from}"`)
    if (t.to !== 'player' && !content.characters.some((c) => c.id === t.to)) problems.push(`an expected tie names unknown character "${t.to}"`)
    for (const tag of [...t.has, ...t.lacks]) if (!content.ruleset.ties.tags.some((x) => x.id === tag)) problems.push(`an expected tie uses unknown tag "${tag}"`)
    if (t.has.length + t.lacks.length === 0) problems.push(`an expected tie from ${t.from} to ${t.to} expects nothing`)
  }
  return [...new Set(problems)]
}

function startProblems(content: Pack, start: ScenarioStart): string[] {
  const problems: string[] = []
  const known = (id: string) => content.characters.some((c) => c.id === id)
  const person = (id: string, what: string) => {
    if (id !== 'player' && !known(id)) problems.push(`${what} names unknown character "${id}"`)
  }
  for (const t of start.ties) {
    if (!known(t.from)) problems.push(`a tie names unknown character "${t.from}"`)
    person(t.to, 'a tie')
    if (t.from === t.to) problems.push(`${t.from} can't hold a tie toward themselves`)
    for (const tag of t.tags) if (!content.ruleset.ties.tags.some((x) => x.id === tag.tag)) problems.push(`a tie uses unknown tag "${tag.tag}"`)
  }
  for (const a of start.aftermath) {
    if (!known(a.owner)) problems.push(`a feeling names unknown character "${a.owner}"`)
    if (a.toward) person(a.toward, 'a feeling')
    const problem = feelingProblem(content.ruleset, a)
    if (problem) problems.push(`${a.owner}'s feeling: ${problem}`)
  }
  for (const m of start.memories) {
    if (!known(m.owner)) problems.push(`a memory names unknown character "${m.owner}"`)
    for (const id of [...m.about, ...m.focus]) person(id, 'a memory')
  }
  for (const [id, secrets] of Object.entries(start.secrets)) {
    const c = characterById(content, id)
    if (!c) {
      problems.push(`secrets for unknown character "${id}"`)
      continue
    }
    const ids = [...c.secrets, ...secrets].map((s) => s.id)
    for (const dup of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) problems.push(`${id} would hold two secrets "${dup}"`)
    for (const s of secrets) if (s.codex && !entryById(content.codex, s.codex)) problems.push(`${id}'s secret "${s.id}" points to unknown codex entry "${s.codex}"`)
  }
  for (const id of Object.keys(start.lastSeen)) if (!known(id)) problems.push(`last seen names unknown character "${id}"`)
  for (const [id, ids] of Object.entries(start.facts)) {
    const held = [...(characterById(content, id)?.secrets ?? []), ...(start.secrets[id] ?? [])].map((s) => s.id)
    for (const s of ids) if (!held.includes(s)) problems.push(`the player knows "${id}.${s}", which ${known(id) ? `${id} doesn't hold` : 'no one holds'}`)
  }
  return problems
}

/** The content a scenario plays against: the pack's, with the run-only secrets added to their holders' cards. */
export function scenarioContent(content: Pack, scenario: Scenario): Pack {
  const extra = scenario.start.secrets
  if (Object.keys(extra).length === 0) return content
  return { ...content, characters: content.characters.map((c) => (extra[c.id] ? { ...c, secrets: [...c.secrets, ...(extra[c.id] as Character['secrets'])] } : c)) }
}

/**
 * The game state before the first scene opens: a new game, the scenario's meters toward the player, and its starting
 * state. The clock starts as many days in as the oldest thing seeded, so everything is dated after the game began.
 */
export function seededState(content: Pack, scenario: Scenario): GameState {
  const fresh = createInitialState(content, scenario.seed)
  const s = scenario.start
  const r = content.ruleset
  const back = Math.max(0, ...s.aftermath.map((a) => a.daysAgo), ...s.memories.map((m) => m.daysAgo), ...Object.values(s.lastSeen))
  const time = fresh.time + back * MINUTES_PER_DAY
  const ago = (days: number) => time - days * MINUTES_PER_DAY

  let relations: Relation[] = fresh.relations
  const playerTies = { ...fresh.playerTies }
  const setTags = (from: string, to: string, tags: Relation['tags'], note?: string, meters?: Relation['meters']) => {
    const was = relations.find((x) => x.from === from && x.to === to)
    const next: Relation = { from, to, tags, ...((note ?? was?.note) !== undefined && { note: note ?? was?.note }), meters: meters ?? was?.meters ?? { ...r.relations.start } }
    relations = was ? relations.map((x) => (x === was ? next : x)) : [...relations, next]
  }
  for (const t of s.ties) {
    if (t.to === 'player') {
      playerTies[t.from] = { tags: t.tags, ...(t.note !== undefined && { note: t.note }) }
      continue
    }
    setTags(t.from, t.to, t.tags, t.note, t.meters)
    if (!t.mirror) continue
    const held = relations.find((x) => x.from === t.to && x.to === t.from)?.tags ?? []
    const counterparts = t.tags.flatMap((tag) => {
      const def = r.ties.tags.find((x) => x.id === tag.tag)
      return def && !def.oneSided && !held.some((h) => h.tag === def.counterpart) ? [{ tag: def.counterpart }] : []
    })
    if (counterparts.length > 0) setTags(t.to, t.from, [...held, ...counterparts])
  }

  const aftermath: GameState['aftermath'] = s.aftermath.flatMap((a) => {
    const read = readFeeling(r, a)
    if (!('feeling' in read)) return []
    const f = read.feeling
    return [{ owner: a.owner, ...(a.toward && { toward: a.toward }), shade: f.shade, family: f.family, intensity: f.intensity, reason: a.reason, since: ago(a.daysAgo), scene: 'before the scenario', fadedOn: dayOf(r, time) }]
  })

  const memories: Memory[] = []
  for (const m of s.memories) {
    const at = ago(m.daysAgo)
    memories.push({ id: memoryId(memories, m.owner), owner: m.owner, text: m.text, level: m.level, ...(m.reason && { reason: m.reason }), ...(m.place && { place: m.place }), at, revisits: 0, fadeFrom: at, about: m.about, focus: m.focus, inRecall: true, topics: m.topics })
  }

  const cards = scenarioContent(content, scenario)
  const facts = Object.fromEntries(Object.entries(s.facts).map(([id, ids]) => {
    const secrets = characterById(cards, id)?.secrets ?? []
    return [id, ids.flatMap((x) => secrets.filter((y) => y.id === x).map((y) => y.text))]
  }))
  return {
    ...fresh,
    time,
    facts,
    meters: { ...fresh.meters, ...scenario.meters },
    relations,
    playerTies,
    memories,
    aftermath,
    lastSeen: Object.fromEntries(Object.entries(s.lastSeen).map(([id, days]) => [id, ago(days)]))
  }
}

/** Opens one of a scenario's scenes on a state between scenes: its walk-ons, and its moods and comfort over the opening ones. */
export function openScene(content: Pack, state: GameState, scene: Omit<LaterScene, 'days' | 'turns'>, id: string): GameState {
  const opened = startScene(content, state, scene.location, scene.cast, id)
  const moods = Object.fromEntries(Object.entries(scene.moods).flatMap(([who, m]): [string, Feeling][] => {
    const read = readFeeling(content.ruleset, m)
    return 'feeling' in read ? [[who, { ...read.feeling, ...(m.text && { text: m.text }) }]] : []
  }))
  const s = opened.scene!
  return { ...opened, scene: { ...s, ...(scene.walkOns && { walkOns: scene.walkOns }), moods: { ...s.moods, ...moods }, comfort: { ...s.comfort, ...scene.comfort } } }
}

/** The game state a scenario opens on: its first scene, with any history already played. */
export function scenarioState(content: Pack, scenario: Scenario): GameState {
  const played = scenarioContent(content, scenario)
  const first = scenesOf(scenario)[0]!
  const seeded = seededState(content, scenario)
  const state = openScene(played, seeded, first, `scene-${seeded.time}`)
  const turns = scenario.history
  // The running summary holds what fell out of the prompts' window, as applyTurn builds it.
  const summary = turns
    .slice(0, Math.max(0, turns.length - RECENT_TURNS))
    .map((t) => turnText(played, state.player.name, t))
    .join('\n\n')
    .slice(-SUMMARY_CHARS)
  // A history turn that carries its records (a logged turn, from to-scenario) is recorded as it was in play, so what
  // the player had heard and the details said are the same (2026-11-24: a replayed later turn's writer was told the
  // player had heard nothing). Authored history has no records and goes in as it is.
  let played_ = { ...state, time: state.time + turns.length * MINUTES_PER_TURN, scene: { ...state.scene!, turns: [] as typeof turns, summary, ...(scenario.opening && { opening: scenario.opening }) } }
  for (const t of turns) {
    played_ = { ...played_, scene: { ...played_.scene, turns: [...played_.scene.turns, t] } }
    if (t.records) played_ = applyRecords(played_, t.records) as typeof played_
  }
  return played_
}
