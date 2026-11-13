import { describe, expect, it } from 'vitest'
import { fixture } from '@tests/fixture'
import { bandWord, meterWords, rulesetProblems, type Ruleset } from './ruleset'

const R = fixture.ruleset

// Milestone 4a, task 2: signed meters around a neutral point, shown to prompts and the player only as word bands
// (relationships §1).
describe('meter bands', () => {
  it('reads a value as the band it falls in, from the low end up', () => {
    expect(bandWord(R, 'warmth', -10)).toBe('cold')
    expect(bandWord(R, 'warmth', -4)).toBe('cold')
    expect(bandWord(R, 'warmth', -3)).toBe('civil')
    expect(bandWord(R, 'warmth', 0)).toBe('civil')
    expect(bandWord(R, 'warmth', 4)).toBe('warm')
    expect(bandWord(R, 'warmth', 10)).toBe('warm')
  })

  it('reads a value past either end as the nearest band', () => {
    expect(bandWord(R, 'bond', -99)).toBe('estranged')
    expect(bandWord(R, 'bond', 99)).toBe('close')
  })

  it('shows every meter in words, a missing one as neutral, and no numbers', () => {
    expect(meterWords(R, { warmth: 5, bond: -7 })).toBe('warmth: warm; bond: estranged')
    expect(meterWords(R, { warmth: 5 })).toBe('warmth: warm; bond: loose')
  })

  it('starts a stranger at the neutral point', () => {
    expect(R.relations.start).toEqual({ warmth: 0, bond: 0 })
    expect(R.meters.neutral).toBe(0)
    expect(R.meters.min).toBeLessThan(0)
  })
})

describe('rulesetProblems: meters', () => {
  const withMeters = (meters: Partial<Ruleset['meters']>, start = R.relations.start): Ruleset => ({ ...R, meters: { ...R.meters, ...meters }, relations: { start } })

  it('accepts the fixture', () => {
    expect(rulesetProblems(R)).toEqual([])
  })

  it('needs bands that start at the bottom of the range and rise, within it', () => {
    const list = [
      { ...R.meters.list[0]!, bands: [{ from: -8, word: 'cold' }, { from: 4, word: 'warm' }] },
      { ...R.meters.list[1]!, bands: [{ from: -10, word: 'estranged' }, { from: 4, word: 'close' }, { from: 4, word: 'closer' }, { from: 12, word: 'sworn' }] }
    ]
    expect(rulesetProblems(withMeters({ list }))).toEqual([
      `meter "warmth"'s first band must start at -10`,
      `meter "bond"'s bands must rise: "closer" starts at or below the one before`,
      `meter "bond"'s band "sworn" starts outside -10–10`
    ])
  })

  it('needs neutral and the start values inside the range', () => {
    expect(rulesetProblems(withMeters({ neutral: 11 }, { warmth: 0, bond: -11 }))).toEqual([
      'meters.neutral 11 is outside -10–10',
      'relations.start for "bond" is outside -10–10'
    ])
  })
})
