import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSession } from '@platform/logs'
import { describe, expect, it } from 'vitest'
import { content, PACK_DIR } from './support'
import { SettingsSchema } from '@llm'
import { benchSettings, modelsOf } from '../../tools/bench/config'
import { compareRuns, renderReport, stats } from '../../tools/bench/report'
import { comparability, fingerprint, roleSettings, scenarioFingerprint } from '../../tools/bench/inputs'
import { callsOf, fillProblems, fillRun, mockLlm, readRun, runBench, runScenario, writeRun, type BenchLlm } from '../../tools/bench/run'
import { loreBudgets } from '@engine/rules'
import { loadScenarios, pickScenarios, scenarioProblems, scenarioState, ScenarioSchema } from '../../tools/bench/scenario'

const scenarios = loadScenarios(join(PACK_DIR, 'bench'))
/** Scenarios by id, so a new scenario that sorts first doesn't change what a test plays. */
const byId = (...ids: string[]) => ids.map((id) => scenarios.find((s) => s.id === id)!)

describe('the shipped scenarios', () => {
  it('cover the plan’s cases and all fit the content', () => {
    expect(scenarios.map((s) => s.id)).toEqual([
      'check-fails-honored',
      'crowded-quiet-third',
      'deception-caught',
      'deception-uncaught',
      'forgotten-anniversary',
      'grief-sunny',
      'long-run-memories',
      'long-scene',
      'lore-budget-pressure',
      'lore-departure',
      'lore-invented-gang',
      'lore-long-line',
      'lore-near-miss',
      'lore-new-areas',
      'lore-no-secret-holder',
      'lore-outsider',
      'lore-paraphrase',
      'lore-secret-fishing',
      'lore-species-stereotype',
      'mask-strangers-then-trusted',
      'one-job-hire',
      'repair-with-brask',
      'secret-dormancy',
      'secret-dormant',
      'secret-learned',
      'secret-touched',
      'siblings-on-the-car',
      'tense-negotiation',
      'three-way-argument',
      'tie-breakup-player',
      'tie-breakup',
      'tie-wedding',
      'topic-change',
      'tram-attempt',
      'tram-small-talk',
      'tram-stay-or-go',
      'warmth-gone-wrong'
    ])
    for (const s of scenarios) expect(scenarioProblems(content, s), s.id).toEqual([])
  })

  it('open on their own starting feelings and moods', () => {
    const warm = scenarios.find((s) => s.id === 'warmth-gone-wrong')!
    const state = scenarioState(content, warm)
    expect(state.meters['vex']).toEqual({ approval: 12, trust: 15, interest: 8 })
    expect(state.scene!.moods['vex']).toMatchObject({ shade: 'delight', family: 'joy', intensity: 2, text: expect.stringMatching(/a drink in/) })
    expect(state.scene!.cast).toEqual(['vex', 'brask', 'dunmar'])
  })
})

