import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pack } from '@engine/pack'
import { TracedError, type CallTrace, type LlmReply, type Prompt } from '@engine/core'
import { bookkeepWithin } from '@platform/roles'
import { consolidate, endScene, judgeScene, nextDay, type ConsolidationTrace, type RelationshipTrace, type SceneEndTrace, type Summarize } from '@engine/relationships'
import { answerTie, GameStateSchema, type GameState } from '@engine/state'
import { applyRecords, DEFAULT_PIPELINE, promptSources, runTurn, type BookkeeperTrace, type Pipeline, type TurnLlm, type TurnTrace } from '@engine/scene'
import { callTrace, LogSession, promptVersion, readSession, type SessionRecord } from '@platform/logs'
import type { FlagRecord, ScoreRecord } from '@engine/review'
import { loreBudgets, type LoreBudgetOverrides, type LoreBudgets } from '@engine/rules'
import { checkTies, openScene, sceneIdOf, scenarioContent, scenarioProblems, scenarioState, scenesOf, type ExpectedCheck, type Scenario, type TieResult } from './scenario'
import { runInputs, type RunInputs } from './inputs'

export { mockLlm } from './mock'
export { nameIn } from './names'

/**
 * One scene of a scenario with several (milestone 4b, task 6): where and with whom, how many days passed before it, and
 * what ran between: each night's consolidation (only nights that had something to merge) and its end-of-scene summaries.
 * Its turns are the run's turns with its `id` as their `sceneId`.
 */
export interface SceneRun {
  /** 1-based. */
  n: number
  id: string
  location: string
  cast: string[]
  days: number
  consolidations: ConsolidationTrace[]
  /** The witnesses' relationship calls and the ties settled from them (milestone 4c), before the memory calls. */
  ties?: RelationshipTrace
  sceneEnd?: SceneEndTrace
}

/**
 * One play of one scenario, as the turn traces recorded it (milestone 2, A1): the same traces play logs are made of,
 * so bench runs and play sessions are read by the same tools.
 */
export interface ScenarioRun {
  id: string
  title: string
  location: string
  watchFor: string
  forceNatural?: number
  expectedCheck?: ExpectedCheck
  /** The scenario's expected ties, as the play left them (Milestone 5 plan, task 7); absent when it expects none or stopped. */
  tieResults?: TieResult[]
  /** 1-based; `--repeat N` plays each scenario N times with different seeds. */
  repeat: number
  seed: number
  /** Its session folder in the run folder. */
  session: string
  /** Every turn, across all its scenes. */
  turns: TurnTrace[]
  /** Each turn's bookkeeper (milestone 4c), in turn order; absent when the run had none. */
  bookkeeping?: BookkeepingRun[]
  /** A one-scene scenario's relationship calls and its close; a scenario with several keeps each scene's under `scenes`. */
  ties?: RelationshipTrace
  sceneEnd?: SceneEndTrace
  /** A scenario with several scenes (milestone 4b): each one, in order. Absent for one scene. */
  scenes?: SceneRun[]
  /** The state the run ended on, for tests; not written to the run folder. */
  state?: GameState
  /** Set if the run stopped early. */
  error?: string
  /**
   * Earlier plays of this scenario and repeat that stopped, which `--fill` replaced with this one (Milestone 5 plan,
   * task 0b): their session folders stay in the run folder for the record.
   */
  stopped?: { session: string; error: string }[]
  /** Calls made in the turn or scene end that failed, before the failure. */
  errorCalls?: CallTrace[]
  /** Read back from the session folder: flags made on it and AI scores. */
  flags?: FlagRecord[]
  scores?: ScoreRecord[]
}

/** A turn's bookkeeper as the bench keeps it: the trace, and whether the turn stopped waiting for it. */
export type BookkeepingRun = BookkeeperTrace & { late?: boolean }

