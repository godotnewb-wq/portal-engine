import type { Beat } from '@engine/state'
import { characterById, locationById, type Content } from '@engine/pack'
import type { Prompt } from '@engine/core'
import { firstName } from '@engine/core'
import type { WitnessReport } from '@engine/relationships'
import { endScene, type Summarize } from '@engine/relationships'
import { runTurn, type TurnLlm } from '@engine/scene'
import { scenarioProblems, scenarioState, type Scenario } from './scenario'

/** One LLM call as the bench saw it: the prompt, the raw reply, and how long it took. */
export interface CallRecord {
  turn: number | 'summary'
  role: 'director' | 'writer' | 'rewrite' | 'summary'
  system: string
  user: string
  reply: string
  ms: number
  /** Time until the first streamed text arrived (writer and rewrite only). */
  firstTextMs?: number
  error?: string
}

export interface TurnRecord {
  input: string
  speakers: { id: string; intent: string; mood: string; hiding?: string; approach?: string }[]
  reactions: { id: string; beat: string }[]
  checks: string[]
  texture: string[]
  corrections: string[]
  fallback: boolean
  beats: Beat[]
  /** Fixes asked of the rewrite; empty when the draft passed. */
  rewrite: string[]
  /** Problems still in the rewrite, salvaged by code. */
  remaining: string[]
  calls: number
  ms: number
}

export interface ScenarioRun {
  id: string
  title: string
  location: string
  watchFor: string
  forceNatural?: number
  turns: TurnRecord[]
  summaries: WitnessReport[]
  calls: CallRecord[]
  /** Set if the run stopped early. */
  error?: string
}

export interface BenchRun {
  label: string
  startedAt: string
  /** Which models played each role, for reading results later. */
  models: Record<string, string>
  scenarios: ScenarioRun[]
}

/** The LLM calls the bench makes, through whatever profiles or mocks the caller set up. */
export interface BenchLlm {
  turn: TurnLlm
  summarize: Summarize
}

/** Wraps the LLM so every call is recorded with its prompt, reply and timing. */
function recording(llm: BenchLlm, calls: CallRecord[], turn: () => number | 'summary'): BenchLlm {
  const timed = async (role: CallRecord['role'], prompt: Prompt, run: (markFirst: () => void) => Promise<string>): Promise<string> => {
    const start = performance.now()
    let firstTextMs: number | undefined
    const markFirst = () => {
      firstTextMs ??= Math.round(performance.now() - start)
    }
    try {
      const reply = await run(markFirst)
      calls.push({ turn: turn(), role, system: prompt.system, user: prompt.user, reply, ms: Math.round(performance.now() - start), ...(firstTextMs !== undefined && { firstTextMs }) })
      return reply
    } catch (error) {
      calls.push({ turn: turn(), role, system: prompt.system, user: prompt.user, reply: '', ms: Math.round(performance.now() - start), error: (error as Error).message })
      throw error
    }
  }
  return {
    turn: {
      direct: (prompt) => timed('director', prompt, () => llm.turn.direct(prompt)),
      write: (prompt, onDelta, onRestart) => {
        // The second writer call in a turn is the rewrite.
        const role = calls.some((c) => c.turn === turn() && c.role === 'writer') ? 'rewrite' : 'writer'
        return timed(role, prompt, (markFirst) => llm.turn.write(prompt, (text) => (markFirst(), onDelta(text)), onRestart))
      }
    },
    summarize: (prompt) => timed('summary', prompt, () => llm.summarize(prompt))
  }
}

/** Plays one scenario through the real pipeline: every turn, then the end-of-scene summaries. */
export async function runScenario(content: Content, scenario: Scenario, llm: BenchLlm): Promise<ScenarioRun> {
  const run: ScenarioRun = { id: scenario.id, title: scenario.title, location: scenario.location, watchFor: scenario.watchFor, ...(scenario.forceNatural !== undefined && { forceNatural: scenario.forceNatural }), turns: [], summaries: [], calls: [] }
  const problems = scenarioProblems(content, scenario)
  if (problems.length > 0) return { ...run, error: problems.join('; ') }

  let current: number | 'summary' = 0
  const recorded = recording(llm, run.calls, () => current)
  let state = scenarioState(content, scenario)
  try {
    for (const [i, input] of scenario.turns.entries()) {
      current = i
      const start = performance.now()
      const outcome = await runTurn(content, state, input, recorded.turn, () => {}, scenario.forceNatural !== undefined ? { forceNatural: scenario.forceNatural } : {})
      run.turns.push({
        input,
        speakers: outcome.plan.speakers.map((s) => ({ id: s.id, intent: s.intent, mood: s.mood, ...(s.hiding && { hiding: s.hiding }), ...(s.approach && { approach: s.approach }) })),
        reactions: outcome.plan.reactions,
        checks: outcome.plan.checks.flatMap((c) => (c.line ? [c.line] : [])),
        texture: outcome.plan.texture,
        corrections: outcome.corrections,
        fallback: outcome.fallback,
        beats: outcome.beats,
        rewrite: outcome.problems.map((p) => p.fix),
        remaining: outcome.remaining.map((p) => p.fix),
        calls: outcome.calls,
        ms: Math.round(performance.now() - start)
      })
      state = outcome.state
      if (state.scene?.ended) break
    }
    if (scenario.summaries) {
      current = 'summary'
      run.summaries = (await endScene(content, state, recorded.summarize)).reports
    }
  } catch (error) {
    run.error = (error as Error).message
  }
  return run
}

export async function runBench(content: Content, scenarios: Scenario[], llm: BenchLlm, label: string, models: Record<string, string>, log: (line: string) => void = () => {}): Promise<BenchRun> {
  const bench: BenchRun = { label, startedAt: new Date().toISOString(), models, scenarios: [] }
  // One at a time: providers often limit concurrent requests, and timings mean more without contention.
  for (const scenario of scenarios) {
    log(`▸ ${scenario.id}`)
    const run = await runScenario(content, scenario, llm)
    log(run.error ? `  stopped: ${run.error}` : `  ${run.turns.length} turns, ${run.calls.length} calls, ${run.turns.filter((t) => t.rewrite.length > 0).length} rewrites`)
    bench.scenarios.push(run)
  }
  return bench
}

/**
 * A stand-in LLM for running the bench without a model: the director's reply is unreadable (so the game plans each
 * turn), and the writer voices whoever the plan says speaks. Proves the harness, not the prose.
 */
export function mockLlm(): BenchLlm {
  return {
    turn: {
      direct: async () => '(mock director: no plan)',
      write: async (prompt, onDelta) => {
        const speakers = [...prompt.user.matchAll(/^- (\S+) speaks\./gm)].map((m) => m[1]!)
        const reply = ['NARRATION: The conduit buzzes overhead.', ...speakers.map((name) => `${name}: "Mock line from ${name}."`)].join('\n')
        onDelta(reply)
        return reply
      }
    },
    summarize: async (prompt) => {
      const who = prompt.user.match(/^About (\S+)/)?.[1] ?? 'Someone'
      return JSON.stringify({ memory: `${who} remembers a mock scene.`, level: 'fleeting', approval: 'unchanged', trust: 'unchanged', attraction: 'a little more' })
    }
  }
}

/** A display name for an id in a scenario's place: a character's first name, a walk-on's name, or the id. */
export function nameIn(content: Content, location: string, id: string): string {
  const c = characterById(content, id)
  if (c) return firstName(c.name)
  const w = locationById(content, location)?.walkOns.find((x) => x.id === id)
  return w?.name ?? w?.label ?? id
}
