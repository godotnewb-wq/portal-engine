import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { content, PACK_DIR } from './support'
import { LogSession, promptOf, readSession, type SessionLog } from '@platform/logs'
import type { Prompt } from '@engine/core'
import { mockLlm, runBench, writeRun } from '../../tools/bench/run'
import { loadScenarios, scenarioState } from '../../tools/bench/scenario'
import { toScenario } from '../../tools/logs/scenario'
import { echoesOf, flaggedTurns, promptDrift, renderReplays, replayTurn, sampleTurns, type Write } from '../../tools/logs/rewrite'

const scenarios = loadScenarios(join(PACK_DIR, 'bench'))
let played: SessionLog
let situation: SessionLog

beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), 'rewrite-'))
  const scenario = scenarios.find((s) => s.id === 'deception-caught')!
  writeRun(out, await runBench(content, [scenario], mockLlm(), 'scene', { all: 'mock' }, { out, pipeline: 'scene' }))
  const dir = join(out, 'deception-caught-1')
  const log = LogSession.resume(dir)
  log.flag({ session: log.id, turnSession: log.id, turnId: 'deception-caught-2', beat: 1, text: 'x', flag: { rating: 'bad', reasons: [], note: 'stock opener' }, at: '2026-11-24T20:00:00Z' })
  played = readSession(dir)
  const old = mkdtempSync(join(tmpdir(), 'rewrite-situation-'))
  writeRun(old, await runBench(content, [scenario], mockLlm(), 'situation', { all: 'mock' }, { out: old }))
  situation = readSession(join(old, 'deception-caught-1'))
})

/** A writer that answers with the same two lines, and keeps the prompts it was sent. */
const writer = (seen: Prompt[]): Write => async (prompt) => {
  seen.push(prompt)
  return { text: 'Vex: She\'s by the door with a coin walking her knuckles. "Who\'s the client?"\nNARRATION: The conduit buzzes overhead.', meta: { profile: 'writer', model: 'mock' } }
}

describe('writer replay (Milestone 5 task 8)', () => {
  it('rebuilds a later turn’s writer prompt exactly as it was logged, and calls only the writer', async () => {
    const seen: Prompt[] = []
    const r = await replayTurn(content, played, 2, writer(seen), 3)
    expect(r.skipped).toBeUndefined()
    expect(r.drift).toEqual({ changed: [], gone: [] })
    expect(seen).toHaveLength(3)
    expect(r.samples[0]!.beats[0]).toEqual({ kind: 'narration', text: 'Vex is by the door with a coin walking her knuckles.' })
    expect(r.flags.get(1)).toEqual(['bad: stock opener'])
  })

  it('sends the logged prompt itself with --as-logged', async () => {
    const seen: Prompt[] = []
    const r = await replayTurn(content, played, 2, writer(seen), 1, played.flags, true)
    const call = played.calls.get(played.turns[1]!.writer.callId)!
    expect(seen[0]).toEqual(promptOf(played, call))
    expect(renderReplays(content, [r], { model: 'mock' })).toContain('Prompt: sent as logged.')
  })

  it('carries an earlier turn’s records, so a later turn knows what the player had heard', () => {
    const records = { ...played.bookkeeping[0]!.records, new: [{ text: 'The back stair floods first', by: 'vex' }] }
    const log = { ...played, bookkeeping: [{ ...played.bookkeeping[0]!, turnId: played.turns[0]!.turnId, records }] }
    const scenario = toScenario(log, 2)
    expect(scenario.history[0]!.records?.new).toEqual([{ text: 'The back stair floods first', by: 'vex' }])
    expect(scenarioState(content, scenario).scene!.newFacts.map((f) => f.text)).toContain('The back stair floods first')
  })

  it('samples scene turns across sessions, one each first, the same for the same seed, and none from another pipeline', () => {
    const other = { ...played, session: { ...played.session, id: 'other' } }
    const picks = sampleTurns([played, situation, other], 3, 7)
    expect(picks.map((p) => p.log.session.id).slice(0, 2).sort()).toEqual([played.session.id, 'other'].sort())
    expect(picks.every((p) => p.log !== situation)).toBe(true)
    expect(sampleTurns([played, situation, other], 3, 7).map((p) => [p.log.session.id, p.turn])).toEqual(picks.map((p) => [p.log.session.id, p.turn]))
    expect(new Set(picks.map((p) => `${p.log.session.id}:${p.turn}`)).size).toBe(3)
  })

  it('finds the flagged turns, and leaves a turn from another pipeline out with the reason', async () => {
    expect(flaggedTurns(played)).toEqual([2])
    const r = await replayTurn(content, situation, 1, writer([]), 1)
    expect(r.skipped).toMatch(/situation/)
    expect(renderReplays(content, [r], { model: 'mock' })).toContain('Not replayed')
  })

  it('names the prompt sections the current code changed', () => {
    const was: Prompt = { system: 'Style.\n\n## Ada\nWalks a coin across her knuckles.', user: '# The player says or does\nHi.' }
    const now: Prompt = { system: 'Style.\n\n## Ada\nPlain.', user: '# The player says or does\nHi.' }
    expect(promptDrift(now, was)).toEqual({ changed: ['## Ada'], gone: ['## Ada'] })
  })

  it('marks a beat that carries three words of one prompt line, but not the player’s own words', () => {
    const prompt: Prompt = { system: '## Ada\nShe walks a coin across her knuckles while she listens.', user: '# The player says or does\nI ask about the brass washer in his pocket.' }
    const beats = [
      { kind: 'narration' as const, text: 'Ada has a coin walking her knuckles.' },
      { kind: 'narration' as const, text: 'Ben turns a brass washer in his pocket.' }
    ]
    expect(echoesOf(beats, prompt, [])).toEqual([{ beat: 1, section: '## Ada', shared: ['coin', 'walking', 'knuckles'].map((w) => expect.stringContaining(w.slice(0, 4))) }])
  })
})
