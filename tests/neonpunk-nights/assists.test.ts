import { describe, expect, it } from 'vitest'
import type { Pack } from '@engine/pack'
import type { GameState } from '@engine/state'
import { buildDirectorPrompt, resolvePlan, type BeatPlan } from '@engine/scene'
import { barScene, content } from './support'

/** The pack with Vex's, Brask's and Oria's Empathy set (the cast rewrite, task 6, raises the party to rank 3). */
function ranks(r: { vex?: number; brask?: number; oria?: number }): Pack {
  const set = (id: string, rank?: number) => (c: Pack['characters'][number]) =>
    c.id === id && rank !== undefined ? { ...c, stats: { ...(c.stats ?? { level: 3, attributes: { might: 10, agility: 10, vigor: 10, intellect: 10, insight: 10, presence: 10 }, skills: {} }), skills: { ...(c.stats?.skills ?? {}), empathy: rank } } } : c
  return { ...content, characters: content.characters.map(set('vex', r.vex)).map(set('brask', r.brask)).map(set('oria-senn', r.oria)) }
}
const check = (who = 'player'): BeatPlan => ({ speakers: [], exchange: [], reactions: [], walk_ons: [], texture: [], avoid: [], leaves: [], end_scene: false, checks: [{ id: 'read', who, skill: 'empathy', difficulty: 'moderate', stakes: 'reads Oria' }] }) as BeatPlan
const roll = (pack: Pack, state: GameState, who = 'player') => resolvePlan(pack, state, check(who), { forceNatural: 10 }).plan.checks[0]!

// Milestone 4a acceptance 3 (core rules §1): companions only, gate met and rank 3+, +2 / +3, never advantage.
describe('assists', () => {
  it('one willing, trained companion gives +2, and the chip names them', () => {
    const c = roll(ranks({ vex: 3 }), barScene())
    expect(c.helpers).toEqual(['vex'])
    expect(c.result).toMatchObject({ bonus: 2, edge: 'none' })
    expect(c.line).toMatch(/\(\+2: Vex\)$/)
  })

  it('two or more give +3, the cap', () => {
    const c = roll(ranks({ vex: 3, brask: 4 }), barScene())
    expect(c.helpers).toEqual(['vex', 'brask'])
    expect(c.result?.bonus).toBe(3)
    expect(c.line).toMatch(/\(\+3: Vex, Brask\)$/)
  })

  it('a companion below rank 3 never assists: as shipped, nobody helps with Empathy (both rank 2)', () => {
    expect(roll(ranks({ vex: 3, brask: 2 }), barScene()).helpers).toEqual(['vex'])
    expect(roll(content, barScene()).helpers).toBeUndefined()
  })

  it('as shipped, Brask backs the player on Engineering and Vex on Stealth (each rank 3, both willing)', () => {
    const on = (skill: string) => resolvePlan(content, barScene(), { ...check(), checks: [{ ...check().checks[0]!, skill: skill as never }] }, { forceNatural: 10 }).plan.checks[0]!
    expect(on('engineering')).toMatchObject({ helpers: ['brask'], result: expect.objectContaining({ bonus: 2 }) })
    expect(on('stealth')).toMatchObject({ helpers: ['vex'], result: expect.objectContaining({ bonus: 2 }) })
  })

  it('a companion whose gate isn’t met adds nothing and never hinders', () => {
    const state = barScene()
    state.meters['vex'] = { approval: 5, trust: 5, interest: 0 }
    const c = roll(ranks({ vex: 3 }), state)
    expect(c.helpers).toBeUndefined()
    expect(c.result).toMatchObject({ bonus: 0, edge: 'none' })
  })

  it('someone outside the party never assists, however skilled and warm', () => {
    const state = barScene()
    state.meters['oria-senn'] = { approval: 50, trust: 50, interest: 50 }
    expect(roll(ranks({ oria: 5 }), state).helpers).toBeUndefined()
  })

  it('a companion helps another companion by their own feelings toward them; non-companions get no help', () => {
    // Brask toward Vex: approval 20, trust 35, so his default gate (trust low, approval not hostile) is met.
    expect(roll(ranks({ brask: 3 }), barScene(), 'vex').helpers).toEqual(['brask'])
    expect(roll(ranks({ vex: 3, brask: 3 }), barScene(), 'oria-senn').helpers).toBeUndefined()
  })

  it('a companion who has left the scene doesn’t help', () => {
    const state = barScene()
    state.scene!.departed.push('vex')
    expect(roll(ranks({ vex: 3 }), state).helpers).toBeUndefined()
  })

  it('tells the director in words who would back the player up', () => {
    const state = barScene()
    expect(buildDirectorPrompt(content, state, 'Hello.').user).toMatch(/# Help with the player's checks\nVex would back the player up\. Brask would back the player up\./)
    state.meters['brask'] = { approval: -20, trust: 15, interest: 0 }
    expect(buildDirectorPrompt(content, state, 'Hello.').user).toMatch(/Brask won't lift a finger\./)
  })
})