export interface BenchRun {
  label: string
  /** The pack the scenarios came from, and its version. */
  pack: string
  packVersion: string
  /** A hash of the prompt templates, style guide, phrase lists and tone. */
  prompts: string
  engine: string
  startedAt: string
  /** Which models played each role, for reading results later. */
  models: Record<string, string>
  /** `pipeline`: which pipeline made the turns (Milestone 5); absent in runs from before the choice, which are all `situation` since Milestone 3.6. */
  options: { repeat: number; summaries: boolean; score?: boolean; pipeline?: Pipeline }
  /** The lore budgets every turn ran with, and which came from the config; absent in runs from before they could be set. */
  loreBudgets?: LoreBudgets
  /** What the run was given, so comparisons can match inputs (milestone 3.6); absent in older runs. */
  inputs?: RunInputs
  scenarios: ScenarioRun[]
}

/** The LLM calls the bench makes, through whatever profiles or mocks the caller set up. */
export interface BenchLlm {
  turn: TurnLlm
  summarize: Summarize
  /**
   * The bookkeeper's call after each turn (milestone 4c), and how long to wait for it (the answering profile's
   * timeout, as in play; decision I). Left out, turns keep the plan's records.
   */
  bookkeeper?: { call: (prompt: Prompt) => Promise<LlmReply>; waitMs: number }
}

export interface BenchOptions {
  repeat?: number
  /** Where the run's session folders go; none writes nothing (tests). */
  out?: string
  engine?: string
  /** The models as `session.json` keeps them (no keys). */
  roleModels?: SessionRecord['models']
  log?: (line: string) => void
  /** Lore budgets over the pack's (`bench.config.json`'s `loreBudgets`), as the app's Settings give them. */
  loreBudgets?: LoreBudgetOverrides
  /** The code's git revision (`sourceRevision`), for the run's inputs. */
  source?: RunInputs['source']
  /** Each role's model settings without keys (`roleSettings`), for the run's inputs. */
  roles?: RunInputs['roles']
  /** Which pipeline makes the turns (`--pipeline`); `situation` when unset. */
  pipeline?: Pipeline
}

/** The seed of a repeat: the scenario's own for the first, then the next ones, so repeats roll differently. */
export const repeatSeed = (scenario: Scenario, repeat: number): number => scenario.seed + repeat - 1

/** Answers every tie change waiting for the player's agreement, as the scenario says (milestone 4b). */
function answerAll(content: Pack, state: GameState, answer: Scenario['answerTies']): GameState {
  let next = state
  while (next.scene && next.scene.pendingTies.length > 0) next = answerTie(content, next, 0, answer === 'yes')
  return next
}

/** A save and reload, as between play sessions: the state through JSON and the save schema. */
const reload = (state: GameState): GameState => GameStateSchema.parse(JSON.parse(JSON.stringify(state)))

/**
 * Plays one scenario through the real pipeline: every turn, then the end-of-scene summaries. A scenario with later
 * scenes goes on as play would (milestone 4b): a save and reload, each Next day's upkeep and consolidation, then the
 * next scene opens on what the last one left.
 */
