import { describe, expect, it } from 'vitest'
import { fixture } from '@tests/fixture'
import { cleanLoreBudgets, loreBudgets } from './loreBudgets'

describe('lore budgets', () => {
  it('use the pack ruleset where Settings leave a field blank', () => {
    expect(loreBudgets(fixture.ruleset)).toEqual({ sceneTokens: 1200, triggeredTokens: 800, loreLines: 3, set: [] })
    expect(loreBudgets(fixture.ruleset, { triggeredTokens: 500 })).toEqual({ sceneTokens: 1200, triggeredTokens: 500, loreLines: 3, set: ['triggeredTokens'] })
  })

  it('round and clamp values outside the bounds, with a warning, and ignore what isn\'t a number', () => {
    const { overrides, warnings } = cleanLoreBudgets({ sceneTokens: 9000, triggeredTokens: -5, loreLines: 2.6, extra: 1 })
    expect(overrides).toEqual({ sceneTokens: 4000, triggeredTokens: 0, loreLines: 3 })
    expect(warnings).toHaveLength(3)
    expect(cleanLoreBudgets({ sceneTokens: 'lots', loreLines: null }).overrides).toEqual({})
    expect(cleanLoreBudgets(undefined)).toEqual({ overrides: {}, warnings: [] })
  })
})
