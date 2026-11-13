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
