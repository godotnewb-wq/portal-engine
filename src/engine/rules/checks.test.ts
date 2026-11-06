import { describe, expect, it } from 'vitest'
import type { StatBlock } from './schema'
import { assistFrom, combineEdges, degreeOf, describeCheck, modifier, rankCap, rollCheck } from './checks'
import { dice, type Dice } from '@engine/core'
import { draws } from '@engine/core'

/** Dice that roll exactly the given numbers, in order. */
const loaded = (...rolls: number[]): Dice => ({ roll: () => rolls.shift()!, state: 0 })

const vex: StatBlock = {
  level: 2,
  attributes: { might: 10, agility: 16, vigor: 12, intellect: 10, insight: 14, presence: 11 },
  skills: { empathy: 1, streetwise: 2 }
}

describe('modifier', () => {
  it('is (score − 10) / 2 rounded down', () => {
    expect([8, 9, 10, 11, 14, 15, 20].map(modifier)).toEqual([-1, -1, 0, 0, 2, 2, 5])
  })
})

describe('degreeOf', () => {
  it('reads the margin as the four degrees', () => {
    expect(degreeOf(20, 15)).toBe('strong')
    expect(degreeOf(15, 15)).toBe('success')
    expect(degreeOf(11, 15)).toBe('cost')
    expect(degreeOf(10, 15)).toBe('failure')
  })
})

describe('rollCheck', () => {
  it('adds the skill’s attribute modifier and rank, and compares with the difficulty’s DC', () => {
    const result = rollCheck(vex, { skill: 'empathy', difficulty: 'moderate' }, loaded(14))
    expect(result).toMatchObject({ attribute: 'insight', modifier: 2, rank: 1, total: 17, dc: 15, degree: 'success', critical: null })
    expect(describeCheck('Vex', result)).toBe('Vex — Empathy 17 vs 15: success')
  })

  it('keeps the better die with advantage and the worse with disadvantage', () => {
    expect(rollCheck(vex, { skill: 'empathy', difficulty: 'easy', edges: ['advantage'] }, loaded(3, 12)).natural).toBe(12)
    expect(rollCheck(vex, { skill: 'empathy', difficulty: 'easy', edges: ['disadvantage'] }, loaded(3, 12)).natural).toBe(3)
  })

  it('moves a natural 20 one step up and a natural 1 one step down', () => {
    // 20 + 3 = 23 vs 30 would be a failure; the natural 20 makes it a success at a cost.
    expect(rollCheck(vex, { skill: 'empathy', difficulty: 'legendary' }, loaded(20)).degree).toBe('cost')
    // 1 + 3 = 4 vs 5 would cost; the natural 1 makes it a failure.
    expect(rollCheck(vex, { skill: 'empathy', difficulty: 'trivial' }, loaded(1)).degree).toBe('failure')
  })

  it('uses another attribute when asked, and counts an untrained skill as rank 0', () => {
    expect(rollCheck(vex, { skill: 'athletics', difficulty: 'easy', attribute: 'agility' }, loaded(10))).toMatchObject({ modifier: 3, rank: 0, total: 13 })
  })
})

describe('edges and assists', () => {
  it('never stacks advantages, and cancels advantage against disadvantage', () => {
    expect(combineEdges(['advantage', 'advantage'])).toBe('advantage')
    expect(combineEdges(['advantage', 'disadvantage'])).toBe('none')
    expect(combineEdges([])).toBe('none')
  })

  it('gives help by trust only when the helper has the skill', () => {
    expect(assistFrom({ stats: vex, trust: 90 }, 'medicine')).toEqual({ bonus: 0, edge: 'none' })
    expect(assistFrom({ stats: vex, trust: 20 }, 'empathy')).toEqual({ bonus: 0, edge: 'none' })
    expect(assistFrom({ stats: vex, trust: 50 }, 'empathy')).toEqual({ bonus: 2, edge: 'none' })
    expect(assistFrom({ stats: vex, trust: 80 }, 'empathy')).toEqual({ bonus: 0, edge: 'advantage' })
  })
})

describe('rankCap', () => {
  it('rises with level to 5', () => {
    expect([1, 2, 3, 5, 7, 10].map(rankCap)).toEqual([2, 2, 3, 4, 5, 5])
  })
})

describe('dice', () => {
  it('rolls the same sequence as the seeded generator, and resumes from its stored state', () => {
    const a = dice(42)
    const first = [a.roll(20), a.roll(20), a.roll(20)]
    const gen = draws(42)
    expect(first).toEqual([0, 0, 0].map(() => 1 + Math.floor(gen() * 20)))
    const b = dice(42)
    b.roll(20)
    const resumed = dice(b.state)
    expect([resumed.roll(20), resumed.roll(20)]).toEqual(first.slice(1))
  })

  it('stays within 1..sides', () => {
    const d = dice(7)
    for (let i = 0; i < 500; i++) {
      const n = d.roll(20)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(20)
    }
  })
})
