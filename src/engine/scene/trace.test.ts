import { describe, expect, it } from 'vitest'
import { TracedError, type Prompt } from '@engine/core'
import { fixture, yardScene } from '@tests/fixture'
import { runTurn, type TurnLlm } from './runTurn'
import { planItems } from './trace'
import type { BeatPlan } from './planShape'
import { BEATS } from './style'

const PLAN = JSON.stringify({
  speakers: [
    { id: 'tobin', goal: 'Avoid the question.', mood: 'uneasy', keeps: ['tobin.after-closing'], touched: 'after closing', approach: 'deflect' },
    { id: 'mara', goal: 'Catch him out.', mood: 'sharp' }
  ],
  moves: [
    { who: 'tobin', answers: 'player', move: 'dodge' },
    { who: 'mara', answers: 1, move: 'push back', needs: 'see' }
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
      [2, 'draft', 3, ['speaker:tobin', 'line:1']],
      [3, 'draft', 4, ['speaker:mara', 'line:2', 'check:see']]
    ])
  })

  it('records the findings, the rewrite and what salvage dropped and cut', async () => {
    const unplanned = 'Tobin: "Usual hour."\nMara: "Humming."\nClerk: "Next!"'
    // Still wrong after the rewrite: a line by no one in the scene (beat 2), then enough narration to go one beat over the budget once it is dropped.
    const stillWrong = ['Tobin: "Usual hour."', 'You say: "Fine."', 'Mara: "Humming."', ...Array.from({ length: BEATS.max - 1 }, (_, i) => `NARRATION: Rain ${i + 1}.`)].join('\n')
    const { trace, beats } = await runTurn(fixture, yardScene(), 'Tobin?', scripted(JSON.stringify({ speakers: [{ id: 'tobin', goal: 'x' }, { id: 'mara', goal: 'y' }], moves: [{ who: 'tobin', answers: 'player', move: 'answer' }, { who: 'mara', answers: 1, move: 'ask' }] }), unplanned, stillWrong), () => {}, { now: clock() })
    expect(trace.findings).toEqual([expect.objectContaining({ kind: 'unplanned-speaker', beat: 3, text: 'Next!' })])
    expect(trace.rewrite).toMatchObject({ callId: expect.stringMatching(/:rewrite$/), salvage: { dropped: [2], cut: 1 } })
    expect(trace.rewrite!.remaining.map((p) => p.kind)).toContain('unknown-speaker')
    expect(beats).toHaveLength(BEATS.max)
    expect(trace.beats.every((b) => b.source === 'rewrite' && b.salvaged)).toBe(true)
    expect(trace.beats[1]).toMatchObject({ index: 2, line: 3, plan: ['speaker:mara', 'line:2'] })
    expect(trace.calls.map((c) => c.role)).toEqual(['director', 'writer', 'rewrite'])
  })

  // Session 2026-11-07_0039_e46a, t2b5: a silent reaction given words, which ended up in quotes inside narration.
  it('sends speech in narration to the rewrite, and cuts the words but keeps the action if it is still there', async () => {
    const speaking = `${CLEAN}\nNARRATION: Pell doesn't look up. "Gate's been warm all week, if anyone asked me."`
    const { beats, trace } = await runTurn(fixture, yardScene(), 'Was the gate warm?', scripted(PLAN, speaking, speaking), () => {}, { forceNatural: 11, now: clock() })
    expect(trace.findings.map((p) => p.kind)).toEqual(['speech-in-narration'])
    expect(trace.findings[0]!.fix).toMatch(/^Beat 4 puts spoken words in narration \("Gate's been warm all week, if anyone asked me\."\)\./)
    expect(beats.at(-1)).toEqual({ kind: 'narration', text: "Pell doesn't look up." })
    expect(trace.beats.at(-1)!.salvaged).toBe(true)
  })

  // Session 2026-11-07_0039_e46a: one planned line written as two beats was linked to the speaker's next line.
  it('links a line written in parts, with only narration between, to one planned line', () => {
    const plan = { speakers: [{ id: 'tobin' }, { id: 'mara' }], walk_ons: [], reactions: [], exchange: [{ who: 'tobin', answers: 'player', point: 'a' }, { who: 'mara', answers: 1, point: 'b' }, { who: 'tobin', answers: 2, point: 'c' }] } as unknown as BeatPlan
    const said = (who: string) => ({ kind: 'dialogue' as const, speaker: who, text: '' })
    const rain = { kind: 'narration' as const, text: 'Rain.' }
    const beats = [said('tobin'), rain, said('tobin'), said('mara'), said('tobin'), said('tobin')]
    expect(beats.map((b, i) => planItems(fixture, plan, b, beats.slice(0, i)).find((p) => p.startsWith('line:')))).toEqual(['line:1', undefined, 'line:1', 'line:2', 'line:3', 'line:3'])
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

// Milestone 3.6, task 6 (decided 2026-11-12): which of the writer's tags count.
describe('the writer’s tags', () => {
  const ASK = 'Whose seal was it?'
  const plan = (over: object = {}) =>
    JSON.stringify({ speakers: [{ id: 'mara', goal: 'narrow it down', mood: 'careful' }], moves: [{ who: 'mara', answers: 'player', move: 'answer' }], reactions: [{ id: 'tobin', beat: 'looks at the ground' }], ...over })
  const TAGS = '[Tobin: MOOD rattled]\n[Tobin: COMFORT 1 he said too much]\n[Tobin: EXPRESSION wide-eyed]\n[Mara: EXPRESSION thoughtful]'
  // Tobin speaks without being planned, in the draft and again in the rewrite, so salvage cuts his line.
  const cutTobin = `Mara: "Only clerks carry seals."\nNARRATION: Rain on the crates.\nTobin: "Seven, counting Pell."\n${TAGS}`

  it('drops the mood, comfort and expression of someone salvage cut out of the turn, and says why', async () => {
    const before = yardScene()
    const { state, trace } = await runTurn(fixture, before, ASK, scripted(plan(), cutTobin, cutTobin))
    expect(trace.rewrite?.salvage).toBeDefined()
    const scene = state.scene!
    expect(scene.moods['tobin']).toBe(before.scene!.moods['tobin'])
    expect(scene.comfort['tobin']).toBe(before.scene!.comfort['tobin'])
    expect(scene.expressions['tobin']).toBe(before.scene!.expressions['tobin'])
    expect(scene.expressions['mara']).toBe('thoughtful')
    expect(trace.tags.dropped).toEqual(['[Tobin: EXPRESSION wide-eyed] (salvage cut their lines)', '[Tobin: MOOD rattled] (salvage cut their lines)', '[Tobin: COMFORT 1 he said too much] (salvage cut their lines)'])
    // The parsed tags stay in the trace as the writer wrote them.
    expect(trace.tags.parsed.moods['tobin']).toBe('rattled')
  })

  it('keeps the tags of someone still in the kept prose, and of anyone on a turn nothing was cut from', async () => {
    const reacted = `Mara: "Only clerks carry seals."\nNARRATION: Tobin looks at the ground.\nTobin: "Seven, counting Pell."\n${TAGS}`
    const salvaged = await runTurn(fixture, yardScene(), ASK, scripted(plan(), reacted, reacted))
    expect(salvaged.state.scene!.moods['tobin']).toBe('rattled')
    expect(salvaged.trace.tags.dropped).toEqual([])
    const clean = await runTurn(fixture, yardScene(), ASK, scripted(plan(), `Mara: "Only clerks carry seals."\nNARRATION: Rain on the crates.\n${TAGS}`))
    expect(clean.trace.rewrite).toBeUndefined()
    expect(clean.state.scene!.comfort['tobin']).toBe(1)
  })

  it('sends no one away on a LEAVES tag alone, and lets the plan send someone away without one', async () => {
    const tagged = await runTurn(fixture, yardScene(), ASK, scripted(plan(), `Mara: "Only clerks carry seals."\nNARRATION: Tobin slips out.\n[LEAVES: Tobin]`))
    expect(tagged.state.scene!.departed).toEqual([])
    expect(tagged.trace.tags.dropped).toEqual(['[LEAVES: Tobin] (not in the plan)'])
    const planned = await runTurn(fixture, yardScene(), ASK, scripted(plan({ leaves: ['tobin'] }), 'Mara: "Only clerks carry seals."\nNARRATION: Tobin slips out.'))
    expect(planned.state.scene!.departed).toEqual(['tobin'])
    expect(planned.trace.tags.dropped).toEqual([])
  })

  it('ends the scene only when the plan does, whatever the tag says', async () => {
    const reply = 'Mara: "Only clerks carry seals."\nNARRATION: Rain on the crates.\n[END SCENE]'
    expect((await runTurn(fixture, yardScene(), ASK, scripted(plan(), reply))).state.scene!.ended).toBe(false)
    expect((await runTurn(fixture, yardScene(), ASK, scripted(plan({ end_scene: true }), reply))).state.scene!.ended).toBe(true)
  })
})
