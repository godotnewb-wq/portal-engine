import { describe, expect, it } from 'vitest'
import type { Prompt } from '@engine/core'
import type { GameState } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { runTurn, type TurnLlm } from './runTurn'
import { applyTurn, cutTurn } from './turn'
import { planBookkeeping } from './bookkeeper'
import { cutIn, turnText } from './director'
import { buildSceneWriterPrompt } from './sceneWriter'
import { cutTrace } from './trace'

// Cutting in between beats (Milestone 5 task 8c; decided 2026-11-24, user): what the player never saw never happened.

function yard(): GameState {
  const state = yardScene(13)
  state.relations = [...state.relations, { from: 'tobin', to: 'mara', tags: [], note: 'has worked under her a year', meters: { warmth: 0, bond: 0 } }]
  return state
}

const PLAN = {
  player_action: { doing: 'asks Mara about a second ledger', uncertain: false },
  checks: [{ id: 'read-mara', who: 'tobin', skill: 'notice', target: 'mara', stakes: 'Tobin sees the lie for what it is' }],
  focus: ['mara', 'tobin'],
  moments: [
    { who: 'mara', feels: { shade: 'glum', intensity: 3, reason: 'the question she dreads' }, lands: 'the question she has no good answer to', wants: 'to close it down', pressure: 'keen' },
    { who: 'tobin', feels: { shade: 'wary', intensity: 2, reason: 'he has seen the books' }, lands: 'a question he could answer', wants: 'to stay out of it' }
  ],
  pressures: [{ who: 'mara', kind: 'secret', secret: 'mara.two-books', approach: 'lie' }],
  draws_on: [],
  stakes: 'whether Kit believes there is one book'
}

const SCENE = [
  'NARRATION: Mara closes the tally book.',
  'Mara: "One book, Kit. The Guild keeps one."',
  'Tobin: "That\'s not what the second shelf says."',
  'NARRATION: Tobin looks at the floor.',
  '[Mara: EXPRESSION guarded]',
  '[Tobin: EXPRESSION doubtful]'
].join('\n')

function scripted(): TurnLlm {
  return {
    direct: async () => JSON.stringify(PLAN),
    write: async (_p: Prompt, onDelta) => (onDelta(SCENE), SCENE)
  }
}

async function played() {
  const before = yard()
  const out = await runTurn(fixture, before, 'Is there a second ledger, Mara?', scripted(), () => {}, { pipeline: 'scene', forceNatural: 18 })
  return { before, out }
}

describe('cutting in on a turn', () => {
  it('keeps only the beats shown, and drops whoever appears only after the cut', async () => {
    const { out } = await played()
    expect(out.written.beats).toHaveLength(4)
    const cut = cutTurn(fixture, out.written, 2)
    expect(cut.beats).toEqual(out.written.beats.slice(0, 2))
    expect(cut.cut).toEqual({ after: 2, of: 4 })
    // Tobin's line was cut: his slot, mood and expression never happened.
    expect(cut.plan.speakers.map((s) => s.id)).not.toContain('tobin')
    expect(Object.keys(cut.tags.expressions)).toEqual(['mara'])
    expect(cut.plan.end_scene).toBe(false)
  })

  it('is no cut at or past the last beat', async () => {
    const { out } = await played()
    expect(cutTurn(fixture, out.written, 4)).toBe(out.written)
    expect(cutTurn(fixture, out.written, 9)).toBe(out.written)
  })

  it('applies to the state before the turn: the cut is recorded, the dice stay spent, and an unshown check is void', async () => {
    const { before, out } = await played()
    const next = applyTurn(fixture, before, cutTurn(fixture, out.written, 2))
    const turn = next.scene!.turns.at(-1)!
    expect(turn.beats).toHaveLength(2)
    expect(turn.interrupted).toEqual({ after: 2, of: 4 })
    expect(next.dice).toBe(out.state.dice)
    expect(next.time).toBe(out.state.time)
    // The plan's records stand in for the bookkeeper's and judge no check: the read is void, and so is what it saw.
    expect(out.state.scene!.turns.at(-1)!.checks).toHaveLength(1)
    expect(turn.checks).toEqual([])
    expect(turn.reads).toBeUndefined()
    expect(next.scene!.expressions['tobin']).toBe(before.scene!.expressions['tobin'])
  })

  it('keeps a check whose result the kept beats show', async () => {
    const { before, out } = await played()
    const cut = cutTurn(fixture, out.written, 2)
    const records = { ...planBookkeeping(fixture, before, cut), checks: [{ id: 'read-mara', honored: true, shown: 'happens', at: 2, words: 'One book' }] }
    const turn = applyTurn(fixture, before, { ...cut, records }).scene!.turns.at(-1)!
    expect(turn.checks.map((c) => c.id)).toEqual(['read-mara'])
  })

  it('stops a departure and the scene’s end the player never reached', async () => {
    const { before, out } = await played()
    const leaving = { ...out.written, plan: { ...out.written.plan, leaves: ['tobin'], end_scene: true } }
    const next = applyTurn(fixture, before, cutTurn(fixture, leaving, 2))
    expect(next.scene!.departed).not.toContain('tobin')
    expect(next.scene!.ended).toBe(false)
    // Tobin is in the last beat, so any cut stops his going; Mara's last appearance is beat 2, so a cut after it doesn't.
    const going = { ...out.written, plan: { ...out.written.plan, leaves: ['mara'] } }
    expect(applyTurn(fixture, before, cutTurn(fixture, going, 3)).scene!.departed).toContain('mara')
    expect(applyTurn(fixture, before, cutTurn(fixture, going, 1)).scene!.departed).not.toContain('mara')
  })

  it('tells the next director and writer where the player cut in, and whoever was cut off reacts', async () => {
    const { before, out } = await played()
    const next = applyTurn(fixture, before, cutTurn(fixture, out.written, 2))
    const turn = next.scene!.turns.at(-1)!
    expect(turnText(fixture, next.player.name, turn).split('\n').at(-1)).toBe(`(${next.player.name} cuts in here.)`)
    expect(cutIn(fixture, next)).toMatch(/^\S+ cut in after Mara's line, before anyone could go on: nothing after it was said\./)
    expect(buildSceneWriterPrompt(fixture, next, out.plan, 'Then show me.').user).toContain(`# Cut in\n${cutIn(fixture, next)}`)
    expect(cutIn(fixture, out.state)).toBeUndefined()
  })

  it('traces the cut: the beats shown, the rest kept aside, usage of the shown beats only', async () => {
    const { out } = await played()
    const traced = cutTrace(out.trace, 2)
    expect(traced.beats).toHaveLength(2)
    expect(traced.cut).toHaveLength(2)
    expect(traced.interrupted).toEqual({ after: 2, of: 4 })
    expect(cutTrace(traced, 1)).toBe(traced)
    expect([...(traced.usage?.gestures ?? []), ...(traced.usage?.slang ?? [])].every((u) => u.beat <= 2)).toBe(true)
  })
})
