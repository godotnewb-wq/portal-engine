import { describe, expect, it } from 'vitest'
import { TracedError, type Prompt } from '@engine/core'
import { fixture, yardScene } from '@tests/fixture'
import { runTurn, type TurnLlm } from './runTurn'

const PLAN = JSON.stringify({
  speakers: [
    { id: 'tobin', intent: 'Avoid the question.', mood: 'uneasy', hiding: 'let someone in after closing', approach: 'deflect' },
    { id: 'mara', intent: 'Catch him out.', mood: 'sharp', depends_on_check: 'see' }
  ],
  reactions: [],
  walk_ons: [{ id: 'clerk', line: 'stamps a ledger, loudly' }],
  checks: [{ id: 'see', who: 'mara', skill: 'notice', difficulty: 'tough', stakes: 'notices Tobin humming', edge: 'advantage' }],
  texture: ['wet cobbles']
})

const CLEAN = `NARRATION: The clerk stamps a ledger, loudly.

Tobin: "I locked up at the usual hour."
Mara: "You're humming again."
[Mara: EXPRESSION sly]
[Nobody: MOOD odd]`

/** A scripted LLM that reports metadata the way the platform's roles do, and a clock that moves 10 ms per reading. */
function scripted(director: string, ...writes: string[]): TurnLlm {
  return {
    direct: async () => ({ text: director, meta: { profile: 'director', model: 'fast', usage: { input: 100, output: 20 } } }),
    write: async (_prompt: Prompt, onDelta) => {
      const reply = writes.shift() ?? ''
      onDelta(reply)
      return { text: reply, meta: { profile: 'writer', model: 'strong', usage: { input: 300, output: 80 } } }
    }
  }
}
const clock = () => {
  let t = 1_700_000_000_000
  return () => (t += 10)
}

describe('the turn trace (milestone 2, A1)', () => {
  it('records the turn: identity, cast before and after, plan, rolls, calls and cost', async () => {
    const state = yardScene(3)
    const outcome = await runTurn(fixture, state, 'Tobin, who came by after closing?', scripted(PLAN, CLEAN), () => {}, { forceNatural: 11, turnId: 'abc', log: 'session-1', now: clock() })
    const t = outcome.trace
    expect(t).toMatchObject({ turnId: 'abc', sceneId: state.scene!.id, turn: 1, input: 'Tobin, who came by after closing?' })
    expect(t.at).toBe(new Date(1_700_000_000_010).toISOString())
    expect(t.director).toMatchObject({ callId: 'abc:director', read: 'json', corrections: [] })
    expect(t.calls.map((c) => [c.id, c.role, c.meta?.model])).toEqual([['abc:director', 'director', 'fast'], ['abc:writer', 'writer', 'strong']])
    expect(t.calls[0]!.prompt.user).toMatch(/who came by after closing/)
    expect(t.calls[1]!.firstTextMs).toBeGreaterThan(0)
    expect(t.cost).toMatchObject({ calls: 2, tokens: { input: 400, output: 100 } })
    expect(t.cast.before.find((c) => c.id === 'mara')).toMatchObject({ expression: 'neutral' })
    expect(t.cast.after.find((c) => c.id === 'mara')).toMatchObject({ expression: 'sly', mood: 'sharp' })
    expect(t.tags.dropped).toEqual(['[Nobody: MOOD odd]'])
    // The turn keeps its id and the session that logged it, so it can be flagged after a reload.
    expect(outcome.state.scene!.turns[0]).toMatchObject({ id: 'abc', log: 'session-1' })
  })

  it('breaks each check down: dice, edge asked and applied, modifier, rank, total, degree', async () => {
    const state = yardScene(3)
    const { trace } = await runTurn(fixture, state, 'Tobin?', scripted(PLAN, CLEAN), () => {}, { forceNatural: 11 })
    expect(trace.checks).toEqual([
      expect.objectContaining({ id: 'see', who: 'mara', skill: 'notice', difficulty: 'tough', dc: 13, rolls: [11, 11], natural: 11, edgeAsked: 'advantage', edge: 'advantage', modifier: 3, rank: 1, total: 15, degree: 'success' })
    ])
    expect(trace.dice.before).toBe(state.dice)
  })

  it('traces each beat to its line in the reply and to the plan item it carries out', async () => {
    const { trace } = await runTurn(fixture, yardScene(), 'Tobin?', scripted(PLAN, CLEAN), () => {}, { forceNatural: 11 })
    expect(trace.beats.map((b) => [b.index, b.source, b.line, b.plan])).toEqual([
      [1, 'draft', 1, ['walk-on:clerk']],
      [2, 'draft', 3, ['speaker:tobin']],
      [3, 'draft', 4, ['speaker:mara', 'check:see']]
    ])
  })

  it('records the findings, the rewrite and what salvage dropped and cut', async () => {
    const unplanned = 'Tobin: "Usual hour."\nMara: "Humming."\nClerk: "Next!"'
    // Still wrong after the rewrite: a line by no one in the scene (beat 2), then nine narration beats, two over the budget.
    const stillWrong = ['Tobin: "Usual hour."', 'You say: "Fine."', 'Mara: "Humming."', ...Array.from({ length: 6 }, (_, i) => `NARRATION: Rain ${i + 1}.`)].join('\n')
    const { trace, beats } = await runTurn(fixture, yardScene(), 'Tobin?', scripted(JSON.stringify({ speakers: [{ id: 'tobin', intent: 'x', mood: '' }, { id: 'mara', intent: 'y', mood: '' }] }), unplanned, stillWrong), () => {}, { now: clock() })
    expect(trace.findings).toEqual([expect.objectContaining({ kind: 'unplanned-speaker', beat: 3, text: 'Next!' })])
    expect(trace.rewrite).toMatchObject({ callId: expect.stringMatching(/:rewrite$/), salvage: { dropped: [2], cut: 1 } })
    expect(trace.rewrite!.remaining.map((p) => p.kind)).toContain('unknown-speaker')
    expect(beats).toHaveLength(7)
    expect(trace.beats.every((b) => b.source === 'rewrite' && b.salvaged)).toBe(true)
    expect(trace.beats[1]).toMatchObject({ index: 2, line: 3, plan: ['speaker:mara'] })
    expect(trace.calls.map((c) => c.role)).toEqual(['director', 'writer', 'rewrite'])
  })

  it('says when the director reply was unreadable or needed a retry without JSON mode', async () => {
    const unreadable = await runTurn(fixture, yardScene(), 'Hello', scripted('no plan', 'NARRATION: Rain.\nMara: "Hm."'))
    expect(unreadable.trace.director.read).toBe('unreadable')
    const retried: TurnLlm = { ...scripted('', 'NARRATION: Rain.\nMara: "Hm."'), direct: async () => ({ text: PLAN, meta: { jsonRetried: true } }) }
    expect((await runTurn(fixture, yardScene(), 'Hello', retried)).trace.director.read).toBe('json-retried')
  })

  it('throws a failed call with the calls made before it, so the failure can be logged', async () => {
    const failing: TurnLlm = { direct: async () => PLAN, write: async () => Promise.reject(new Error('rate limited')) }
    const error = await runTurn(fixture, yardScene(), 'Hello', failing).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TracedError)
    expect((error as TracedError).message).toBe('rate limited')
    expect((error as TracedError).calls.map((c) => [c.role, c.error ?? 'ok'])).toEqual([['director', 'ok'], ['writer', 'rate limited']])
  })
})
