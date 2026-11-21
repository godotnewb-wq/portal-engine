import { describe, expect, it } from 'vitest'
import type { Prompt } from '@engine/core'
import type { GameState } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { runTurn, type TurnLlm } from './runTurn'
import { checkEvent } from './sceneWriter'

// A turn made by the `scene` pipeline (Milestone 5 plan, task 3): the game-master director, the scene writer, and
// everything after them reading the scene plan through its view.

/** The yard with Tobin knowing Mara, so he could see through her. */
function yard(): GameState {
  const state = yardScene(13)
  state.relations = [...state.relations, { from: 'tobin', to: 'mara', tags: [], note: 'has worked under her a year', meters: { warmth: 0, bond: 0 } }]
  return state
}

const LEDGER = {
  player_action: { doing: 'asks Mara about a second ledger', uncertain: false },
  checks: [{ id: 'read-mara', who: 'tobin', skill: 'notice', target: 'mara', stakes: 'Tobin sees the lie for what it is' }],
  focus: ['mara'],
  moments: [{ who: 'mara', feels: { shade: 'glum', intensity: 3, reason: 'the question she dreads' }, lands: 'the question she has no good answer to', wants: 'to close it down', pressure: 'keen' }],
  pressures: [{ who: 'mara', kind: 'secret', secret: 'mara.two-books', approach: 'lie' }],
  draws_on: [],
  stakes: 'whether Kit believes there is one book'
}

/** A scripted director and writer; `writes` are the writer's replies in order (a second is the rewrite). */
function scripted(plan: object | string, writes: string[]): TurnLlm & { prompts: Prompt[] } {
  const prompts: Prompt[] = []
  let n = 0
  return {
    prompts,
    direct: async (p) => (prompts.push(p), typeof plan === 'string' ? plan : JSON.stringify(plan)),
    write: async (p, onDelta) => {
      prompts.push(p)
      const text = writes[Math.min(n++, writes.length - 1)]!
      onDelta(text)
      return text
    }
  }
}

const SCENE = [
  'Mara: She closes the tally book. "One book, Kit. The Guild keeps one."',
  'Tobin: "Hm." He looks at the floor and says nothing more.',
  'NARRATION: The lamp over the gate ticks as it cools.',
  '[Mara: EXPRESSION guarded]',
  '[Tobin: EXPRESSION doubtful]'
].join('\n')

describe('a scene turn', () => {
  it('plays end to end: the scene plan rides along, its view is applied, and the turn keeps what was live', async () => {
    const llm = scripted(LEDGER, [SCENE])
    const out = await runTurn(fixture, yard(), 'Is there a second ledger, Mara?', llm, () => {}, { pipeline: 'scene', forceNatural: 15 })
    expect(out.trace.director.pipeline).toBe('scene')
    expect(out.plan.scene).toMatchObject({ pipeline: 'scene', focus: ['mara'], pressures: [{ who: 'mara', kind: 'secret', ref: 'mara.two-books', approach: 'lie' }] })
    // The rolled check reached the scene plan too.
    expect(out.plan.scene!.checks[0]!.result).toBeDefined()
    // A paragraph mixing action and speech is cut into beats; Tobin, present but not in focus, may speak.
    expect(out.beats.map((b) => b.kind)).toEqual(['narration', 'dialogue', 'dialogue', 'narration', 'narration'])
    expect(out.problems).toEqual([])
    const turn = out.state.scene!.turns.at(-1)!
    expect(turn.live).toEqual([{ who: 'mara', kind: 'secret', ref: 'mara.two-books' }])
    expect(turn.kept).toEqual(['mara.two-books'])
    expect(out.state.scene!.pressures['mara']).toBe(1)
    expect(out.state.scene!.expressions).toMatchObject({ mara: 'guarded', tobin: 'doubtful' })
  })

  it('falls back to the game’s own plan on an unreadable reply, at no extra call', async () => {
    const out = await runTurn(fixture, yard(), 'Evening.', scripted('Sorry, no plan.', ['NARRATION: The yard is quiet.\nMara: "Evening."']), () => {}, { pipeline: 'scene' })
    expect(out.fallback).toBe(true)
    expect(out.calls).toBe(2)
    expect(out.plan.scene!.pressures).toEqual([])
  })

  it('sends back a speaker saying what only someone else knows, and repeats only from the third', async () => {
    // Tobin can't know it, and he says it in the secret's own words. A paraphrase gets past this check by design; the
    // bookkeeper records such a line as his claim after the turn (milestone 4c).
    const leak = 'Tobin: "A second ledger records what the yard really takes in, Kit."\nMara: "Tobin."'
    const llm = scripted({ ...LEDGER, checks: [] }, [leak, SCENE])
    const out = await runTurn(fixture, yard(), 'Is there a second ledger, Mara?', llm, () => {}, { pipeline: 'scene' })
    expect(out.problems.map((p) => p.kind)).toContain('unowned-fact')
    expect(out.problems.find((p) => p.kind === 'unowned-fact')!.fix).toMatch(/^Beat 1: Tobin says what only Mara knows \("/)
    expect(out.calls).toBe(3)
  })
})

describe('the scene writer’s brief', () => {
  it('gives the moment, the undercurrent, the stakes and the rolls as events, and the format’s tag footer', async () => {
    const llm = scripted(LEDGER, [SCENE])
    await runTurn(fixture, yard(), 'Is there a second ledger, Mara?', llm, () => {}, { pipeline: 'scene', forceNatural: 2 })
    const writer = llm.prompts[1]!
    expect(writer.system).toMatch(/One continuous scene, written by one hand/)
    expect(writer.system).toMatch(/Then the tags, one per line/)
    // Everyone present is portrayed; the people in the moment get their voice cards.
    expect(writer.system).toMatch(/## Mara\n[\s\S]*### Mara's voice/)
    expect(writer.system).toMatch(/## Tobin\n(?![\s\S]*### Tobin's voice)/)
    expect(writer.user).toMatch(/# This moment\n- Mara: the question she has no good answer to\. Right now Mara wants to close it down\./)
    expect(writer.user).toMatch(/Underneath, Mara is keeping something \(lie\): /)
    expect(writer.user).toMatch(/# Also here \(they may react or say a little\)\n- Tobin\./)
    expect(writer.user).toContain("# What's at stake\nwhether Kit believes there is one book")
    expect(writer.user).toContain('# What the rolls decided (this happens; honor it)\n- Tobin fails. This does not happen: Tobin sees the lie for what it is. Show the attempt not coming off.')
    expect(writer.user).not.toContain('# The scene ends this turn')
  })

  it('says when the plan ends the scene', async () => {
    const llm = scripted({ ...LEDGER, checks: [], end_scene: true }, [SCENE])
    await runTurn(fixture, yard(), 'Goodnight, Mara.', llm, () => {}, { pipeline: 'scene' })
    expect(llm.prompts[1]!.user).toContain('# The scene ends this turn\nBring it to a close, and add [END SCENE].')
  })

  it('writes each roll as what happens', () => {
    const check = (degree: 'strong' | 'success' | 'cost' | 'failure') => checkEvent(fixture, { id: 'c', who: 'player', skill: 'notice', difficulty: 'routine', stakes: 'you spot the loose board.', result: { degree } as never })
    expect(check('success')).toBe('- You succeed: you spot the loose board.')
    expect(check('cost')).toBe('- You succeed, at a cost: you spot the loose board, and something goes wrong with it.')
    expect(check('failure')).toBe('- You fail. This does not happen: you spot the loose board. Show the attempt not coming off.')
  })
})

