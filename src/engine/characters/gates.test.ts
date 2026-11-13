import { describe, expect, it } from 'vitest'
import { fixture } from '@tests/fixture'
import type { Ruleset } from '@engine/rules'
import { gateMet, requirement, wordsMet } from './gates'
import type { Character } from './schema'

// The fixture's ladder: any (none) · cool ≥ −4 · fair ≥ 1 · fond ≥ 5 · nope (blocked). Its assist default: bond fair.
const R = fixture.ruleset
const base = fixture.characters.find((c) => c.id === 'tobin')!
const who = (c: Partial<Character>): Character => ({ ...base, gates: {}, blockers: [], motives: [], ...c }) as Character
const word = (r: Ruleset, c: Character, action: 'assist' | 'recruit', meter = 'bond') => requirement(r, c, action, meter).word
const motive = (type: string, strength: string, evidence = 'e') => ({ type, strength, evidence, reason: 'r' })

// Milestone 4a, task 5: requirements worked out as npc design §6 says, in its order.
describe('requirement', () => {
  it('starts from the ruleset’s default, or the card’s own base, and asks nothing where neither names the meter', () => {
    expect(word(R, who({}), 'assist')).toBe('fair')
    expect(word(R, who({ gates: { assist: { base: { bond: 'fond' } } } }), 'assist')).toBe('fond')
    expect(requirement(R, who({}), 'assist', 'warmth')).toEqual({ word: 'any', blocked: false })
    expect(requirement(R, who({}), 'assist', 'bond')).toEqual({ word: 'fair', min: 1, blocked: false })
  })

  it('shifts by links from the card’s layers, never onto the blocked rung', () => {
    // The fixture links Reach "aloof" to recruit bond +1.
    const aloof = who({ layers: { axes: {}, attachment: { reach: 'aloof' }, values: [], foundations: {} }, gates: { recruit: { base: { bond: 'fair' } } } })
    expect(word(R, aloof, 'recruit')).toBe('fond')
    const strict = { ...aloof, gates: { recruit: { base: { bond: 'fond' } } } }
    expect(word(R, strict, 'recruit')).toBe('fond')
    expect(word({ ...R, people: { ...R.people, links: [{ ...R.people.links[0]!, shift: 9 }] } }, aloof, 'recruit')).toBe('fond')
  })

  it('steps down by the strongest motive, to its floor, without adding motives up or raising a low requirement', () => {
    // "coin" floors bond at "cool"; strengths slight 1, firm 2.
    const c = (motives: Character['motives'], b = 'fond') => who({ motives, gates: { recruit: { base: { bond: b } } } })
    expect(word(R, c([motive('coin', 'slight')]), 'recruit')).toBe('fair')
    expect(word(R, c([motive('coin', 'firm')]), 'recruit')).toBe('cool')
    expect(word(R, c([motive('coin', 'slight'), motive('coin', 'firm', 'other')]), 'recruit')).toBe('cool')
    expect(word(R, c([motive('coin', 'firm')], 'any'), 'recruit')).toBe('any')
    // "oath" has no floors: it is a tie of feeling, and shifts nothing.
    expect(word(R, c([motive('oath', 'firm')]), 'recruit')).toBe('fond')
  })

  it('never shifts "never", and a motive that doesn’t shift the assist gate leaves it alone', () => {
    expect(word(R, who({ motives: [motive('threat', 'firm')], gates: { recruit: { base: { bond: 'nope' } } } }), 'recruit')).toBe('nope')
    const threatened = who({ motives: [motive('threat', 'firm')], gates: { recruit: { base: { bond: 'fond' } }, assist: { base: { bond: 'fond' } } } })
    expect(word(R, threatened, 'recruit')).toBe('cool')
    expect(word(R, threatened, 'assist')).toBe('fond')
  })

  it('lets the card fix a requirement outright, and blockers close the action', () => {
    expect(word(R, who({ gates: { assist: { fixed: { bond: 'cool' } } }, motives: [motive('coin', 'firm')] }), 'assist')).toBe('cool')
    expect(requirement(R, who({ blockers: [{ action: 'assist', reason: 'oath-bound' }] }), 'assist', 'bond')).toEqual({ word: 'nope', blocked: true })
  })
})

describe('gateMet', () => {
  it('needs every meter the gate names, reads a missing meter as neutral, and fails when blocked', () => {
    expect(gateMet(R, who({}), 'assist', { warmth: -9, bond: 1 })).toBe(true)
    expect(gateMet(R, who({}), 'assist', { warmth: 9, bond: 0 })).toBe(false)
    expect(gateMet(R, who({}), 'assist', { warmth: 9 })).toBe(false)
    expect(gateMet(R, who({ blockers: [{ action: 'assist', reason: 'x' }] }), 'assist', { warmth: 9, bond: 9 })).toBe(false)
    // An action nothing names asks nothing.
    expect(gateMet(R, who({}), 'bond', { warmth: -10, bond: -10 })).toBe(true)
  })
})

// Voluntary disclosure (npc design §6): the authored minimums, used as they are.
describe('wordsMet', () => {
  it('needs every named meter (a conjunction) and asks nothing of meters left out', () => {
    const words = { bond: 'fond', warmth: 'fair' }
    expect(wordsMet(R, words, { bond: 5, warmth: 1 })).toBe(true)
    expect(wordsMet(R, words, { bond: 5, warmth: 0 })).toBe(false)
    expect(wordsMet(R, words, { bond: 4, warmth: 9 })).toBe(false)
    expect(wordsMet(R, { warmth: 'fair' }, { bond: -10, warmth: 1 })).toBe(true)
    expect(wordsMet(R, {}, { bond: -10, warmth: -10 })).toBe(true)
    expect(wordsMet(R, { bond: 'nope' }, { bond: 10, warmth: 10 })).toBe(false)
  })
})
