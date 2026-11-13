import { describe, expect, it } from 'vitest'
import type { Pack } from '@engine/pack'
import { fixture, yardScene } from '@tests/fixture'
import { buildDirectorPrompt } from './director'
import { childGuard } from './guard'
import { parsePlan, validatePlan } from './plan'
import { buildWriterPrompt } from './writer'

/** The fixture with Tobin at its minor age stage ("young"). */
const young: Pack = { ...fixture, characters: fixture.characters.map((c) => (c.id === 'tobin' ? { ...c, age: 'young' } : c)) }
const plan = parsePlan(JSON.stringify({ speakers: [{ id: 'mara', goal: 'answer', mood: 'busy' }], moves: [{ who: 'mara', answers: 'player', move: 'answer' }] }))!

// Milestone 4a task 6 (director writer §5): the simple child guard, an engine line packs can't turn off.
describe('the child guard', () => {
  it('says nothing when no minor is present', () => {
    expect(childGuard(fixture, yardScene())).toBe('')
    expect(buildDirectorPrompt(fixture, yardScene(), 'Hello.').system).not.toMatch(/Minors present/)
  })

  it('names minors present, by the ruleset’s minor stages, to the director and the writer', () => {
    const state = yardScene()
    const line = '# Minors present\nTobin (young) is a minor. Nothing romantic or sexual involves them or is directed at them.'
    expect(childGuard(young, state)).toBe(line)
    const director = buildDirectorPrompt(young, state, 'Hello.').system
    expect(director).toContain(line)
    expect(director).toMatch(/## Tobin \[id: tobin\] — recurring character, young, automaton/)
    expect(buildWriterPrompt(young, state, validatePlan(young, state, plan).plan, 'Hello.').system).toContain(line)
  })

  it('leaves out a minor who has left the scene', () => {
    const state = yardScene()
    state.scene!.departed.push('tobin')
    expect(childGuard(young, state)).toBe('')
  })
})
