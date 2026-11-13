import { describe, expect, it } from 'vitest'
import { buildDirectorPrompt } from '@engine/scene'
import { fallbackPlan, parsePlan, silence, validatePlan, type RawPlan } from '@engine/scene'
import { resolvePlan } from '@engine/scene'
import { barScene, content } from './support'

/** The worked example's turn 1 plan (director writer §11). */
const WORKED = JSON.stringify({
  speakers: [
    { id: 'oria', goal: "Deflect. Claim a 'private collector'.", mood: 'composed', keeps: ['oria-senn.client-is-grid-corporation'], touched: 'the client', approach: 'lie' },
    { id: 'vex', goal: 'Call out the evasion if she catches it.', mood: 'wary' }
  ],
  moves: [
    { who: 'oria', answers: 'player', move: 'dodge' },
    { who: 'vex', answers: 1, move: 'push back', needs: 'vex_empathy' }
  ],
  reactions: [{ id: 'brask', beat: 'fidgets with his glass' }],
  checks: [{ id: 'vex_empathy', who: 'vex', skill: 'Empathy', difficulty: 'moderate', stakes: 'notices Oria is lying' }],
  texture: ['condensation dripping from an Aether-cooled pipe overhead'],
  avoid: ['eyes narrowed']
})
const ASKED = 'Who is the client?'

const raw = (patch: Partial<RawPlan>): RawPlan => ({ ...parsePlan(WORKED)!, ...patch })
/** A speaker with only an id, the rest left as the director might: empty. */
const speaker = (id: string): RawPlan['speakers'][number] => ({ id, goal: '', mood: '', pressure: '', keeps: [], touched: '' })
/** An attempt in doubt, so a player check stands. */
const attempt = { player_action: { doing: 'presses Oria', uncertain: true } }

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
    const { plan, corrections } = validatePlan(content, state, raw({}), ASKED)
    expect(plan.speakers.map((s) => s.id)).toEqual(['oria-senn', 'vex'])
    expect(plan.checks[0]).toMatchObject({ who: 'vex', skill: 'empathy', difficulty: 'moderate' })
    expect(corrections).toEqual([])
  })

  it('takes up to three speakers and drops anyone not present', () => {
    const { plan, corrections } = validatePlan(content, state, raw({
      speakers: [speaker('vex'), speaker('brask'), speaker('oria'), speaker('ghost')],
      reactions: [{ id: 'vex', beat: 'x' }, { id: 'oria', beat: 'smiles' }]
    }))
    expect(plan.speakers.map((s) => s.id)).toEqual(['vex', 'brask', 'oria-senn'])
    expect(plan.reactions).toEqual([])
    expect(corrections.join('\n')).toMatch(/ghost/)
  })

  it('drops checks with unknown skills, difficulties or people', () => {
    const { plan } = validatePlan(content, state, raw({
      ...attempt,
      checks: [
        { id: 'a', who: 'vex', skill: 'mind reading', difficulty: 'moderate', stakes: '' },
        { id: 'b', who: 'vex', skill: 'empathy', difficulty: 'impossible', stakes: '' },
        { id: 'c', who: 'nobody', skill: 'empathy', difficulty: 'easy', stakes: '' },
        { id: 'd', who: 'Rook', skill: 'very_hard', difficulty: 'easy', stakes: '' },
        { id: 'e', who: 'player', skill: 'persuasion', difficulty: 'very_hard', stakes: 'Oria names the client' }
      ]
    }))
    expect(plan.checks).toEqual([expect.objectContaining({ id: 'e', who: 'player', skill: 'persuasion', difficulty: 'very hard' })])
  })

  it('fills texture from the location card when the director gives none', () => {
    expect(validatePlan(content, state, raw({ texture: [] })).plan.texture).toHaveLength(1)
  })

  it('only keeps walk-ons who are here, by id, label or name', () => {
    const { plan } = validatePlan(content, state, raw({ walk_ons: [{ id: 'Hollis', line: 'slaps down a hand' }, { id: 'the bouncer', line: 'x' }] }))
    expect(plan.walk_ons).toEqual([{ id: 'card-player', line: 'slaps down a hand' }])
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
    expect(check.result?.rank).toBe(2)
    expect(check.line).toMatch(/^Vex — Empathy \d+ vs 15: /)
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
    expect(user.trim().endsWith('Return the JSON plan.')).toBe(true)
    expect(user).toMatch(/Who is the client\?/)
  })
})

describe('quiet characters (round 0 F3)', () => {
  // Session 2026-11-06_1757_9630: Oria and Vex spoke every turn; Brask never did.
  const played = (turns: number) => {
    const state = barScene()
    const turn = { player: 'Go on.', beats: [{ kind: 'dialogue', speaker: 'vex', text: 'Fine.' }], speakers: ['oria-senn', 'vex'], texture: [], checks: [] }
    state.scene!.turns = Array.from({ length: turns }, () => structuredClone(turn)) as never
    return state
  }

  it('shows the director what a character quiet for two turns cares about, and asks rather than orders', () => {
    expect(buildDirectorPrompt(content, played(1), 'Why are we here?').user).not.toMatch(/# Quiet for a while/)
    const { system, user } = buildDirectorPrompt(content, played(2), 'Why are we here?')
    const section = user.split('# Quiet for a while\n')[1]!.split('\n\n')[0]!
    expect(section).toMatch(/^- Brask \[id: brask\], silent 2 turns\. Trade: Freelance mechanic who keeps half the Low Turns' pumps/)
    expect(section).toMatch(/Tonight: Get out of this noisy room as soon as he decently can; but if the job on the table is down at Pump Station Nine/)
    expect(section.split('\n')).toHaveLength(1)
    expect(system).toMatch(/Quiet characters are listed with what they care about: if the conversation touches it, they have something to say\./)
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
