import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { characterById, locationById, type Pack } from '@engine/pack'
import { firstName, TracedError, type CallTrace } from '@engine/core'
import { endScene, type SceneEndTrace, type Summarize } from '@engine/relationships'
import { promptSources, runTurn, type TurnLlm, type TurnTrace } from '@engine/scene'
import { callTrace, LogSession, promptVersion, readSession, type SessionRecord } from '@platform/logs'
import type { FlagRecord, ScoreRecord } from '@engine/review'
import { loreBudgets, type LoreBudgetOverrides, type LoreBudgets } from '@engine/rules'
import { scenarioProblems, scenarioState, type ExpectedCheck, type Scenario } from './scenario'

export { mockLlm } from './mock'

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
  turns: TurnTrace[]
  sceneEnd?: SceneEndTrace
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
}

/** The seed of a repeat: the scenario's own for the first, then the next ones, so repeats roll differently. */
export const repeatSeed = (scenario: Scenario, repeat: number): number => scenario.seed + repeat - 1

/** Plays one scenario through the real pipeline: every turn, then the end-of-scene summaries. */
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

  // The scene is named after the scenario, so turn ids read e.g. "deception-caught-2".
  let state = scenarioState(content, { ...scenario, seed })
  state = { ...state, scene: { ...state.scene!, id: scenario.id } }
  session?.sceneStart({ sceneId: scenario.id, location: scenario.location, cast: scenario.cast })
  const options = { ...(scenario.forceNatural !== undefined && { forceNatural: scenario.forceNatural }), ...(loreBudgets && { loreBudgets }) }
  let where: 'turn' | 'scene-end' = 'turn'
  try {
    for (const input of scenario.turns) {
      const outcome = await runTurn(content, state, input, llm.turn, () => {}, { ...options, ...(session && { log: session.id }) })
      run.turns.push(outcome.trace)
      session?.turn(outcome.trace)
      state = outcome.state
      if (state.scene?.ended) break
    }
    if (scenario.summaries) {
      where = 'scene-end'
      const end = await endScene(content, state, llm.summarize)
      run.sceneEnd = end.trace
      session?.sceneEnd(end.trace)
    }
  } catch (error) {
    run.error = (error as Error).message
    if (error instanceof TracedError) run.errorCalls = error.calls
    session?.error({ where, message: run.error, sceneId: scenario.id, ...(where === 'turn' && { turnId: `${scenario.id}-${run.turns.length + 1}` }), ...(run.errorCalls && { calls: run.errorCalls }) })
  }
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

/** Every call of a scenario run in order, turns first, then the scene end, then any that failed. */
export const callsOf = (run: ScenarioRun): CallTrace[] => [...run.turns.flatMap((t) => t.calls), ...(run.sceneEnd?.calls ?? []), ...(run.errorCalls ?? [])]

/** `run.json`: the run's settings and where its sessions are; the traces live in the session folders. */
interface RunFile extends Omit<BenchRun, 'scenarios'> {
  scenarios: { id: string; repeat: number; session: string; error?: string; expectedCheck?: ExpectedCheck }[]
}

export function writeRun(out: string, bench: BenchRun): void {
  mkdirSync(out, { recursive: true })
  const { scenarios, ...rest } = bench
  const file: RunFile = { ...rest, scenarios: scenarios.map((s) => ({ id: s.id, repeat: s.repeat, session: s.session, ...(s.expectedCheck && { expectedCheck: s.expectedCheck }), ...(s.error && { error: s.error }) })) }
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
    const failed = log.errors[0]
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
      ...(end && { sceneEnd: { ...end, calls: calls(end.calls) } }),
      ...(entry.error && { error: entry.error }),
      ...(failed?.calls && { errorCalls: calls(failed.calls) }),
      flags: log.flags,
      scores: log.scores
    }
  })
  return { ...file, scenarios }
}

/** A display name for an id in a scenario's place: a character's first name, a walk-on's name, or the id. */
export function nameIn(content: Pack, location: string, id: string): string {
  const c = characterById(content, id)
  if (c) return firstName(c.name)
  const w = locationById(content, location)?.walkOns.find((x) => x.id === id)
  return w?.name ?? w?.label ?? id
}
