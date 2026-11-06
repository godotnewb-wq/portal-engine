import { describe, expect, it } from 'vitest'
import { buildDirectorPrompt } from '@engine/scene'
import { fallbackPlan, parsePlan, silence, validatePlan, type RawPlan } from '@engine/scene'
import { resolvePlan } from '@engine/scene'
import { barScene, content } from './support'

/** The worked example's turn 1 plan (narrator-scene-engine §11). */
const WORKED = JSON.stringify({
  speakers: [
    { id: 'oria', intent: "Deflect. Claim a 'private collector'.", mood: 'composed', hiding: 'client is the grid consortium', approach: 'lie; tell: over-formal' },
    { id: 'vex', intent: 'Call out the evasion if she catches it.', mood: 'wary', depends_on_check: 'vex_empathy' }
  ],
  reactions: [{ id: 'brask', beat: 'fidgets with his glass' }],
  checks: [{ id: 'vex_empathy', who: 'vex', skill: 'Empathy', difficulty: 'moderate', stakes: 'notices Oria is lying' }],
  texture: ['condensation dripping from an Aether-cooled pipe overhead'],
  contrast: 'Oria smooth, Vex clipped.',
  avoid: ['eyes narrowed']
})

const raw = (patch: Partial<RawPlan>): RawPlan => ({ ...parsePlan(WORKED)!, ...patch })

describe('parsePlan', () => {
  it('reads JSON wrapped in a fence or prose, and fills what is missing', () => {
    const plan = parsePlan('Here you go:\n```json\n' + WORKED + '\n```')!
    expect(plan.speakers.map((s) => s.id)).toEqual(['oria', 'vex'])
    expect(plan.walk_ons).toEqual([])
    expect(plan.end_scene).toBe(false)
  })

  it('returns null for something that is not a plan', () => {
    expect(parsePlan('I would have Oria speak first.')).toBeNull()
    expect(parsePlan('{ broken')).toBeNull()
  })

  it('keeps the good entries of a list and drops malformed ones', () => {
    expect(parsePlan(JSON.stringify({ speakers: [{ id: 'vex', intent: 'x' }, 'nonsense', { intent: 'no id' }] }))!.speakers).toHaveLength(1)
  })
})

describe('validatePlan', () => {
  const state = barScene()

  it('resolves first names to ids and normalises skills and difficulty words', () => {
    const { plan, corrections } = validatePlan(content, state, raw({}))
    expect(plan.speakers.map((s) => s.id)).toEqual(['oria-senn', 'vex'])
    expect(plan.checks[0]).toMatchObject({ who: 'vex', skill: 'empathy', difficulty: 'moderate' })
    expect(corrections).toEqual([])
  })

  it('caps speakers at two and drops anyone not present', () => {
    const { plan, corrections } = validatePlan(content, state, raw({
      speakers: [{ id: 'vex', intent: '', mood: '' }, { id: 'brask', intent: '', mood: '' }, { id: 'oria', intent: '', mood: '' }, { id: 'ghost', intent: '', mood: '' }],
      reactions: [{ id: 'vex', beat: 'x' }, { id: 'oria', beat: 'smiles' }]
    }))
    expect(plan.speakers.map((s) => s.id)).toEqual(['vex', 'brask'])
    expect(plan.reactions.map((r) => r.id)).toEqual(['oria-senn'])
    expect(corrections.join('\n')).toMatch(/at most 2[\s\S]*ghost/)
  })

  it('drops checks with unknown skills, difficulties or people, and the dependencies on them', () => {
    const { plan } = validatePlan(content, state, raw({
      checks: [
        { id: 'a', who: 'vex', skill: 'mind reading', difficulty: 'moderate', stakes: '' },
        { id: 'b', who: 'vex', skill: 'empathy', difficulty: 'impossible', stakes: '' },
        { id: 'c', who: 'nobody', skill: 'empathy', difficulty: 'easy', stakes: '' },
        { id: 'd', who: 'Rook', skill: 'very_hard', difficulty: 'easy', stakes: '' },
        { id: 'e', who: 'player', skill: 'persuasion', difficulty: 'very_hard', stakes: 'Oria names the client' }
      ]
    }))
    expect(plan.checks).toEqual([expect.objectContaining({ id: 'e', who: 'player', skill: 'persuasion', difficulty: 'very hard' })])
    expect(plan.speakers.find((s) => s.id === 'vex')?.depends_on_check).toBeUndefined()
  })

  it('fills texture from the location card when the director gives none', () => {
    expect(validatePlan(content, state, raw({ texture: [] })).plan.texture).toHaveLength(2)
  })

  it('only keeps walk-ons who are here, by id, label or name', () => {
    const { plan } = validatePlan(content, state, raw({ walk_ons: [{ id: 'Dunmar', line: 'wipes the bar' }, { id: 'the bouncer', line: 'x' }] }))
    expect(plan.walk_ons).toEqual([{ id: 'bartender', line: 'wipes the bar' }])
  })
})