describe('runBench (acceptance 9: the bench runs its scenarios)', () => {
  it('plays every scenario through the pipeline with the mock and records it', async () => {
    const bench = await runBench(content, scenarios, mockLlm(), 'test', { all: 'mock' })
    expect(bench.scenarios.map((s) => s.error)).toEqual(scenarios.map(() => undefined))
    for (const run of bench.scenarios.filter((r) => !r.scenes)) {
      expect(run.turns).toHaveLength(byId(run.id)[0]!.turns.length)
      expect(run.sceneEnd!.witnesses.length).toBeGreaterThan(0)
      expect(stats(run).calls).toBe(run.turns.length * 2)
    }
    // Several scenes (milestone 4b, task 6): every scene played and summed up, two turn calls a turn.
    for (const run of bench.scenarios.filter((r) => r.scenes)) {
      const s = scenarios.find((x) => x.id === run.id)!
      expect(run.turns).toHaveLength(s.turns.length + s.later.reduce((n, x) => n + x.turns.length, 0))
      expect(run.scenes!.every((x) => x.sceneEnd!.witnesses.length > 0)).toBe(true)
      expect(stats(run).calls).toBe(run.turns.length * 2)
    }
    const report = renderReport(content, bench)
    expect(report).toMatch(/^# Scene test bench — test/)
    expect(report).toMatch(/\| three-way-argument \| 3 \| 6 \|/)
    expect(report).toMatch(/Checks forced to a natural 18/)
    expect(report).toContain('Expected check not exercised on turn 1: vex (empathy).')
    expect(report).toMatch(/Lore scene: ≈\d+ \/ \d+ tokens/)
  })

  it('writes the play-log layout, one session folder per scenario and repeat, and reads back to the same report', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bench-'))
    const bench = await runBench(content, byId('deception-caught', 'deception-uncaught'), mockLlm(), 'test', { all: 'mock' }, { out, repeat: 2 })
    writeRun(out, bench)
    expect(readdirSync(out).sort()).toEqual(['deception-caught-1', 'deception-caught-2', 'deception-uncaught-1', 'deception-uncaught-2', 'run.json'])
    expect(bench.scenarios.map((s) => [s.id, s.repeat, s.seed])).toEqual([['deception-caught', 1, 11], ['deception-caught', 2, 12], ['deception-uncaught', 1, 11], ['deception-uncaught', 2, 12]])
    const log = readSession(join(out, 'deception-caught-1'))
    expect(log.session).toMatchObject({ kind: 'bench', bench: { scenario: 'deception-caught', repeat: 1, forceNatural: 18 }, endedAt: expect.any(String) })
    expect(log.turns.map((t) => t.turnId)).toEqual(['deception-caught-1', 'deception-caught-2', 'deception-caught-3'])
    // The scene opens as in play (Milestone 5 task 8): its opening before its first turn.
    expect(log.scenes.map((s) => s.type)).toEqual(['start', 'opening', 'ties', 'end'])
    // Each turn's bookkeeper (milestone 4c): a line per turn, its call with the others, read back with the run.
    expect(log.bookkeeping.map((b) => b.turnId)).toEqual(['deception-caught-1', 'deception-caught-2', 'deception-caught-3'])
    expect(log.bookkeeping.every((b) => b.records.source === 'bookkeeper')).toBe(true)
    const back = readRun(out)
    expect(back.scenarios[0]!.bookkeeping).toHaveLength(3)
    expect(callsOf(back.scenarios[0]!).filter((c) => c.role === 'bookkeeper')).toHaveLength(3)
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
        write: async (p, onDelta) => {
          // The scene's opening (Milestone 5 task 8) is written first; it isn't one of the turn's drafts.
          if (p.user.trim().endsWith('Write the opening.')) return 'NARRATION: Oria sits alone in her booth.'
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
    expect(run.opening?.beats).toEqual([{ kind: 'narration', text: 'Oria sits alone in her booth.' }])
    expect(calls.map((c) => c.role)).toEqual(['opening', 'director', 'writer', 'rewrite'])
    expect(calls[1]!.prompt.user).toMatch(/who's the client/)
    expect(calls[2]!.reply).toMatch(/Brask: "Can we go\?"/)
    expect(calls[2]!.firstTextMs).toBeDefined()
    expect(run.turns[0]!.findings.map((p) => p.fix)).toEqual(['Beat 3: Brask was not planned to speak. Show them only through a reaction in narration.'])
  })

  it('forces the scenario’s rolls', async () => {
    const run = await runScenario(content, { ...caught, turns: [caught.turns[0]!], summaries: false }, scripted())
    expect(run.turns[0]!.checks.map((c) => c.line)).toEqual(['Vex — Empathy 22 vs 15: strong success'])
    const bench = await runBench(content, [{ ...caught, turns: [caught.turns[0]!], summaries: false }], scripted(), 'test', { all: 'scripted' })
    expect(renderReport(content, bench)).not.toContain('Expected check not exercised')
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
    const a = await runBench(content, byId('deception-caught', 'deception-uncaught'), mockLlm(), 'A', { all: 'mock' })
    const b = await runBench(content, byId('deception-caught'), mockLlm(), 'B', { all: 'mock' })
    const md = compareRuns(content, a, b)
    expect(md).toMatch(/^# Bench comparison: A vs B/)
    expect(md).toMatch(/\| A \| deception-caught ⚠ Expected check not exercised \|/)
    expect(md).toMatch(/\| B \| deception-caught ⚠ Expected check not exercised \|/)
    expect(md).toMatch(/### Turn 1: So, Oria, who's the client, really\?\n\n\| A \| B \|/)
    expect(md).toMatch(/Lore triggered: ≈\d+ \/ \d+ tokens/)
    expect(md).toMatch(/## `deception-uncaught`\n\nOnly in A\./)
  })
})

describe('benchSettings', () => {
  it('reads one endpoint from the environment; unset roles borrow the writer', () => {
    const settings = benchSettings(undefined, { BENCH_BASE_URL: 'http://x/v1', BENCH_API_KEY: 'k', BENCH_MODEL: 'strong', BENCH_DIRECTOR_MODEL: 'fast' })
    expect(settings.writer).toMatchObject({ baseUrl: 'http://x/v1', apiKey: 'k', model: 'strong' })
    expect(modelsOf(settings)).toEqual({ director: 'fast', writer: 'strong', bookkeeper: 'strong', summary: 'strong' })
    expect(modelsOf(SettingsSchema.parse({}))).toEqual({ director: '(none)', writer: '(none)', bookkeeper: '(none)', summary: '(none)' })
  })
})

// Milestone 3.6, task 7 (code review P2): a run records what it was given, and a comparison matches inputs.
describe('run inputs and comparability', () => {
  const two = byId('deception-caught', 'deception-uncaught')
  const run = (label: string, over: Parameters<typeof runBench>[5] = {}, list = two) => runBench(content, list, mockLlm(), label, { all: 'mock' }, over)

  it('records the pack and scenario fingerprints, the names as the pack had them, and the source when given', async () => {
    const bench = await run('A', { source: { commit: 'abc1234def', dirty: true } })
    expect(bench.inputs).toMatchObject({ source: { commit: 'abc1234def', dirty: true }, pack: fingerprint(content), roles: {} })
    expect(Object.keys(bench.inputs!.scenarios)).toEqual(['deception-caught', 'deception-uncaught'])
    expect(bench.inputs!.names).toMatchObject({ vex: 'Vex', 'oria-senn': 'Oria', dunmar: 'Dunmar', 'card-player': 'Hollis' })
    expect(renderReport(content, bench)).toContain('Inputs: source `abc1234` with uncommitted changes, pack content `' + fingerprint(content) + '`.')
    // Line ends don't change a fingerprint.
    expect(fingerprint({ text: 'a\r\nb' })).toBe(fingerprint({ text: 'a\nb' }))
  })

  it('keeps role settings without the key, and with only the endpoint’s host', () => {
    const settings = benchSettings(undefined, { BENCH_BASE_URL: 'https://api.example.com/v1', BENCH_API_KEY: 'secret', BENCH_MODEL: 'strong' })
    const roles = roleSettings(settings, ['director', 'writer'])
    expect(roles['writer']).toMatchObject({ profile: 'writer', host: 'api.example.com', model: 'strong' })
    expect(JSON.stringify(roles)).not.toMatch(/secret|baseUrl|apiKey/)
  })

  it('matches every play of two runs with the same inputs, and reports no differences', async () => {
    const c = comparability(await run('A'), await run('B'))
    expect(c).toMatchObject({ differences: [], left: [], unknown: [] })
    expect(c.matched.map(([a, b]) => [a.id, b.id])).toEqual([['deception-caught', 'deception-caught'], ['deception-uncaught', 'deception-uncaught']])
  })

  it('leaves out a scenario whose content changed, a play only one run has, and says what differs', async () => {
    const changed = [two[0]!, { ...two[1]!, turns: [...two[1]!.turns.slice(0, 2), 'Something else entirely.'] }]
    const a = await run('A', { repeat: 1 })
    const b = await run('B', { repeat: 2, loreBudgets: { loreLines: 1 } }, changed)
    const c = comparability(a, b)
    expect(c.matched.map(([x]) => x.id)).toEqual(['deception-caught'])
    expect(c.left).toEqual(['deception-uncaught #1 (seed 11): the scenario changed between the runs', 'deception-caught #2 (seed 12): only in B', 'deception-uncaught #2 (seed 12): only in B'])
    expect(c.differences).toEqual(expect.arrayContaining(['repeats: A `1`, B `2`', 'lore budgets: A `{"scene":1200,"triggered":800,"lines":3}`, B `{"scene":1200,"triggered":800,"lines":1}`', 'scenario deception-uncaught: its content differs']))
    const md = compareRuns(content, a, b)
    expect(md).toMatch(/## What differs between the runs\n\n- /)
    expect(md).toContain('Compared: 1 matching scenario plays. Left out of the shared metrics (3 of 6 plays):')
    expect(md).toContain('## Metrics (matching scenario plays)')
  })

  it('flags a run with no recorded inputs and matches it on scenario, repeat and seed alone', async () => {
    const { inputs: _gone, ...old } = await run('old')
    const c = comparability(old, await run('new'))
    expect(c.unknown).toEqual(['A'])
    expect(c.matched).toHaveLength(2)
    expect(compareRuns(content, old, await run('new'))).toContain('⚠ Run A recorded no inputs')
  })

  it('names people as each run recorded them, not from the pack loaded now', async () => {
    const a = await run('A', {}, [two[0]!])
    const b = await run('B', {}, [two[0]!])
    b.inputs!.names['oria-senn'] = 'Oriana'
    const md = compareRuns(content, a, b)
    const turn = md.split('### Turn 1')[1]!.split('\n\n### ')[0]!
    const [colA, colB] = turn.split('\n').find((l) => l.startsWith('| ') && !l.startsWith('| A |'))!.split(' | ')
    expect(colA).toContain('**Oria:**')
    expect(colB).toContain('**Oriana:**')
  })
})

describe('the bookkeeper in the report (milestone 4c task 4)', () => {
  it('counts what came out, leaks, fallbacks and the logged mismatches, and shows each turn’s records', async () => {
    const bench = await runBench(content, [scenarios.find((s) => s.id === 'deception-caught')!], mockLlm(), 'test', { all: 'mock' })
    const run = bench.scenarios[0]!
    const [first, second] = [run.turns[0]!, run.turns[1]!]
    const felt = { shade: 'worry', family: 'fear', intensity: 2 }
    first.director.plan.speakers[0] = { ...first.director.plan.speakers[0]!, feels: felt }
    const who = first.director.plan.speakers[0]!.id
    const records = run.bookkeeping!
    records[0] = {
      ...records[0]!,
      records: {
        ...records[0]!.records,
        leaks: [{ secret: 'oria-senn.the-case', by: who, at: 1, words: 'x', why: `${who} couldn't know it` }],
        moods: [{ id: who, feeling: { shade: 'rage', family: 'anger', intensity: 5 } }],
        checks: [{ id: 'c1', honored: false, note: 'played as a success' }],
        changed: 'Everyone knows.'
      }
    }
    records[1] = { ...records[1]!, turnId: second.turnId, late: true, error: 'no answer within 30 seconds', records: { ...records[1]!.records, source: 'plan', unaudited: true } }
    const report = renderReport(content, bench)
    expect(report).toContain('## Bookkeeper')
    expect(report).toMatch(/\| deception-caught \| 3 \| 0 \| 1 \| 0 \| 1 \| 0 \| 0 \| 0 \| 0 \| \d \| 1 \| 1 \| 0 \|/)
    expect(report).toContain('⚠ Leak: `oria-senn.the-case`')
    expect(report).toContain('Mood: ')
    expect(report).toContain('Check not honored: c1 — played as a success')
    expect(report).toContain('⚠ plan-based (unaudited): the turn stopped waiting — no answer within 30 seconds')
    expect(report).toContain('## Tokens by role')
    expect(report).toMatch(/\| bookkeeper \| 3 \|/)
    expect(compareRuns(content, bench, bench)).toContain('## Tokens by role (matching scenario plays)')
  })
})

// Milestone 5 plan, task 0b: runs say which pipeline made them, comparisons leave out plays that stopped, and
// --fill re-plays a run's stopped plays into it on the inputs it recorded.
describe('pipelines, stopped plays and --fill', () => {
  const two = byId('deception-caught', 'deception-uncaught')
  /** A director that fails once, on the second call of the run: the first scenario stops at turn 2, the rest play on. */
  const failingOnce = (message = 'connection timed out'): BenchLlm => {
    let n = 0
    return { ...mockLlm(), turn: { ...mockLlm().turn, direct: async () => (++n === 2 ? Promise.reject(new Error(message)) : '{}') } }
  }
  const alwaysFailing: BenchLlm = { ...mockLlm(), turn: { ...mockLlm().turn, direct: async () => Promise.reject(new Error('provider down')) } }

  it('records the pipeline on the run, its report and every turn', async () => {
    const bench = await runBench(content, two, mockLlm(), 'A', { all: 'mock' })
    expect(bench.options.pipeline).toBe('situation')
    expect(bench.scenarios.flatMap((r) => r.turns).every((t) => t.director.pipeline === 'situation')).toBe(true)
    expect(renderReport(content, bench)).toMatch(/prompts `\w+`, pipeline `situation`/)
  })

  it('compares runs on different pipelines, saying so, and counts a run from before the choice as situation', async () => {
    const a = await runBench(content, two, mockLlm(), 'A', { all: 'mock' })
    const b = await runBench(content, two, mockLlm(), 'B', { all: 'mock' })
    const { pipeline: _gone, ...older } = a.options
    expect(comparability({ ...a, options: older }, b).differences).toEqual([])
    const other = { ...b, options: { ...b.options, pipeline: 'scene' as never } }
    const c = comparability(a, other)
    expect(c.differences).toContain('pipeline: A `situation`, B `scene`')
    expect(c.matched).toHaveLength(2)
  })

  it('leaves a play that stopped on either side out of the shared numbers', async () => {
    const a = await runBench(content, two, failingOnce(), 'A', { all: 'mock' })
    const b = await runBench(content, two, mockLlm(), 'B', { all: 'mock' })
    expect(a.scenarios[0]!.error).toBe('connection timed out')
    const c = comparability(a, b)
    expect(c.matched.map(([x]) => x.id)).toEqual(['deception-uncaught'])
    expect(c.left).toEqual(['deception-caught #1 (seed 11): stopped in A (connection timed out)'])
  })

  it('fills a stopped play into the same run, keeping the stopped one for the record', async () => {
    const out = mkdtempSync(join(tmpdir(), 'fill-'))
    const stopped = await runBench(content, two, failingOnce(), 'A', { all: 'mock' }, { out })
    writeRun(out, stopped)
    const result = await fillRun(content, readRun(out), two, mockLlm(), { out })
    expect(result.filled).toEqual(['deception-caught #1'])
    expect(result.still).toEqual([])
    const play = result.bench.scenarios[0]!
    expect(play).toMatchObject({ session: 'deception-caught-1-fill1', seed: 11, stopped: [{ session: 'deception-caught-1', error: 'connection timed out' }] })
    expect(play.error).toBeUndefined()
    expect(play.turns).toHaveLength(3)
    // The other play is untouched, and the stopped one's folder stays.
    expect(result.bench.scenarios[1]!.session).toBe('deception-uncaught-1')
    expect(existsSync(join(out, 'deception-caught-1'))).toBe(true)
    writeRun(out, result.bench)
    const back = readRun(out)
    expect(back.scenarios[0]!.stopped).toEqual(play.stopped)
    expect(renderReport(content, back)).toContain('**Re-played** with `--fill` after a play that stopped: `deception-caught-1` (connection timed out).')
    // Filled, it compares whole against a run that never stopped.
    const c = comparability(back, await runBench(content, two, mockLlm(), 'B', { all: 'mock' }))
    expect(c).toMatchObject({ left: [], differences: [] })
    expect(c.matched).toHaveLength(2)
  })

  it('gives up on a play after two tries and leaves it stopped', async () => {
    const out = mkdtempSync(join(tmpdir(), 'fill-'))
    const stopped = await runBench(content, [two[0]!], alwaysFailing, 'A', { all: 'mock' }, { out })
    const result = await fillRun(content, stopped, [two[0]!], alwaysFailing, { out })
    expect(result.filled).toEqual([])
    expect(result.still).toEqual(['deception-caught #1: provider down'])
    const play = result.bench.scenarios[0]!
    expect(play.session).toBe('deception-caught-1-fill2')
    expect(play.error).toBe('provider down')
    expect(play.stopped!.map((x) => x.session)).toEqual(['deception-caught-1', 'deception-caught-1-fill1'])
    expect(readdirSync(out).sort()).toEqual(['deception-caught-1', 'deception-caught-1-fill1', 'deception-caught-1-fill2'])
  })

  it('fills only on the inputs the run recorded', async () => {
    const bench = await runBench(content, two, failingOnce(), 'A', { all: 'mock' }, { source: { commit: 'abc1234def', dirty: false } })
    const same = { prompts: bench.prompts, inputs: structuredClone(bench.inputs!), loreBudgets: loreBudgets(content.ruleset) }
    expect(fillProblems(bench, same)).toEqual([])
    const changed = structuredClone(same)
    changed.prompts = 'other'
    changed.inputs.pack = 'other'
    changed.inputs.source = { commit: 'fff9999aaa', dirty: true }
    changed.inputs.scenarios['deception-caught'] = 'other'
    changed.inputs.roles = { writer: { profile: 'writer', host: 'x', model: 'm' } as never }
    changed.loreBudgets = { ...changed.loreBudgets, loreLines: 1 }
    expect(fillProblems(bench, changed)).toEqual([
      `the prompt version is \`other\`, not the run's \`${bench.prompts}\``,
      "the pack's content changed",
      "the code is at `fff9999`, not the run's `abc1234`",
      "the checkout has uncommitted changes the run didn't have",
      'scenario deception-caught changed',
      "the writer's model settings changed",
      'the lore budgets changed'
    ])
    // A scenario that didn't stop may change: it isn't re-played.
    const other = structuredClone(same)
    other.inputs.scenarios['deception-uncaught'] = 'other'
    expect(fillProblems(bench, other)).toEqual([])
    const { inputs: _gone, ...old } = bench
    expect(fillProblems(old, same)).toEqual(["the run recorded no inputs (it predates Milestone 3.6), so it can't be checked"])
  })
})

// Milestone 5 plan, task 7 (decided 2026-11-20, user): a scenario says which ties it should end with, and the report
// marks each play met or missed.
describe('expected ties', () => {
  const byId = (id: string) => scenarios.find((s) => s.id === id)!

  it('are read against the state the play ended on, after the player’s answers', async () => {
    // The mock states no tie changes, so the wedding doesn't happen and the hire makes no tie.
    const [wedding, hire] = await Promise.all([runScenario(content, byId('tie-wedding'), mockLlm()), runScenario(content, byId('one-job-hire'), mockLlm())])
    expect(wedding.tieResults!.map((t) => [t.expected.from, t.met, t.held])).toEqual([['kesh', false, ['fiance']], ['teo-varrin', false, ['fiance']]])
    expect(hire.tieResults!.every((t) => t.met)).toBe(true)
    const bench = await runBench(content, [byId('tie-wedding'), byId('one-job-hire')], mockLlm(), 'ties', { all: 'mock' })
    const report = renderReport(content, bench)
    expect(report).toMatch(/\| tie-wedding ⚠ Expected tie missed \|/)
    expect(report).toContain("**Expected tie missed: kesh toward teo-varrin should have spouse and shouldn't have fiance; it holds fiance.**")
    expect(report).toContain('Expected ties met (3).')
  })

  it('survive being written and read back', async () => {
    const out = mkdtempSync(join(tmpdir(), 'ties-'))
    const bench = await runBench(content, [byId('one-job-hire')], mockLlm(), 'ties', { all: 'mock' }, { out })
    writeRun(out, bench)
    expect(readRun(out).scenarios[0]!.tieResults).toEqual(bench.scenarios[0]!.tieResults)
  })

  it('leave the scenario’s fingerprint as it was: they check the result, they aren’t played', () => {
    const hire = byId('one-job-hire')
    const { expectedTies: _checked, sets: _sets, reloadAfter: _reload, ...played } = hire
    // A scenario from before the field fingerprints the same, so runs on either side of it still compare; the same
    // for `sets` and an empty `reloadAfter` (task 7).
    expect(scenarioFingerprint(hire)).toBe(fingerprint(played))
    expect(scenarioFingerprint({ ...hire, sets: [] })).toBe(scenarioFingerprint(hire))
    expect(scenarioFingerprint({ ...hire, reloadAfter: [2] })).not.toBe(scenarioFingerprint(hire))
    expect(scenarioFingerprint({ ...hire, expectedTies: [] })).toBe(scenarioFingerprint(hire))
    expect(scenarioFingerprint({ ...hire, turns: ['Something else.'] })).not.toBe(scenarioFingerprint(hire))
  })

  it('name only known people and tags, and expect something', () => {
    const bad = ScenarioSchema.parse({ ...byId('one-job-hire'), expectedTies: [{ from: 'ghost', to: 'player', lacks: ['patron'] }, { from: 'vex', to: 'oria-senn' }] })
    expect(scenarioProblems(content, bad)).toEqual(['an expected tie names unknown character "ghost"', 'an expected tie uses unknown tag "patron"', 'an expected tie from vex to oria-senn expects nothing'])
  })
})

describe('the scenarios of Milestone 5 task 7', () => {
  it('the core set: ten scenarios, chosen with --set core and any named beside it', () => {
    expect(pickScenarios(scenarios, [], 'core').map((s) => s.id)).toEqual([
      'check-fails-honored',
      'crowded-quiet-third',
      'deception-caught',
      'deception-uncaught',
      'mask-strangers-then-trusted',
      'one-job-hire',
      'tense-negotiation',
      'tie-breakup',
      'tie-wedding',
      'tram-small-talk'
    ])
    expect(pickScenarios(scenarios, ['long-scene'], 'core')).toHaveLength(11)
    expect(() => pickScenarios(scenarios, [], 'nightly')).toThrow('No scenario is in the set "nightly". Sets: core')
    expect(pickScenarios(scenarios, [])).toHaveLength(scenarios.length)
  })

  it('saves and reloads a scene in progress where a scenario asks, and plays on from it', async () => {
    const [long] = byId('long-scene')
    const bench = await runBench(content, [long!], mockLlm(), 'reload', { all: 'mock' })
    const run = bench.scenarios[0]!
    expect(run.error).toBeUndefined()
    expect(run.reloads).toEqual(['long-scene-5'])
    expect(run.turns.map((t) => t.turn)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    // The turn after the reload saw the scene as it stood: five turns of history.
    expect(run.turns[5]!.calls[0]!.prompt.user).toContain('Anyone heard anything about the Grid lately?')
  })

  it('a failed check, forced, for the player to fail', () => {
    const [failed] = byId('check-fails-honored')
    expect(failed).toMatchObject({ forceNatural: 2, expectedCheck: { turn: 2, who: 'player', skill: 'persuasion' } })
  })
})
