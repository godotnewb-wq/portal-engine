import { describe, expect, it } from 'vitest'
import { fixture, yardScene } from '@tests/fixture'
import { GameStateSchema } from './schema'
import { createInitialState, startScene, stateProblems } from './state'

describe('game state', () => {
  it('starts with every character’s meters and relations from the pack', () => {
    const state = createInitialState(fixture, 9)
    expect(state.meters['mara']).toEqual({ warmth: 2, bond: 3 })
    expect(state.party).toEqual(['mara'])
    expect(state.relations).toEqual([{ from: 'mara', to: 'tobin', note: 'has known him since the guild took him on', meters: { warmth: 1, bond: -1 } }])
    expect(GameStateSchema.parse(state)).toEqual(state)
  })

  it('opens a scene with the cast’s moods, the walk-ons and a meter baseline', () => {
    const state = yardScene()
    expect(state.scene).toMatchObject({ locationId: 'the-yard', cast: ['mara', 'tobin'], walkOns: ['clerk'] })
    expect(state.scene!.moods['tobin']).toBe('uneasy')
    expect(state.scene!.baseline['mara']).toEqual({ warmth: 2, bond: 3 })
    expect(() => startScene(fixture, state, 'nowhere', [])).toThrow(/nowhere/)
  })

  it('refuses a saved game that names what the pack lacks or uses other meters', () => {
    expect(stateProblems(fixture, yardScene())).toEqual([])
    const state = yardScene()
    state.meters['ghost'] = { warmth: 1, bond: 1 }
    state.meters['mara'] = { approval: 1, trust: 1 }
    // A copy: the state's player is the pack's own object, so mutating it would leak into later tests.
    state.player = { ...state.player, stats: { ...state.player.stats, skills: { ...state.player.stats.skills, empathy: 1 } } }
    expect(stateProblems(fixture, state)).toEqual([
      'meters names unknown character "ghost"',
      "its relationship meters aren't this pack's (bond, warmth)",
      'the player has unknown skill "empathy"'
    ])
  })

  it('refuses a party that names someone unknown or not a Major Character', () => {
    const state = yardScene()
    state.party = ['tobin', 'ghost']
    expect(stateProblems(fixture, state)).toEqual(['the party has "tobin", who isn\'t a Major Character', 'the party names unknown character "ghost"'])
  })
})
