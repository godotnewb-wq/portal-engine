import { describe, expect, it } from 'vitest'
import { content } from './support'
import { GameStateSchema } from '@engine/state'
import { createInitialState, startScene } from '@engine/state'



describe('createInitialState', () => {
  it('starts with every character’s meters and relations, and a valid state', () => {
    const state = createInitialState(content, 1234)
    expect(state.meters['vex']).toEqual({ approval: 5, trust: 20, interest: 12 })
    expect(state.relations).toContainEqual(expect.objectContaining({ from: 'brask', to: 'vex', tags: [{ tag: 'friend', word: 'best friend' }] }))
    expect(GameStateSchema.parse(state)).toEqual(state)
  })

  // Milestone 4a task 6, decided in the cast review (2026-11-13): Rook knows Vex and Brask from a dozen jobs and drinks
  // at Dunmar's; everyone else meets Rook fresh. Tags only: the meters still start where the cards put them.
  it('starts with the cast’s ties toward Rook: Vex and Brask friends, Dunmar’s regular, no one else', () => {
    const state = createInitialState(content, 1)
    expect(Object.keys(state.playerTies).sort()).toEqual(['brask', 'dunmar', 'vex'])
    expect(state.playerTies['vex']!.tags).toEqual([{ tag: 'friend' }])
    expect(state.playerTies['brask']!.tags).toEqual([{ tag: 'friend' }])
    expect(state.playerTies['dunmar']!.tags).toEqual([{ tag: 'client', word: 'regular' }])
  })
})

describe('startScene', () => {
  it('opens the bar scene with the cast’s moods, the walk-ons and a meter baseline', () => {
    const state = startScene(content, createInitialState(content, 1), 'sump-lantern', ['vex', 'brask', 'oria-senn'])
    expect(state.scene?.walkOns).toEqual(['card-player'])
    expect(state.scene?.moods['brask']).toMatch(/anxious/)
    expect(state.scene?.baseline['oria-senn']).toEqual(state.meters['oria-senn'])
    expect(GameStateSchema.parse(state)).toEqual(state)
  })

  it('refuses an unknown character or place', () => {
    const state = createInitialState(content, 1)
    expect(() => startScene(content, state, 'nowhere', [])).toThrow(/nowhere/)
    expect(() => startScene(content, state, 'sump-lantern', ['ghost'])).toThrow(/ghost/)
  })
})
