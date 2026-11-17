import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pack } from '@engine/pack'
import { TracedError, type CallTrace } from '@engine/core'
import { consolidate, endScene, judgeScene, nextDay, type ConsolidationTrace, type RelationshipTrace, type SceneEndTrace, type Summarize } from '@engine/relationships'
import { answerTie, GameStateSchema, type GameState } from '@engine/state'
import { promptSources, runTurn, type TurnLlm, type TurnTrace } from '@engine/scene'
import { callTrace, LogSession, promptVersion, readSession, type SessionRecord } from '@platform/logs'
import type { FlagRecord, ScoreRecord } from '@engine/review'
import { loreBudgets, type LoreBudgetOverrides, type LoreBudgets } from '@engine/rules'
import { openScene, sceneIdOf, scenarioContent, scenarioProblems, scenarioState, scenesOf, type ExpectedCheck, type Scenario } from './scenario'
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
  /** 1-based; `--repeat N` plays each scenario N times with different seeds. */
  repeat: number
  seed: number
  /** Its session folder in the run folder. */
  session: string
  /** Every turn, across all its scenes. */
  turns: TurnTrace[]
  /** A one-scene scenario's relationship calls and its close; a scenario with several keeps each scene's under `scenes`. */
  ties?: RelationshipTrace
  sceneEnd?: SceneEndTrace
  /** A scenario with several scenes (milestone 4b): each one, in order. Absent for one scene. */
  scenes?: SceneRun[]
  /** The state the run ended on, for tests; not written to the run folder. */
  state?: GameState
  /** Set if the run stopped early. */
  error?: string
  /** Calls made in the turn or scene end that failed, before the failure. */
  errorCalls?: CallTrace[]
  /** Read back from the session folder: flags made on it and AI scores. */
  flags?: FlagRecord[]
  scores?: ScoreRecord[]
}

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
  options: { repeat: number; summaries: boolean; score?: boolean }
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
export async function runScenario(content: Pack, scenario: Scenario, llm: BenchLlm, repeat = 1, session?: LogSession, loreBudgets?: LoreBudgetOverrides): Promise<ScenarioRun> {
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
  const options = { ...(scenario.forceNatural !== undefined && { forceNatural: scenario.forceNatural }), ...(loreBudgets && { loreBudgets }) }
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
        state = outcome.state
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
  return run
}

export async function runBench(content: Pack, scenarios: Scenario[], llm: BenchLlm, label: string, models: Record<string, string>, options: BenchOptions = {}): Promise<BenchRun> {
  const repeat = Math.max(1, options.repeat ?? 1)
  const bench: BenchRun = {
    label,
    pack: content.manifest.id,
    packVersion: content.manifest.version,
    prompts: promptVersion(promptSources(content)),
    engine: options.engine ?? '',
    startedAt: new Date().toISOString(),
    models,
    options: { repeat, summaries: scenarios.some((s) => s.summaries) },
    loreBudgets: loreBudgets(content.ruleset, options.loreBudgets),
    inputs: runInputs(content, scenarios, { ...(options.source && { source: options.source }), roles: options.roles ?? {} }),
    scenarios: []
  }
  const log = options.log ?? (() => {})
  // One at a time: providers often limit concurrent requests, and timings mean more without contention.
  for (const scenario of scenarios) {
    for (let n = 1; n <= repeat; n++) {
      log(`▸ ${scenario.id}${repeat > 1 ? ` #${n}` : ''}`)
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
              bench: { run: label, scenario: scenario.id, repeat: n, seed: repeatSeed(scenario, n), watchFor: scenario.watchFor, title: scenario.title, location: scenario.location, ...(scenario.forceNatural !== undefined && { forceNatural: scenario.forceNatural }) }
            },
            new Date(),
            `${scenario.id}-${n}`
          )
        : undefined
      const run = await runScenario(content, scenario, llm, n, session, options.loreBudgets)
      session?.close()
      const calls = callsOf(run).length
      log(run.error ? `  stopped: ${run.error}` : `  ${run.turns.length} turns, ${calls} calls, ${run.turns.filter((t) => t.rewrite).length} rewrites`)
      bench.scenarios.push(run)
    }
  }
  return bench
}

/** A scenario run as the metrics read it (milestone 2, B2). */
export const metricInputOf = (run: ScenarioRun) => ({ session: run.session, turns: run.turns, calls: callsOf(run), flags: run.flags ?? [], scores: run.scores ?? [], errors: run.error ? [{ at: '', where: 'turn' as const, message: run.error }] : [] })

/** A scene's turns in a scenario run with several scenes. */
export const turnsOf = (run: ScenarioRun, scene: SceneRun): TurnTrace[] => run.turns.filter((t) => t.sceneId === scene.id)

/**
 * Every call of a scenario run in order: turns first, then the scene end (the relationship calls, then the memory calls), then any that failed. With several scenes,
 * scene by scene: the nights' consolidations before it, its turns, its summaries.
 */
export function callsOf(run: ScenarioRun): CallTrace[] {
  const played = run.scenes
    ? run.scenes.flatMap((s) => [...s.consolidations.flatMap((c) => c.calls), ...turnsOf(run, s).flatMap((t) => t.calls), ...(s.ties?.calls ?? []), ...(s.sceneEnd?.calls ?? [])])
    : [...run.turns.flatMap((t) => t.calls), ...(run.ties?.calls ?? []), ...(run.sceneEnd?.calls ?? [])]
  return [...played, ...(run.errorCalls ?? [])]
}

/** `run.json`: the run's settings and where its sessions are; the traces live in the session folders. */
interface RunFile extends Omit<BenchRun, 'scenarios'> {
  /** `days`: a scenario with several scenes, the days before each (milestone 4b). */
  scenarios: { id: string; repeat: number; session: string; error?: string; expectedCheck?: ExpectedCheck; days?: number[] }[]
}

export function writeRun(out: string, bench: BenchRun): void {
  mkdirSync(out, { recursive: true })
  const { scenarios, ...rest } = bench
  const file: RunFile = { ...rest, scenarios: scenarios.map((s) => ({ id: s.id, repeat: s.repeat, session: s.session, ...(s.expectedCheck && { expectedCheck: s.expectedCheck }), ...(s.scenes && { days: s.scenes.map((x) => x.days) }), ...(s.error && { error: s.error }) })) }
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
      ...(scenes ? { scenes } : { ...(ties && { ties: { ...ties, calls: calls(ties.calls) } }), ...(end && { sceneEnd: { ...end, calls: calls(end.calls) } }) }),
      ...(entry.error && { error: entry.error }),
      ...(failed?.calls && { errorCalls: calls(failed.calls) }),
      flags: log.flags,
      scores: log.scores
    }
  })
  return { ...file, scenarios }
}
