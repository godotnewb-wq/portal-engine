import { describe, expect, it } from 'vitest'
import type { Character } from '@engine/characters'
import { gateMet, requirement } from '@engine/characters'
import type { Ruleset } from '@engine/rules'
import { content } from './support'

/** The Neonpunk Nights ruleset: the design's ladder, default assist gate and motive floors (npc design §6). */
const R = content.ruleset
const person = (c: Partial<Character>): Character =>
  ({ ...content.characters.find((x) => x.id === 'oria-senn')!, gates: {}, blockers: [], motives: [], layers: undefined, ...c }) as Character
const words = (r: Ruleset, c: Character, action: 'recruit' | 'assist') => Object.fromEntries(['trust', 'approval', 'interest'].map((m) => [m, requirement(r, c, action, m).word]))
const layers = (closeness: string, composure: string) => ({ axes: { composure }, attachment: { closeness }, values: [], foundations: {} })

// Milestone 4a acceptance 4: the gate examples in npc design §6.
describe('Lucy’s table (link shifts)', () => {
  // The design's example links (reveal a secret: Closeness avoidant/distant +2/+1, Composure reserved +1). Disclosure now
  // uses authored minimums, so the same arithmetic is checked here on another action the pack doesn't link.
  const withLinks: Ruleset = {
    ...R,
    people: {
      ...R.people,
      links: [
        { axis: 'closeness', stage: 'avoidant', action: 'recruit', meter: 'trust', shift: 2 },
        { axis: 'closeness', stage: 'distant', action: 'recruit', meter: 'trust', shift: 1 },
        { axis: 'composure', stage: 'reserved', action: 'recruit', meter: 'trust', shift: 1 }
      ]
    }
  }
  const lucy = (closeness: string, composure: string) =>
    person({ layers: layers(closeness, composure), gates: { recruit: { base: { trust: 'low', approval: 'low' }, fixed: { interest: 'not hostile' } } } })

  it('starts at very high trust when avoidant and reserved', () => {
    expect(words(withLinks, lucy('avoidant', 'reserved'), 'recruit')).toEqual({ trust: 'very high', approval: 'low', interest: 'not hostile' })
  })
  it('needs high trust once she is only distant', () => {
    expect(words(withLinks, lucy('distant', 'reserved'), 'recruit')).toEqual({ trust: 'high', approval: 'low', interest: 'not hostile' })
  })
  it('needs low trust once both are balanced', () => {
    expect(words(withLinks, lucy('balanced', 'balanced'), 'recruit')).toEqual({ trust: 'low', approval: 'low', interest: 'not hostile' })
  })
})

describe('Kade’s examples (motive shifts and floors)', () => {
  const kade = (strength = 'strong') =>
    person({ motives: [{ type: 'cause', strength, evidence: 'bring down Vance', reason: 'we both want Vance dead' }], gates: { recruit: { base: { trust: 'moderate', approval: 'moderate' } } } })

  it('a strong Cause takes his recruit gate from moderate to not hostile on both meters', () => {
    expect(words(R, kade(), 'recruit')).toMatchObject({ trust: 'not hostile', approval: 'not hostile' })
    expect(gateMet(R, kade(), 'recruit', { trust: -5, approval: -8, interest: 0 })).toBe(true)
    expect(gateMet(R, kade(), 'recruit', { trust: -5, approval: -25, interest: 0 })).toBe(false)
  })

  it('a strong Cause takes his assist gate to its floors: trust tolerates, approval grudging', () => {
    expect(words(R, kade(), 'assist')).toMatchObject({ trust: 'tolerates', approval: 'grudging' })
    expect(gateMet(R, kade(), 'assist', { trust: -5, approval: -8, interest: 0 })).toBe(true)
  })

  it('a desperate Cause still stops at its floor', () => {
    expect(words(R, kade('desperate'), 'assist')).toMatchObject({ trust: 'tolerates', approval: 'grudging' })
  })
})

describe('what never moves', () => {
  it('"never" is never shifted', () => {
    const c = person({ motives: [{ type: 'necessity', strength: 'desperate', evidence: 'x', reason: 'r' }], gates: { recruit: { base: { trust: 'never' } } } })
    expect(requirement(R, c, 'recruit', 'trust')).toEqual({ word: 'never', blocked: true })
  })

  it('Leverage never shifts the assist gate, though it shifts recruiting', () => {
    const c = person({ motives: [{ type: 'leverage', strength: 'desperate', evidence: 'the ledger', reason: 'you know about the ledger' }], gates: { recruit: { base: { trust: 'moderate' } } } })
    expect(requirement(R, c, 'assist', 'trust').word).toBe('low')
    expect(requirement(R, c, 'assist', 'approval').word).toBe('not hostile')
    // Desperate is 4 rungs: moderate → tolerates (its floor, none, is lower still).
    expect(requirement(R, c, 'recruit', 'trust').word).toBe('tolerates')
  })
})
