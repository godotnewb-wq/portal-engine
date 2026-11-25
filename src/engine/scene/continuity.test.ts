import { describe, expect, it } from 'vitest'
import type { Prompt } from '@engine/core'
import type { Bookkeeping, GameState, Turn } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { whereSceneStands } from './director'
import { keepEnds, SUMMARY_CHARS } from './turn'
import { wholeWords } from './phrases'
import { runTurn, type TurnLlm } from './runTurn'
import { buildSceneDirectorPrompt } from './sceneDirector'

// Continuity through the whole scene (2026-11-25, user).

const records = (changed: string): Bookkeeping => ({ source: 'bookkeeper', out: [], leaks: [], guesses: [], around: [], unresolved: [], partial: [], said: [], new: [], moods: [], checks: [], refused: [], changed })
const turn = (n: number, changed?: string): Turn => ({ id: `t${n}`, player: `line ${n}`, beats: [{ kind: 'narration', text: `Beat ${n}.` }], checks: [], speakers: [], texture: [], ...(changed !== undefined && { records: records(changed) }) })
function withTurns(changes: (string | undefined)[]): GameState {
  const state = yardScene(13)
  return { ...state, scene: { ...state.scene!, turns: changes.map((c, i) => turn(i + 1, c)) } }
}

describe('where the scene stands', () => {
  it("lists what each turn changed from the first, leaving out turns that changed nothing", () => {
    const state = withTurns(['Mara set the price at two pennies a crate.', undefined, '  ', 'Kit agreed, and Tobin went to fetch the cart.'])
    expect(whereSceneStands(state.scene!)).toEqual(['- Turn 1: Mara set the price at two pennies a crate.', '- Turn 4: Kit agreed, and Tobin went to fetch the cart.'])
  })

  it('reaches both the scene director and the scene writer, all of it', async () => {
    const state = withTurns(['Mara set the price at two pennies a crate.', 'Kit agreed.', 'Tobin left for the cart.', 'Mara counted the coins.'])
    expect(buildSceneDirectorPrompt(fixture, state, 'And the cart?').user).toContain('# Where the scene stands (all of it stays true unless someone changes it on screen)\n- Turn 1: Mara set the price at two pennies a crate.\n- Turn 2: Kit agreed.')
    const prompts: Prompt[] = []
    const llm: TurnLlm = { direct: async (p) => (prompts.push(p), '{}'), write: async (p, onDelta) => (prompts.push(p), onDelta('NARRATION: The yard is quiet.'), 'NARRATION: The yard is quiet.') }
    await runTurn(fixture, state, 'And the cart?', llm, () => {}, { pipeline: 'scene' })
    expect(prompts[1]!.user).toContain('# Where the scene stands (all of it stays true unless a line changes it)\n- Turn 1: Mara set the price at two pennies a crate.')
  })
})

describe('the earlier-in-the-scene summary', () => {
  it('keeps how the scene began when it runs over, and cuts the middle', () => {
    const text = `START ${'a'.repeat(1500)} MIDDLE ${'b'.repeat(1500)} END`
    const kept = keepEnds(text, SUMMARY_CHARS)
    expect(kept.length).toBeLessThanOrEqual(SUMMARY_CHARS)
    expect(kept.startsWith('START')).toBe(true)
    expect(kept.endsWith('END')).toBe(true)
    expect(kept).not.toContain('MIDDLE')
    // Applied again with more added, the start stays and there is still one gap.
    const again = keepEnds(`${kept}\n\nNEWER ${'c'.repeat(600)}`, SUMMARY_CHARS)
    expect(again.startsWith('START')).toBe(true)
    expect(again.split('[…]')).toHaveLength(2)
    expect(keepEnds('short', SUMMARY_CHARS)).toBe('short')
  })
})

describe('gestures in the writer’s "Used already"', () => {
  it('end on a whole word', () => {
    expect(wholeWords('picks up her glass without looking at the')).toBe('picks up her glass without looking')
    expect(wholeWords('sets three glasses down before anyone asks, and')).toBe('sets three glasses down before anyone asks')
    expect(wholeWords('the')).toBe('the')
  })
})