export async function runScenario(content: Pack, scenario: Scenario, llm: BenchLlm, repeat = 1, session?: LogSession, loreBudgets?: LoreBudgetOverrides, pipeline?: Pipeline): Promise<ScenarioRun> {
  const seed = repeatSeed(scenario, repeat)
  const run: ScenarioRun = {
    id: scenario.id,
    title: scenario.title,
    location: scenario.location,
    watchFor: scenario.watchFor,
    ...(scenario.forceNatural !== undefined && { forceNatural: scenario.forceNatural }),
    ...(scenario.expectedCheck && { expectedCheck: scenario.expectedCheck }),
    repeat,
    seed,
    session: session?.id ?? `${scenario.id}-${repeat}`,
    turns: []
  }
  const problems = scenarioProblems(content, scenario)
  if (problems.length > 0) return { ...run, error: problems.join('; ') }

  const played = scenarioContent(content, scenario)
  const scenes = scenesOf(scenario)
  if (scenes.length > 1) run.scenes = []
  const options = { ...(scenario.forceNatural !== undefined && { forceNatural: scenario.forceNatural }), ...(loreBudgets && { loreBudgets }), ...(pipeline && { pipeline }) }
  let state: GameState | undefined
  let where: 'turn' | 'scene-end' = 'turn'
  let sceneId = scenario.id
  let turnInScene = 0
  try {
    for (const scene of scenes) {
      // Scenes are named after the scenario, so turn ids read e.g. "deception-caught-2", then "…-s2-1" in a second scene.
      sceneId = sceneIdOf(scenario, scene.n)
      turnInScene = 0
      const part: SceneRun = { n: scene.n, id: sceneId, location: scene.location, cast: scene.cast, days: scene.days, consolidations: [] }
      if (!state) state = scenarioState(content, { ...scenario, seed })
      else {
        where = 'scene-end'
        state = reload(state)
        for (let day = 0; day < scene.days; day++) {
          state = nextDay(played, state)
          const night = await consolidate(played, state, llm.summarize)
          state = night.state
          if (night.trace.groups.length > 0) {
            part.consolidations.push(night.trace)
            session?.consolidation(night.trace)
          }
        }
        state = openScene(played, state, scene, sceneId)
      }
      state = { ...state, scene: { ...state.scene!, id: sceneId } }
      run.scenes?.push(part)
      session?.sceneStart({ sceneId, location: scene.location, cast: scene.cast })
      where = 'turn'
      for (const input of scene.turns) {
        const outcome = await runTurn(played, state, input, llm.turn, () => {}, { ...options, ...(session && { log: session.id }) })
        run.turns.push(outcome.trace)
        turnInScene++
        session?.turn(outcome.trace)
        // As the app does, before the next turn: the bookkeeper reads the turn and its records replace the plan's.
        if (llm.bookkeeper) {
          const last = outcome.state.scene!.turns.at(-1)!
          const kept = await bookkeepWithin(played, state, { id: last.id, input, beats: last.beats, plan: outcome.plan }, llm.bookkeeper.call, llm.bookkeeper.waitMs)
          ;(run.bookkeeping ??= []).push({ ...kept.trace, ...(kept.late && { late: true }) })
          session?.bookkeeping(kept.trace, kept.late)
          state = applyRecords(outcome.state, kept.records)
        } else state = outcome.state
        if (state.scene?.ended) break
      }
      if (scenario.summaries) {
        // As the app does: the relationship calls and the ties settled from them, the player's answers, then the memory calls.
        where = 'scene-end'
        const checked = await judgeScene(played, state, llm.summarize)
        state = answerAll(played, checked.state, scenario.answerTies)
        if (checked.trace.calls.length > 0) {
          if (run.scenes) part.ties = checked.trace
          else run.ties = checked.trace
          session?.ties(checked.trace)
        }
        const end = await endScene(played, state, llm.summarize)
        state = end.state
        if (run.scenes) part.sceneEnd = end.trace
        else run.sceneEnd = end.trace
        session?.sceneEnd(end.trace)
      } else state = { ...state, scene: null }
    }
  } catch (error) {
    run.error = (error as Error).message
    if (error instanceof TracedError) run.errorCalls = error.calls
    session?.error({ where, message: run.error, sceneId, ...(where === 'turn' && { turnId: `${sceneId}-${turnInScene + 1}` }), ...(run.errorCalls && { calls: run.errorCalls }) })
  }
  if (state) run.state = state
  if (state && !run.error && scenario.expectedTies.length > 0) run.tieResults = checkTies(state, scenario.expectedTies)
  return run
}

/**
 * One play of a scenario as part of a run: its session folder (when the run writes one) under `sessionId`, with the
 * run's pack, prompts, models, lore budgets and pipeline. `runBench` and `fillRun` both play through here, so a play
 * that fills a stopped one is made exactly as the run's others were.
 */
