import { describe, expect, it } from 'vitest'
import { dice, draws, type Dice } from '@engine/core'
import { fixture } from '@tests/fixture'
import { assistFrom, averageStats, combineEdges, degreeOf, describeCheck, modifier, rankCap, rollCheck } from './checks'
import type { StatBlock } from './schema'

const R = fixture.ruleset
/** Dice that roll exactly the given numbers, in order. */
const loaded = (...rolls: number[]): Dice => ({ roll: () => rolls.shift()!, state: 0 })
const sharp: StatBlock = { level: 2, attributes: { brawn: 3, wits: 7, nerve: 5 }, skills: { notice: 1 } }

describe('modifier (the ruleset’s formula: score − 4)', () => {
  it('follows the ruleset, not a fixed formula', () => {
    expect([1, 4, 7, 10].map((s) => modifier(R, s))).toEqual([-3, 0, 3, 6])
  })
})

describe('degreeOf (strong margin 4, cost margin 2)', () => {
  it('reads the margin by the ruleset’s degrees', () => {
    expect(degreeOf(R, 17, 13)).toBe('strong')
    expect(degreeOf(R, 16, 13)).toBe('success')
    expect(degreeOf(R, 11, 13)).toBe('cost')
    expect(degreeOf(R, 10, 13)).toBe('failure')
  })
})

describe('rollCheck', () => {
  it('adds the skill’s attribute modifier and rank, against the ruleset’s difficulty words', () => {
    const result = rollCheck(R, sharp, { skill: 'notice', difficulty: 'tough' }, loaded(9))
    expect(result).toMatchObject({ attribute: 'wits', modifier: 3, rank: 1, total: 13, dc: 13, degree: 'success' })
    expect(describeCheck(R, 'Kit', result)).toBe('Kit — Notice 13 vs 13: success')
  })

  it('moves a critical one step, keeps the better or worse die, and counts an untrained skill as rank 0', () => {
    // 20 − 1 = 19 vs 18 is a success; the natural 20 makes it strong.
    expect(rollCheck(R, sharp, { skill: 'fight', difficulty: 'grim' }, loaded(20)).degree).toBe('strong')
    expect(rollCheck(R, sharp, { skill: 'notice', difficulty: 'routine' }, loaded(1)).degree).toBe('failure')
    expect(rollCheck(R, sharp, { skill: 'sneak', difficulty: 'routine', edges: ['advantage'] }, loaded(2, 11)).natural).toBe(11)
    expect(rollCheck(R, sharp, { skill: 'sneak', difficulty: 'routine' }, loaded(5))).toMatchObject({ rank: 0, total: 8 })
  })

  it('refuses a skill or difficulty the ruleset doesn’t have', () => {
    expect(() => rollCheck(R, sharp, { skill: 'empathy', difficulty: 'tough' }, loaded(5))).toThrow('Unknown skill "empathy"')
    expect(() => rollCheck(R, sharp, { skill: 'notice', difficulty: 'moderate' }, loaded(5))).toThrow('Unknown difficulty "moderate"')
  })
})

describe('assists (meter bond: +1 from 1, advantage from 7, rank 1 needed)', () => {
  it('reads the threshold meter and values from the ruleset', () => {
    expect(assistFrom(R, { stats: sharp, meter: 10 }, 'fight')).toEqual({ bonus: 0, edge: 'none' })
    expect(assistFrom(R, { stats: sharp, meter: 0 }, 'notice')).toEqual({ bonus: 0, edge: 'none' })
    expect(assistFrom(R, { stats: sharp, meter: 1 }, 'notice')).toEqual({ bonus: 1, edge: 'none' })
    expect(assistFrom(R, { stats: sharp, meter: 7 }, 'notice')).toEqual({ bonus: 0, edge: 'advantage' })
  })

  it('never stacks advantages, and cancels advantage against disadvantage', () => {
    expect(combineEdges(['advantage', 'advantage'])).toBe('advantage')
    expect(combineEdges(['advantage', 'disadvantage'])).toBe('none')
  })
})

describe('rank caps and average stats', () => {
  it('caps ranks by level from the ruleset, the last step covering every level above', () => {
    expect([1, 3, 4, 5, 9].map((l) => rankCap(R, l))).toEqual([1, 1, 3, 3, 3])
  })

  it('gives someone without stats the ruleset’s average in every attribute', () => {
    expect(averageStats(R)).toEqual({ level: 1, attributes: { brawn: 4, wits: 4, nerve: 4 }, skills: {} })
  })
})

describe('dice', () => {
  it('rolls the seeded generator’s sequence and resumes from its stored state', () => {
    const a = dice(42)
    const first = [a.roll(20), a.roll(20), a.roll(20)]
    const gen = draws(42)
    expect(first).toEqual([0, 0, 0].map(() => 1 + Math.floor(gen() * 20)))
    const b = dice(42)
    b.roll(20)
    expect([dice(b.state).roll(20)]).toEqual(first.slice(1, 2))
  })
})
