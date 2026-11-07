import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { content, PACK_DIR } from './support'
import { LogSession, readSession, type SessionLog } from '@platform/logs'
import { SCORER_VERSION } from '@engine/review'
import { compareRuns } from '../../tools/bench/report'
import { mockLlm, readRun, runBench, writeRun, type BenchRun } from '../../tools/bench/run'
import { loadScenarios, scenarioState, ScenarioSchema } from '../../tools/bench/scenario'
import { flagsFor, metricInput } from '../../tools/logs/load'
import { copiedFromPlan, exchangeShape, metrics, renderMetrics, repeatedPhrases } from '../../tools/logs/metrics'
import { blindTest, renderFlags } from '../../tools/logs/review'
import { toScenario } from '../../tools/logs/scenario'
import { scoreSession, type Scorer } from '../../tools/logs/score'
import { renderTurn } from '../../tools/logs/show'
import { renderTranscript } from '../../tools/logs/transcript'

const scenarios = loadScenarios(join(PACK_DIR, 'bench'))
let out: string
let bench: BenchRun
let caught: SessionLog

/** A scorer that marks the first beat of every turn bad and gives every item asked a 2. */
const scorer: Scorer = async (prompt) => ({
  text: JSON.stringify({ items: [...prompt.system.matchAll(/^(\d+)\. \[/gm)].map((m) => ({ id: Number(m[1]), score: 2, reason: 'meh' })), beats: [{ beat: 1, rating: 'bad', reasons: ['generic'], note: 'filler' }] }),
  meta: { profile: 'scorer', model: 'judge' }
})

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'logs-'))
  bench = await runBench(content, scenarios.slice(0, 1), mockLlm(), 'logs', { all: 'mock' }, { out })
  writeRun(out, bench)
  const dir = join(out, 'deception-caught-1')
  const log = LogSession.resume(dir)
  const turn = (n: number) => `deception-caught-${n}`
  log.flag({ session: log.id, turnSession: log.id, turnId: turn(1), beat: 1, text: 'The conduit buzzes overhead.', flag: { rating: 'bad', reasons: ['generic'], note: 'stock opener' }, at: '2026-11-05T20:00:00Z' })
  log.flag({ session: log.id, turnSession: log.id, turnId: turn(1), beat: 2, speaker: 'oria-senn', flag: { rating: 'good', reasons: ['voice'], note: '' }, at: '2026-11-05T20:00:01Z' })
  log.flag({ session: log.id, turnSession: log.id, turnId: turn(2), flag: { rating: 'meh', reasons: [], note: 'slow' }, at: '2026-11-05T20:00:02Z' })
  caught = readSession(dir)
})

describe('AI scoring of logs (milestone 2, A5)', () => {
  it('scores each turn once per scorer version, into scores.jsonl, its calls into calls.jsonl with the role scorer', async () => {
    const dir = join(out, 'deception-caught-1')
    expect(await scoreSession(content, dir, scorer)).toEqual({ scored: 3, skipped: 0, failed: 0 })
    expect(await scoreSession(content, dir, scorer)).toEqual({ scored: 0, skipped: 3, failed: 0 })
    caught = readSession(dir)
    expect(caught.scores).toHaveLength(3)
    expect(caught.scores[0]).toMatchObject({ turnSession: 'deception-caught-1', turnId: 'deception-caught-1', scorer: { version: SCORER_VERSION, model: 'judge' }, beats: [{ beat: 1, rating: 'bad' }] })
    const calls = [...caught.calls.values()].filter((c) => c.role === 'scorer')
    expect(calls).toHaveLength(3)
    expect(caught.scores[0]!.callId).toBe(calls[0]!.id)
  })

  it('logs an unreadable reply as an error and scores nothing', async () => {
    const dir = join(out, 'deception-caught-1')
    const fresh = mkdtempSync(join(tmpdir(), 'logs-'))
    const run = await runBench(content, scenarios.slice(1, 2), mockLlm(), 'x', {}, { out: fresh })
    const r = await scoreSession(content, join(fresh, run.scenarios[0]!.session), async () => 'I would rather not.')
    expect(r).toEqual({ scored: 0, skipped: 0, failed: 3 })
    expect(readSession(join(fresh, run.scenarios[0]!.session)).errors[0]).toMatchObject({ where: 'scorer', message: 'The scorer reply could not be read.' })
    expect(dir).toBeTruthy()
  })
})

