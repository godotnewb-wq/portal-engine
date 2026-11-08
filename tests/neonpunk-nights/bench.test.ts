import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSession } from '@platform/logs'
import { describe, expect, it } from 'vitest'
import { content, PACK_DIR } from './support'
import { SettingsSchema } from '@llm'
import { benchSettings, modelsOf } from '../../tools/bench/config'
import { compareRuns, renderReport, stats } from '../../tools/bench/report'
import { callsOf, mockLlm, readRun, runBench, runScenario, writeRun, type BenchLlm } from '../../tools/bench/run'
import { loadScenarios, scenarioProblems, scenarioState, ScenarioSchema } from '../../tools/bench/scenario'

const scenarios = loadScenarios(join(PACK_DIR, 'bench'))

describe('the shipped scenarios', () => {
  it('cover the plan’s cases and all fit the content', () => {
    expect(scenarios.map((s) => s.id)).toEqual(['deception-caught', 'deception-uncaught', 'tense-negotiation', 'three-way-argument', 'tram-attempt', 'tram-small-talk', 'tram-stay-or-go', 'warmth-gone-wrong'])
    for (const s of scenarios) expect(scenarioProblems(content, s), s.id).toEqual([])
  })

  it('open on their own starting feelings and moods', () => {
    const warm = scenarios.find((s) => s.id === 'warmth-gone-wrong')!
    const state = scenarioState(content, warm)
    expect(state.meters['vex']).toEqual({ approval: 62, trust: 55, attraction: 20 })
    expect(state.scene!.moods['vex']).toMatch(/a drink in/)
    expect(state.scene!.cast).toEqual(['vex', 'brask'])
  })
})

describe('runBench (acceptance 9: the bench runs its scenarios)', () => {
  it('plays every scenario through the pipeline with the mock and records it', async () => {
    const bench = await runBench(content, scenarios, mockLlm(), 'test', { all: 'mock' })
    expect(bench.scenarios.map((s) => s.error)).toEqual(scenarios.map(() => undefined))
    for (const run of bench.scenarios) {
      expect(run.turns).toHaveLength(3)
      expect(run.sceneEnd!.witnesses.length).toBeGreaterThan(0)
      expect(stats(run).calls).toBe(6)
    }
    const report = renderReport(content, bench)
    expect(report).toMatch(/^# Scene test bench — test/)
    expect(report).toMatch(/\| three-way-argument \| 3 \| 6 \|/)
    expect(report).toMatch(/Checks forced to a natural 18/)
  })

  it('writes the play-log layout, one session folder per scenario and repeat, and reads back to the same report', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bench-'))
    const bench = await runBench(content, scenarios.slice(0, 2), mockLlm(), 'test', { all: 'mock' }, { out, repeat: 2 })
    writeRun(out, bench)
    expect(readdirSync(out).sort()).toEqual(['deception-caught-1', 'deception-caught-2', 'deception-uncaught-1', 'deception-uncaught-2', 'run.json'])
    expect(bench.scenarios.map((s) => [s.id, s.repeat, s.seed])).toEqual([['deception-caught', 1, 11], ['deception-caught', 2, 12], ['deception-uncaught', 1, 11], ['deception-uncaught', 2, 12]])
    const log = readSession(join(out, 'deception-caught-1'))
    expect(log.session).toMatchObject({ kind: 'bench', bench: { scenario: 'deception-caught', repeat: 1, forceNatural: 18 }, endedAt: expect.any(String) })
    expect(log.turns.map((t) => t.turnId)).toEqual(['deception-caught-1', 'deception-caught-2', 'deception-caught-3'])
    expect(log.scenes.map((s) => s.type)).toEqual(['start', 'end'])
    const back = readRun(out)
    expect(renderReport(content, back)).toBe(renderReport(content, bench))
    expect(back.scenarios[0]!.turns[0]!.calls[0]!.prompt).toEqual(bench.scenarios[0]!.turns[0]!.calls[0]!.prompt)
  })
})

