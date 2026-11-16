import { describe, expect, it } from 'vitest'
import { applyTie, needsAgreement, tagNamed, tagsToward, tieProblem, type GameState, type TieChange } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'

// Milestone 4b, task 4: relationship tags change through story developments (relationships §3; decided 2026-11-13).
const change = (c: Partial<TieChange> & { from: string; to: string }): TieChange => ({ reason: '', ...c })
// Who proposes a change, and when, is the end-of-scene tie check (relationships/tieCheck.test.ts; decided 2026-11-15).

describe('tie changes', () => {
  it('know tags by id or word, and which tags with the player need the player’s yes', () => {
    expect(tagNamed(fixture, 'apprentice')).toBe('hand')
    expect(tagNamed(fixture, 'FOE')).toBe('foe')
    expect(tagNamed(fixture, 'cousin')).toBeUndefined()
    expect([needsAgreement(fixture, 'hand'), needsAgreement(fixture, 'elder'), needsAgreement(fixture, 'foe')]).toEqual([true, true, false])
  })

  it('change both sides with the counterpart, and make the reason the note on both', () => {
    const { state, event } = applyTie(fixture, yardScene(), change({ from: 'mara', to: 'tobin', add: 'hand', word: 'apprentice', backWord: 'master', reason: 'she takes him on' }), 't1')
    expect(tagsToward(state, 'mara', 'tobin')).toEqual([{ tag: 'foe', word: 'rival' }, { tag: 'hand', word: 'apprentice' }])
    expect(state.relations.find((x) => x.from === 'tobin' && x.to === 'mara')).toMatchObject({ tags: [{ tag: 'master', word: 'master' }], note: 'she takes him on', meters: fixture.ruleset.relations.start })
    expect(state.relations.find((x) => x.from === 'mara' && x.to === 'tobin')!.note).toBe('she takes him on')
    expect(event).toEqual({ from: 'mara', to: 'tobin', added: ['hand'], ended: [], word: 'apprentice', reason: 'she takes him on', turn: 't1' })
    // Ending it ends the counterpart too.
    const ended = applyTie(fixture, state, change({ from: 'mara', to: 'tobin', end: 'hand' })).state
    expect([tagsToward(ended, 'mara', 'tobin'), tagsToward(ended, 'tobin', 'mara')]).toEqual([[{ tag: 'foe', word: 'rival' }], []])
  })

  it('past the limit end the oldest tag that isn’t family, and refuse one when every tag held is family', () => {
    const hired = applyTie(fixture, yardScene(), change({ from: 'mara', to: 'tobin', add: 'hand' })).state
    // Two is the fixture's limit: a third ends "foe", her oldest that isn't family.
    const kin = applyTie(fixture, hired, change({ from: 'mara', to: 'tobin', add: 'elder', backWord: 'younger brother' }))
    expect(tagsToward(kin.state, 'mara', 'tobin').map((t) => t.tag)).toEqual(['hand', 'elder'])
    expect(kin.event.ended).toEqual(['foe'])
    expect(tagsToward(kin.state, 'tobin', 'mara')).toEqual([{ tag: 'master' }, { tag: 'younger', word: 'younger brother' }])
    const family: GameState = { ...yardScene(), relations: [{ from: 'mara', to: 'tobin', tags: [{ tag: 'elder' }, { tag: 'younger' }], meters: { warmth: 0, bond: 0 } }] }
    expect(tieProblem(fixture, family, change({ from: 'mara', to: 'tobin', add: 'hand' }))).toBe('mara toward tobin: all 2 of the tags already held are family')
  })

  it('refuse ending a tag not held or adding one already held, and leave a one-sided tag unmirrored', () => {
    expect(tieProblem(fixture, yardScene(), change({ from: 'mara', to: 'tobin', end: 'hand' }))).toBe('mara doesn\'t hold "hand" toward tobin')
    expect(tieProblem(fixture, yardScene(), change({ from: 'mara', to: 'tobin', add: 'foe' }))).toBe('mara already holds "foe" toward tobin')
    // Ending a tag and adding it back is no development, even with a new word (the end-of-Milestone-4 bench's wedding).
    expect(tieProblem(fixture, yardScene(), change({ from: 'mara', to: 'tobin', end: 'foe', add: 'foe', word: 'enemy' }))).toBe('it ends and adds "foe", which changes nothing')
    const grudge = applyTie(fixture, yardScene(), change({ from: 'tobin', to: 'mara', add: 'foe' })).state
    expect([tagsToward(grudge, 'tobin', 'mara'), tagsToward(grudge, 'mara', 'tobin')]).toEqual([[{ tag: 'foe' }], [{ tag: 'foe', word: 'rival' }]])
  })
})