describe('npm run logs (milestone 2, A4)', () => {
  it('transcript: input, plan, beats, with flags, notes and AI scores inline', () => {
    const md = renderTranscript(content, caught, flagsFor(caught))
    expect(md).toMatch(/^# Bench: Deception, caught `deception-caught-1`/)
    expect(md).toMatch(/### Turn 1 `deception-caught-1`\n\n\*\*You:\*\* So, Oria, who's the client, really\?/)
    expect(md).toMatch(/1\. \*The conduit buzzes overhead\.\* ⚑ \*\*bad\*\* \(generic\): “stock opener” 🤖 bad \(generic\): filler/)
    expect(md).toMatch(/### Turn 2 `deception-caught-2` ⚑ \*\*meh\*\*: “slow”/)
    expect(md).toMatch(/🤖 speaker choice 2 ·/)
    expect(md).toMatch(/## After scene `deception-caught`/)
  })

  it('flags: filtered by rating, reason or speaker, each with its brief and the beats around it; --ai adds the scorer’s', () => {
    const all = renderFlags(content, [{ log: caught, flags: caught.flags }])
    expect(all).toMatch(/^# Flags \(3\)/)
    const bad = renderFlags(content, [{ log: caught, flags: caught.flags }], { rating: 'bad' })
    expect(bad).toMatch(/^# Flags \(1\)/)
    expect(bad).toMatch(/\*\*You:\*\* So, Oria/)
    expect(bad).toMatch(/\*\*→\*\* 1\. The conduit/)
    const oria = renderFlags(content, [{ log: caught, flags: caught.flags }], { speaker: 'Oria' })
    expect(oria).toMatch(/GOOD — beat 2 \(Oria\)/)
    expect(oria).toMatch(/Oria's brief: Answer what the player just said/)
    expect(renderFlags(content, [{ log: caught, flags: caught.flags }], { ai: true })).toMatch(/^# Flags \(6\)[\s\S]*🤖 AI: BAD/)
  })

  it('stats: the B2 metrics, with flag shares and the scorer’s agreement with people', () => {
    const m = metrics([metricInput(caught)])
    expect(m).toMatchObject({ turns: 3, beats: 6, director: { unreadableRate: 1 }, writer: { rewriteRate: 0 }, pacing: { beatsPerTurn: 2 } })
    expect(m.flags).toMatchObject({ beatsFlagged: 2, turnFlags: 1, byReason: { generic: 1, voice: 1 } })
    expect(m.flags.badShare).toBeCloseTo(1 / 6)
    expect(m.flags.bySpeaker).toEqual({ narration: { good: 0, meh: 0, bad: 1 }, 'oria-senn': { good: 1, meh: 0, bad: 0 } })
    expect(m.ai.agreement).toEqual({ both: 1, same: 1, humanBadMarkedBad: 1, humanBad: 1, aiBadFlaggedBad: 1, aiBad: 3 })
    expect(m.ai.items['7. second person']).toBe(2)
    expect(m.checks.successRate).toBeNaN()
    // Every turn of the mock opens on the same line: the repetition count catches it.
    expect(m.repetition.top[0]).toEqual(['the conduit buzzes overhead', 2])
    expect(renderMetrics(m)).toMatch(/\| beats flagged bad \| 17% \|/)
  })

  // Session 2026-11-06_2313_c313, turn 1: Oria, Oria, Vex, Vex with narration between; nobody answered anybody.
  it('measures whether lines answer each other or come as speeches, narration aside', () => {
    const turn = (...who: string[]) => ({ beats: who.map((w) => ({ beat: w === 'N' ? { kind: 'narration', text: '' } : { kind: 'dialogue', speaker: w, text: '' } })) }) as never
    expect(exchangeShape([turn('N', 'oria', 'N', 'oria', 'N', 'vex', 'N', 'vex')])).toEqual({ answeredBackPerTurn: 0, sameSpeakerPerTurn: 2 })
    expect(exchangeShape([turn('oria', 'vex', 'N', 'oria', 'vex'), turn('brask')])).toEqual({ answeredBackPerTurn: 1, sameSpeakerPerTurn: 0 })
    // Session 2026-11-07_0039_e46a, t3: Brask's one planned line written as two beats is not a speech; two of his lines in a row are.
    const planned = (exchange: string[], ...who: string[]) => ({ director: { plan: { exchange: exchange.map((w) => ({ who: w, answers: 'player', point: '' })) } }, beats: who.map((w) => ({ beat: { kind: 'dialogue', speaker: w, text: '' } })) }) as never
    expect(exchangeShape([planned(['oria', 'brask', 'oria'], 'oria', 'brask', 'brask', 'oria')])).toEqual({ answeredBackPerTurn: 1, sameSpeakerPerTurn: 0 })
    expect(exchangeShape([planned(['oria', 'oria'], 'oria', 'oria')])).toEqual({ answeredBackPerTurn: 0, sameSpeakerPerTurn: 1 })
  })

  // Session 2026-11-07_0013_714e, turn 3: Oria's line was her point, nearly word for word.
  it('measures how much of each line comes straight from its planned point', () => {
    const point = 'Lays out the plan: down the maintenance stair behind the bar, a skiff through the flooded level.'
    const turn = (text: string, plan: string[]) => ({ director: { plan: { speakers: [], exchange: [{ who: 'oria-senn', answers: 'player', point }] } }, beats: [{ beat: { kind: 'dialogue', speaker: 'oria-senn', text }, plan }] }) as never
    expect(copiedFromPlan([turn('Down the maintenance stair behind the bar, a skiff through the flooded level.', ['speaker:oria-senn', 'line:1'])])).toBe(1)
    expect(copiedFromPlan([turn('We take the back way down, darling, and a boat does the rest.', ['speaker:oria-senn', 'line:1'])])).toBe(0)
    expect(copiedFromPlan([])).toBeNaN()
  })

  it('counts a phrase repeated across turns of one scene once per extra turn, and not across scenes', () => {
    const t = (sceneId: string, turnId: string, text: string) => ({ sceneId, turnId, beats: [{ beat: { kind: 'narration' as const, text } }] }) as never
    const rep = repeatedPhrases([t('a', '1', 'rain on the tin roof'), t('a', '2', 'More rain on the tin roof.'), t('b', '3', 'rain on the tin roof')])
    expect([...rep.entries()]).toEqual([['rain on the tin', 1], ['on the tin roof', 1]])
  })

  it('blind: lines without names, shuffled; the key apart', () => {
    const { test, key } = blindTest(content, caught, 3, 7)
    expect(test).toMatch(/Who says each line\? The cast: Brask, Oria, Vex\./)
    const lines = test.split('\n').filter((l) => /^\d+\. /.test(l))
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(line).toMatch(/^\d\. “[^”]+”$/)
    expect(key.match(/^\d\. (Oria|Vex|Brask) — deception-caught-\d beat \d$/gm)).toHaveLength(3)
  })

  it('to-scenario: a logged turn becomes a bench scenario that opens on the scene as it stood', () => {
    const scenario = ScenarioSchema.parse(toScenario(caught, 3))
    expect(scenario).toMatchObject({ id: 'deception-caught-1-t3', location: 'sump-lantern', cast: ['vex', 'brask', 'oria-senn'], turns: ["Brask, you've gone quiet. What do you make of this?"], summaries: false })
    expect(scenario.history.map((t) => t.player)).toEqual(["So, Oria, who's the client, really?", 'Vex is right. Try again, Oria.'])
    expect(scenario.seed).toBe(caught.turns[2]!.dice.before)
    const state = scenarioState(content, scenario)
    expect(state.scene!.turns).toHaveLength(2)
    expect(state.dice).toBe(caught.turns[2]!.dice.before)
    const flagged = toScenario(caught, 1, caught.flags)
    expect(flagged.watchFor).toMatch(/Beat 1 was flagged bad \(generic\): stock opener\. Beat 2 was flagged good \(voice\)\./)
  })

  it('show: one turn in full, every prompt put back together and the raw reply', () => {
    const md = renderTurn(content, caught, 1)
    const director = bench.scenarios[0]!.turns[0]!.calls[0]!
    expect(md).toContain(director.prompt.system)
    expect(md).toContain(director.prompt.user)
    expect(md).toContain('(mock director: no plan)')
  })
})

describe('bench metrics (milestone 2, B4)', () => {
  it('are in the report, and --compare shows each one’s change', async () => {
    const back = readRun(out)
    expect(back.scenarios[0]!.flags).toHaveLength(3)
    const other = await runBench(content, scenarios.slice(0, 1), mockLlm(), 'B', { all: 'mock' })
    const md = compareRuns(content, back, other)
    expect(md).toMatch(/## Metrics \(scenarios both ran\)\n\n\| Metric \| A \| B \| Change \|/)
    expect(md).toMatch(/\| beats flagged bad \| 17% \| 0% \| -17 pts ✓ \|/)
    expect(readFileSync(join(out, 'run.json'), 'utf8')).not.toMatch(/"turns":/)
  })
})