async function playOne(content: Pack, bench: BenchRun, scenario: Scenario, llm: BenchLlm, n: number, sessionId: string, options: Pick<BenchOptions, 'out' | 'roleModels' | 'loreBudgets'>): Promise<ScenarioRun> {
  const session = options.out
    ? LogSession.open(
        options.out,
        {
          kind: 'bench',
          pack: { id: bench.pack, version: bench.packVersion },
          engine: bench.engine,
          prompts: bench.prompts,
          models: options.roleModels ?? {},
          from: scenario.id,
          bench: { run: bench.label, scenario: scenario.id, repeat: n, seed: repeatSeed(scenario, n), watchFor: scenario.watchFor, title: scenario.title, location: scenario.location, ...(scenario.forceNatural !== undefined && { forceNatural: scenario.forceNatural }) }
        },
        new Date(),
        sessionId
      )
    : undefined
  const run = await runScenario(content, scenario, llm, n, session, options.loreBudgets, bench.options.pipeline)
  session?.close()
  return run
}

export async function runBench(content: Pack, scenarios: Scenario[], llm: BenchLlm, label: string, models: Record<string, string>, options: BenchOptions = {}): Promise<BenchRun> {
  const repeat = Math.max(1, options.repeat ?? 1)
  const pipeline = options.pipeline ?? DEFAULT_PIPELINE
  const bench: BenchRun = {
    label,
    pack: content.manifest.id,
    packVersion: content.manifest.version,
    prompts: promptVersion(promptSources(content, pipeline)),
    engine: options.engine ?? '',
    startedAt: new Date().toISOString(),
    models,
    options: { repeat, summaries: scenarios.some((s) => s.summaries), pipeline },
    loreBudgets: loreBudgets(content.ruleset, options.loreBudgets),
    inputs: runInputs(content, scenarios, { ...(options.source && { source: options.source }), roles: options.roles ?? {} }),
    scenarios: []
  }
  const log = options.log ?? (() => {})
  // One at a time: providers often limit concurrent requests, and timings mean more without contention.
  for (const scenario of scenarios) {
    for (let n = 1; n <= repeat; n++) {
      log(`▸ ${scenario.id}${repeat > 1 ? ` #${n}` : ''}`)
      const run = await playOne(content, bench, scenario, llm, n, `${scenario.id}-${n}`, options)
      log(run.error ? `  stopped: ${run.error}` : `  ${run.turns.length} turns, ${callsOf(run).length} calls, ${run.turns.filter((t) => t.rewrite).length} rewrites`)
      bench.scenarios.push(run)
    }
  }
  return bench
}

/** What `fillRun` did: the plays it replaced, and those still stopped after every try. */
export interface FillResult {
  bench: BenchRun
  /** "id #repeat", each a play that now runs to the end. */
  filled: string[]
  /** "id #repeat: error", each a play that stopped on every try; comparisons leave it out of both sides. */
  still: string[]
}

/**
 * Re-plays a run's stopped plays into the same run (Milestone 5 plan, task 0b: no comparison on uneven plays). A
 * provider error or timeout can stop a play partway; comparing a run with stopped plays against one without would
 * compare different scenarios. Each stopped play is played again with its own repeat and seed, up to `tries` times,
 * into a new session folder (`<id>-<repeat>-fill<k>`); the first that runs to the end takes its place, and the stopped
 * ones stay in the run folder, listed under `stopped`. The caller checks first that the run's inputs still hold
 * (`fillProblems`).
 */
export async function fillRun(content: Pack, bench: BenchRun, scenarios: Scenario[], llm: BenchLlm, options: Pick<BenchOptions, 'out' | 'roleModels' | 'loreBudgets' | 'log'> & { tries?: number } = {}): Promise<FillResult> {
  const tries = Math.max(1, options.tries ?? 2)
  const log = options.log ?? (() => {})
  const filled: string[] = []
  const still: string[] = []
  const plays = [...bench.scenarios]
  for (const [i, old] of plays.entries()) {
    if (!old.error) continue
    const name = `${old.id} #${old.repeat}`
    const scenario = scenarios.find((s) => s.id === old.id)
    if (!scenario) {
      still.push(`${name}: the scenario isn't in the pack any more`)
      continue
    }
    let current = old
    const stopped = [...(old.stopped ?? [])]
    for (let k = 1; k <= tries && current.error; k++) {
      stopped.push({ session: current.session, error: current.error })
      log(`▸ ${name}, try ${k} of ${tries}`)
      current = await playOne(content, bench, scenario, llm, old.repeat, `${old.id}-${old.repeat}-fill${stopped.length}`, options)
      log(current.error ? `  stopped: ${current.error}` : `  ${current.turns.length} turns, ${callsOf(current).length} calls`)
    }
    // The last try is the play, whether or not it ran to the end; every earlier one that stopped is the record.
    plays[i] = { ...current, ...(stopped.length > 0 && { stopped }) }
    if (current.error) still.push(`${name}: ${current.error}`)
    else filled.push(name)
  }
  return { bench: { ...bench, scenarios: plays }, filled, still }
}

/** The run's recorded inputs that no longer hold, in words: a run is filled only on the inputs it was made with. */
export function fillProblems(bench: BenchRun, now: { prompts: string; inputs: RunInputs; loreBudgets: LoreBudgets }): string[] {
  const problems: string[] = []
  if (!bench.inputs) return ['the run recorded no inputs (it predates Milestone 3.6), so it can\'t be checked']
  const was = bench.inputs
  if (bench.prompts !== now.prompts) problems.push(`the prompt version is \`${now.prompts}\`, not the run's \`${bench.prompts}\``)
  if (was.pack !== now.inputs.pack) problems.push("the pack's content changed")
  if (was.source && now.inputs.source && was.source.commit !== now.inputs.source.commit) problems.push(`the code is at \`${now.inputs.source.commit.slice(0, 7)}\`, not the run's \`${was.source.commit.slice(0, 7)}\``)
  if (now.inputs.source?.dirty && !was.source?.dirty) problems.push('the checkout has uncommitted changes the run didn\'t have')
  for (const s of bench.scenarios.filter((x) => x.error)) if (was.scenarios[s.id] && now.inputs.scenarios[s.id] && was.scenarios[s.id] !== now.inputs.scenarios[s.id]) problems.push(`scenario ${s.id} changed`)
  for (const role of new Set([...Object.keys(was.roles), ...Object.keys(now.inputs.roles)])) if (JSON.stringify(was.roles[role]) !== JSON.stringify(now.inputs.roles[role])) problems.push(`the ${role}'s model settings changed`)
  if (bench.loreBudgets && JSON.stringify(bench.loreBudgets) !== JSON.stringify(now.loreBudgets)) problems.push('the lore budgets changed')
  return problems
}

/** A scenario run as the metrics read it (milestone 2, B2). */
export const metricInputOf = (run: ScenarioRun) => ({ session: run.session, turns: run.turns, calls: callsOf(run), flags: run.flags ?? [], scores: run.scores ?? [], errors: run.error ? [{ at: '', where: 'turn' as const, message: run.error }] : [] })

/** A scene's turns in a scenario run with several scenes. */
export const turnsOf = (run: ScenarioRun, scene: SceneRun): TurnTrace[] => run.turns.filter((t) => t.sceneId === scene.id)

/**
 * Every call of a scenario run in order: turns first (each with its bookkeeper's), then the scene end (the relationship calls, then the memory calls), then any that failed. With several scenes,
 * scene by scene: the nights' consolidations before it, its turns, its summaries.
 */
export function callsOf(run: ScenarioRun): CallTrace[] {
  // Each turn's calls, then its bookkeeper's (milestone 4c).
  const turn = (t: TurnTrace) => [...t.calls, ...(run.bookkeeping?.find((b) => b.turnId === t.turnId)?.calls ?? [])]
  const played = run.scenes
    ? run.scenes.flatMap((s) => [...s.consolidations.flatMap((c) => c.calls), ...turnsOf(run, s).flatMap(turn), ...(s.ties?.calls ?? []), ...(s.sceneEnd?.calls ?? [])])
    : [...run.turns.flatMap(turn), ...(run.ties?.calls ?? []), ...(run.sceneEnd?.calls ?? [])]
  return [...played, ...(run.errorCalls ?? [])]
}

/** `run.json`: the run's settings and where its sessions are; the traces live in the session folders. */
interface RunFile extends Omit<BenchRun, 'scenarios'> {
  /** `days`: a scenario with several scenes, the days before each (milestone 4b). */
  scenarios: { id: string; repeat: number; session: string; error?: string; expectedCheck?: ExpectedCheck; days?: number[]; stopped?: ScenarioRun['stopped']; tieResults?: TieResult[] }[]
}

export function writeRun(out: string, bench: BenchRun): void {
  mkdirSync(out, { recursive: true })
  const { scenarios, ...rest } = bench
  const file: RunFile = { ...rest, scenarios: scenarios.map((s) => ({ id: s.id, repeat: s.repeat, session: s.session, ...(s.expectedCheck && { expectedCheck: s.expectedCheck }), ...(s.scenes && { days: s.scenes.map((x) => x.days) }), ...(s.error && { error: s.error }), ...(s.stopped && { stopped: s.stopped }), ...(s.tieResults && { tieResults: s.tieResults }) })) }
  writeFileSync(join(out, 'run.json'), JSON.stringify(file, null, 2))
}

/** A run read back from its folder: the traces rebuilt from each session's files, prompts put back together. */
export function readRun(dir: string): BenchRun {
  const file = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunFile
  const scenarios = file.scenarios.map((entry): ScenarioRun => {
    const sessionDir = join(dir, entry.session)
    if (!existsSync(sessionDir)) throw new Error(`${dir}: session folder ${entry.session} is missing`)
    const log = readSession(sessionDir)
    const b = log.session.bench!
    const calls = (ids: string[]) => ids.flatMap((id) => callTrace(log, id) ?? [])
    const ended = log.scenes.find((s) => s.type === 'end')
    const end = ended?.type === 'end' ? (({ type: _type, ...rest }) => rest)(ended) : undefined
    const tied = log.scenes.find((s) => s.type === 'ties')
    const ties = tied?.type === 'ties' ? (({ type: _type, ...rest }) => rest)(tied) : undefined
    const failed = log.errors[0]
    // Several scenes: rebuilt from the scenes file in order; each night's consolidation belongs to the scene after it.
    let scenes: SceneRun[] | undefined
    if (entry.days) {
      scenes = []
      let nights: ConsolidationTrace[] = []
      for (const record of log.scenes) {
        if (record.type === 'consolidation') {
          const { type: _type, calls: ids, ...rest } = record
          nights.push({ ...rest, calls: calls(ids) })
        } else if (record.type === 'start') {
          scenes.push({ n: scenes.length + 1, id: record.sceneId, location: record.location, cast: record.cast, days: entry.days[scenes.length] ?? 0, consolidations: nights })
          nights = []
        } else if (record.type === 'ties') {
          const { type: _type, calls: ids, ...rest } = record
          const scene = scenes.find((s) => s.id === record.sceneId)
          if (scene) scene.ties = { ...rest, calls: calls(ids) }
        } else {
          const { type: _type, calls: ids, ...rest } = record
          const scene = scenes.find((s) => s.id === record.sceneId)
          if (scene) scene.sceneEnd = { ...rest, calls: calls(ids) }
        }
      }
    }
    return {
      id: entry.id,
      title: b.title,
      location: b.location,
      watchFor: b.watchFor,
      ...(b.forceNatural !== undefined && { forceNatural: b.forceNatural }),
      ...(entry.expectedCheck && { expectedCheck: entry.expectedCheck }),
      repeat: entry.repeat,
      seed: b.seed,
      session: entry.session,
      turns: log.turns.map((t) => ({ ...t, calls: calls(t.calls) })),
      ...(log.bookkeeping.length > 0 && { bookkeeping: log.bookkeeping.map(({ calls: ids, ...rest }) => ({ ...rest, calls: calls(ids) })) }),
      ...(scenes ? { scenes } : { ...(ties && { ties: { ...ties, calls: calls(ties.calls) } }), ...(end && { sceneEnd: { ...end, calls: calls(end.calls) } }) }),
      ...(entry.error && { error: entry.error }),
      ...(entry.stopped && { stopped: entry.stopped }),
      ...(entry.tieResults && { tieResults: entry.tieResults }),
      ...(failed?.calls && { errorCalls: calls(failed.calls) }),
      flags: log.flags,
      scores: log.scores
    }
  })
  return { ...file, scenarios }
}