describe('resolvePlan', () => {
  it('rolls the plan’s checks with the game’s seeded dice and writes the results in', () => {
    const state = barScene(42)
    const { plan } = validatePlan(content, state, raw({}))
    const first = resolvePlan(content, state, plan)
    const again = resolvePlan(content, state, plan)
    expect(first).toEqual(again)
    expect(first.dice).not.toBe(state.dice)
    const check = first.plan.checks[0]!
    expect(check.result?.modifier).toBe(2)
    expect(check.result?.rank).toBe(1)
    expect(check.line).toMatch(/^Vex — Empathy \d+ vs 15: /)
  })

  it('gives an assist by the helper’s trust', () => {
    const state = barScene(3)
    const { plan } = validatePlan(content, state, raw({
      checks: [{ id: 'p', who: 'player', skill: 'streetwise', difficulty: 'hard', stakes: '', assist: 'vex' }]
    }))
    // Vex trusts the player 60 and has Streetwise 2: +2.
    expect(resolvePlan(content, state, plan).plan.checks[0]!.result?.bonus).toBe(2)
  })
})

describe('focus and fallback', () => {
  it('counts silence from the start of the scene, and has whoever the player named answer', () => {
    const state = barScene()
    expect(silence(state.scene!)).toEqual({ vex: 0, brask: 0, 'oria-senn': 0 })
    const plan = fallbackPlan(content, state, 'So, Oria, who is the client?')
    expect(plan.speakers.map((s) => s.id)).toEqual(['oria-senn'])
    expect(plan.reactions.map((r) => r.id).sort()).toEqual(['brask', 'vex'])
  })
})

describe('buildDirectorPrompt', () => {
  it('gives the director every present sheet, secrets included, and puts the player’s words last', () => {
    const { system, user } = buildDirectorPrompt(content, barScene(), 'Who is the client?')
    expect(system).toMatch(/client-is-grid-corporation/)
    expect(system).toMatch(/Oria Senn \[id: oria-senn\]/)
    expect(system).toMatch(/Dunmar/)
    expect(user.trim().endsWith('Return the JSON beat plan.')).toBe(true)
    expect(user).toMatch(/Who is the client\?/)
  })
})

describe('forced rolls (test bench)', () => {
  it('rolls the forced number for every check and leaves the dice where they were', () => {
    const state = barScene(42)
    const { plan } = validatePlan(content, state, raw({}))
    const caught = resolvePlan(content, state, plan, { forceNatural: 18 })
    expect(caught.plan.checks[0]!.result).toMatchObject({ natural: 18, degree: 'strong' })
    expect(caught.dice).toBe(state.dice)
    expect(resolvePlan(content, state, plan, { forceNatural: 3 }).plan.checks[0]!.result!.degree).toBe('failure')
  })
})