describe('runScenario', () => {
  const caught = scenarios.find((s) => s.id === 'deception-caught')!
  const plan = JSON.stringify({
    speakers: [{ id: 'oria', intent: 'Lie.', mood: 'composed', hiding: 'the consortium', approach: 'lie' }, { id: 'vex', intent: 'Catch it.', mood: 'wary', depends_on_check: 'e' }],
    checks: [{ id: 'e', who: 'vex', skill: 'empathy', difficulty: 'moderate', stakes: 'notices the lie' }]
  })
  /** A director that always plans the worked example; a writer whose first draft gives Brask an unplanned line. */
  const scripted = (): BenchLlm => {
    let writes = 0
    return {
      turn: {
        direct: async () => plan,
        write: async (_p, onDelta) => {
          writes++
          const reply = `Oria: "A collector, darling."\nVex: "Liar."${writes === 1 ? '\nBrask: "Can we go?"' : ''}`
          onDelta(reply)
          return reply
        }
      },
      summarize: mockLlm().summarize
    }
  }

  it('records each call by role, with the prompt and raw reply, and names the rewrite', async () => {
    const run = await runScenario(content, { ...caught, turns: [caught.turns[0]!], summaries: false }, scripted())
    const calls = callsOf(run)
    expect(calls.map((c) => c.role)).toEqual(['director', 'writer', 'rewrite'])
    expect(calls[0]!.prompt.user).toMatch(/who's the client/)
    expect(calls[1]!.reply).toMatch(/Brask: "Can we go\?"/)
    expect(calls[1]!.firstTextMs).toBeDefined()
    expect(run.turns[0]!.findings.map((p) => p.fix)).toEqual(['Beat 3: Brask was not planned to speak. Show them only through a reaction in narration.'])
  })

  it('forces the scenario’s rolls', async () => {
    const run = await runScenario(content, { ...caught, turns: [caught.turns[0]!], summaries: false }, scripted())
    expect(run.turns[0]!.checks.map((c) => c.line)).toEqual(['Vex — Empathy 21 vs 15: strong success'])
    const missed = await runScenario(content, { ...caught, forceNatural: 3, turns: [caught.turns[0]!], summaries: false }, scripted())
    expect(missed.turns[0]!.checks[0]!.line).toMatch(/: failure$/)
  })

  it('stops a scenario that doesn’t fit the content before calling anything', async () => {
    const bad = ScenarioSchema.parse({ id: 'bad', title: 'Bad', watchFor: '', location: 'nowhere', cast: ['ghost'], turns: ['Hi'] })
    const run = await runScenario(content, bad, mockLlm())
    expect(run.error).toBe('unknown location "nowhere"; unknown character "ghost"')
    expect(callsOf(run)).toEqual([])
  })

  it('records a failure mid-run and keeps what came before', async () => {
    let n = 0
    const failing: BenchLlm = { ...mockLlm(), turn: { ...mockLlm().turn, direct: async () => (++n === 2 ? Promise.reject(new Error('rate limited')) : '{}') } }
    const run = await runScenario(content, caught, failing)
    expect(run.turns).toHaveLength(1)
    expect(run.error).toBe('rate limited')
    expect(callsOf(run).at(-1)).toMatchObject({ role: 'director', error: 'rate limited' })
  })
})

describe('compareRuns', () => {
  it('puts two runs’ numbers and beats side by side, and notes scenarios only one ran', async () => {
    const a = await runBench(content, scenarios.slice(0, 2), mockLlm(), 'A', { all: 'mock' })
    const b = await runBench(content, scenarios.slice(0, 1), mockLlm(), 'B', { all: 'mock' })
    const md = compareRuns(content, a, b)
    expect(md).toMatch(/^# Bench comparison: A vs B/)
    expect(md).toMatch(/\| A \| deception-caught \|/)
    expect(md).toMatch(/\| B \| deception-caught \|/)
    expect(md).toMatch(/### Turn 1: So, Oria, who's the client, really\?\n\n\| A \| B \|/)
    expect(md).toMatch(/## `deception-uncaught`\n\nOnly in A\./)
  })
})

describe('benchSettings', () => {
  it('reads one endpoint from the environment; unset roles borrow the writer', () => {
    const settings = benchSettings(undefined, { BENCH_BASE_URL: 'http://x/v1', BENCH_API_KEY: 'k', BENCH_MODEL: 'strong', BENCH_DIRECTOR_MODEL: 'fast' })
    expect(settings.writer).toMatchObject({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'strong' })
    expect(modelsOf(settings)).toEqual({ director: 'fast', writer: 'strong', summary: 'strong' })
    expect(modelsOf(SettingsSchema.parse({}))).toEqual({ director: '(none)', writer: '(none)', summary: '(none)' })
  })
})
