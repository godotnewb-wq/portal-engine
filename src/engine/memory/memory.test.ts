import { describe, expect, it } from 'vitest'
import { fixture, yardScene } from '@tests/fixture'
import { characterById } from '@engine/pack'
import type { Memory } from '@engine/state'
import { recall } from './memory'

const memoriesOf = (owner: string, n: number): Memory[] => Array.from({ length: n }, (_, i) => ({ owner, text: `m${i}`, level: 'normal', at: i, about: [] }))

// Milestone 4a, task 3 (acceptance 2): recall budgets come from the ruleset by tier, and party membership doesn't change them.
describe('recall budgets by tier', () => {
  const state = { ...yardScene(), memories: [...memoriesOf('mara', 12), ...memoriesOf('tobin', 12)] }
  const mara = characterById(fixture, 'mara')!
  const tobin = characterById(fixture, 'tobin')!

  it('gives a Major Character the major budget and a Recurring NPC the recurring one, from the ruleset', () => {
    expect(mara.tier).toBe('major')
    expect(tobin.tier).toBe('recurring')
    expect(recall(fixture.ruleset, state, mara)).toHaveLength(fixture.ruleset.memory.recall.major)
    expect(recall(fixture.ruleset, state, tobin)).toHaveLength(fixture.ruleset.memory.recall.recurring)
    const tight = { ...fixture.ruleset, memory: { recall: { recurring: 1, major: 2 } } }
    expect(recall(tight, state, mara)).toHaveLength(2)
    expect(recall(tight, state, tobin)).toHaveLength(1)
  })

  it('keeps a Major Character’s budget the same in the party or out of it', () => {
    expect(state.party).toContain('mara')
    expect(recall(fixture.ruleset, { ...state, party: [] }, mara)).toEqual(recall(fixture.ruleset, state, mara))
  })
})
