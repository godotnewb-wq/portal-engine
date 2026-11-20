import { describe, expect, it } from 'vitest'
import { readFeeling, type Feeling } from '@engine/characters'
import type { CheckResult } from '@engine/rules'
import type { GameState } from '@engine/state'
import { characterById, type Pack } from '@engine/pack'
import { fixture, yardScene } from '@tests/fixture'
import { parseReply } from './beats'
import { audienceOf, watchingWalkOns, readingDifficulty, shown } from './feelings'
import { parsePlan, settlePlan, validatePlan } from './plan'
import { applyTurn } from './turn'
import { buildWriterPrompt, sceneSpeakers } from './writer'

// Milestone 4b, task 2: felt vs. shown (npc design §7; decided 2026-11-13).
const R = fixture.ruleset
const withScene = (state: GameState, over: Partial<NonNullable<GameState['scene']>>): GameState => ({ ...state, scene: { ...state.scene!, ...over } })
/** The yard with nobody but Mara, Tobin and the player: the clerk (a walk-on, so a stranger) sent home. */
const quiet = (state = yardScene()) => withScene(state, { walkOns: [] })
const felt = (shade: string, intensity: number, family?: string): Feeling => {
  const read = readFeeling(R, { shade, intensity, family })
  if (!('feeling' in read)) throw new Error(read.problem)
  return read.feeling
}

describe('reading a feeling', () => {
  it('files a shade under its family and keeps the intensity, marking one outside the usual range', () => {
    expect(readFeeling(R, { shade: 'Glum', intensity: 2, reason: 'the rain' })).toEqual({ feeling: { shade: 'glum', family: 'sad', intensity: 2, reason: 'the rain' } })
    expect(readFeeling(R, { shade: 'livid', intensity: 2 })).toEqual({ feeling: { shade: 'livid', family: 'mad', intensity: 2, atypical: true } })
    expect(readFeeling(R, { shade: 'sore', family: 'Mad', intensity: '3' })).toMatchObject({ feeling: { family: 'mad', intensity: 3 } })
  })

  it('refuses a shade not on the list, a family it isn’t under, a missing family where it has several, and an intensity off 1–5', () => {
    expect(readFeeling(R, { shade: 'happy', intensity: 2 })).toEqual({ problem: '"happy" isn\'t a shade' })
    expect(readFeeling(R, { shade: 'livid', family: 'sad', intensity: 4 })).toEqual({ problem: '"livid" isn\'t listed under "sad"' })
    expect(readFeeling(R, { shade: 'sore', intensity: 3 })).toEqual({ problem: '"sore" needs its family: sad or mad' })
    expect(readFeeling(R, { shade: 'glum', intensity: 6 })).toEqual({ problem: '"glum" needs an intensity from 1 to 5' })
  })
})

describe('who is watching', () => {
  it('is guarded with a stranger, a walk-on or someone they hold a guarded tag toward', () => {
    expect(audienceOf(fixture, yardScene(), 'mara', { walk_ons: [{ id: 'clerk', line: 'Names in the book.' }] })).toEqual({ value: -1, why: 'walk-ons present; guarded toward Tobin' })
    expect(audienceOf(fixture, quiet(), 'tobin')).toEqual({ value: -1, why: 'Mara is a stranger' })
    const tied = { ...quiet(), playerTies: { ...quiet().playerTies, tobin: { tags: [{ tag: 'foe' }] } } }
    const known = { ...tied, relations: [...tied.relations, { from: 'tobin', to: 'mara', tags: [], meters: { warmth: 0, bond: 0 } }] }
    expect(audienceOf(fixture, known, 'tobin')).toEqual({ value: -1, why: 'guarded toward the player' })
  })

  it('counts a walk-on as watching only once they are on screen: brought in this turn, or with a line before', () => {
    const scene = yardScene().scene!
    expect(watchingWalkOns(scene)).toEqual([])
    expect(watchingWalkOns(scene, { walk_ons: [{ id: 'clerk', line: 'Names in the book.' }] })).toEqual(['clerk'])
    const spoke = { ...scene, turns: [{ id: 't1', player: 'Hello.', beats: [{ kind: 'dialogue' as const, speaker: 'clerk', text: 'Name?' }], checks: [], speakers: [], texture: [] }] }
    expect(watchingWalkOns(spoke)).toEqual(['clerk'])
    // Only someone in the room counts, however the turn named them.
    expect(watchingWalkOns(scene, { walk_ons: [{ id: 'stranger', line: '' }] })).toEqual([])
  })

  it('is guarded with a member of a faction whose stance toward theirs is among the coldest', () => {
    const watchman: Pack = { ...fixture, characters: fixture.characters.map((c) => (c.id === 'tobin' ? { ...c, faction: 'watch' } : c)) }
    const state = quiet()
    const untagged = { ...state, relations: state.relations.map((x) => (x.from === 'mara' ? { ...x, tags: [] } : x)) }
    expect(audienceOf(watchman, untagged, 'mara')).toEqual({ value: -1, why: "Tobin's faction is hostile" })
  })

  it('is trusted only when everyone present, the player included, is above the trust line', () => {
    const state = quiet()
    const close = { ...state, relations: [...state.relations, { from: 'tobin', to: 'mara', tags: [], meters: { warmth: 0, bond: 5 } }] }
    expect(audienceOf(fixture, { ...close, meters: { ...close.meters, tobin: { warmth: 0, bond: 5 } } }, 'tobin')).toEqual({ value: 1, why: 'only people they trust' })
    // At the line is not above it.
    expect(audienceOf(fixture, { ...close, meters: { ...close.meters, tobin: { warmth: 0, bond: 4 } } }, 'tobin')).toEqual({ value: 0, why: '' })
  })
})

describe('how much shows', () => {
  it('is intensity − masking + audience, with the shade’s display line over the family’s, and none when hidden', () => {
    // Mara: thin masking for anger on her card, guarded in the yard: 4 − 1 − 1 = 2.
    expect(shown(fixture, yardScene(), 'mara', felt('livid', 4))).toMatchObject({ masking: 'thin', visibility: 2, band: 'plain', display: 'goes very quiet' })
    // Her Composure-stage default (closed: thick) for everything else: 3 − 2 − 1 = 0.
    expect(shown(fixture, yardScene(), 'mara', felt('glum', 3))).toMatchObject({ masking: 'thick', visibility: 0, band: 'hidden' })
    expect(shown(fixture, yardScene(), 'mara', felt('glum', 3))!.display).toBeUndefined()
    // Tobin's card leaves the axis out, so its middle stage (thin) applies: 3 − 1 − 1 = 1.
    expect(shown(fixture, yardScene(), 'tobin', felt('sore', 3, 'mad'))).toMatchObject({ masking: 'thin', visibility: 1, band: 'leaking', display: 'slams the gate' })
  })
})

describe('reading through the mask', () => {
  it('takes the game’s difficulty from the target’s masking, a step harder for the axis stages the ruleset names', () => {
    const mara = characterById(fixture, 'mara')!
    const tobin = characterById(fixture, 'tobin')!
    expect(readingDifficulty(R, tobin, felt('glum', 2))).toBe('tough')
    // Mara is closed: thin anger reads as tough, one step harder: grim. Thick grief is grim already, and stays there.
    expect(readingDifficulty(R, mara, felt('livid', 4))).toBe('grim')
    expect(readingDifficulty(R, mara, felt('glum', 2))).toBe('grim')
  })

  const ASK = 'Tobin, who came by?'
  const reading = (checks: object[], over: object = {}) =>
    parsePlan(
      JSON.stringify({
        player_action: { doing: 'asks Tobin who came by', uncertain: true },
        speakers: [{ id: 'tobin', goal: 'get it dropped', feels: { shade: 'sore', family: 'mad', intensity: 4, reason: 'she keeps asking' } }],
        moves: [{ who: 'tobin', answers: 'player', move: 'dodge' }],
        reactions: [{ id: 'mara', beat: 'watches him', feels: { shade: 'glum', intensity: 2 } }],
        checks,
        ...over
      })
    )!

  it('names who is read, sets the difficulty, and refuses a reader reading themselves or someone not here', () => {
    const { plan, corrections } = validatePlan(fixture, yardScene(), reading([
      { id: 'look', who: 'mara', skill: 'notice', difficulty: 'routine', target: 'Tobin', stakes: 'sees what he feels' },
      { id: 'self', who: 'tobin', skill: 'notice', difficulty: 'routine', target: 'tobin', stakes: 'x' }
    ]), ASK)
    expect(plan.checks.map((c) => [c.id, c.target, c.difficulty])).toEqual([['look', 'tobin', 'tough'], ['self', undefined, 'routine']])
    expect(corrections).toContain('check "look": reading tobin is tough, not routine, by their masking')
    expect(corrections).toContain("check \"self\": tobin can't read themselves; it has no target")
    const away = validatePlan(fixture, yardScene(), reading([{ id: 'look', who: 'mara', skill: 'notice', difficulty: 'routine', target: 'Pell', stakes: 'x' }]), ASK)
    expect(away.corrections).toContain('check "look": "Pell" can\'t be read here; it has no target')
    // Another skill aimed at someone keeps the director's word.
    const fight = validatePlan(fixture, yardScene(), reading([{ id: 'shove', who: 'mara', skill: 'fight', difficulty: 'routine', target: 'tobin', stakes: 'x' }]), ASK)
    expect(fight.plan.checks[0]).toMatchObject({ target: 'tobin', difficulty: 'routine' })
  })

  // Found by the end-of-Milestone-4 bench: reading checks were dropped by the rule that the player rolls only on an attempt.
  it('keeps the player’s reading check while the mask hides something, even when the player is only talking', () => {
    const talking = { player_action: { doing: 'asks Tobin who came by', uncertain: false } }
    const look = { id: 'look', who: 'player', skill: 'notice', difficulty: 'routine', target: 'tobin', stakes: 'sees what he feels' }
    const sore = shown(fixture, yardScene(), 'tobin', felt('sore', 4, 'mad'))!
    expect(sore.visibility).toBeLessThan(4)
    const kept = validatePlan(fixture, yardScene(), reading([look], talking), ASK)
    expect(kept.plan.checks.map((c) => c.id)).toEqual(['look'])
    expect(kept.corrections).not.toContain('dropped the player check: the player action is not an uncertain attempt')
    // Not a reading check: dropped as before.
    const notice = validatePlan(fixture, yardScene(), reading([{ ...look, target: undefined }], talking), ASK)
    expect(notice.plan.checks).toEqual([])
    expect(notice.corrections).toContain('dropped the player check: the player action is not an uncertain attempt')
  })

  const rolled = (degree: CheckResult['degree']) => ({ degree, natural: 10, total: 10, dc: 10 }) as CheckResult
  const settled = (who: string, degree: CheckResult['degree'], state = yardScene()) => {
    const { plan } = validatePlan(fixture, state, reading([{ id: 'look', who, skill: 'notice', difficulty: 'routine', target: 'tobin', stakes: 'sees what he feels' }]), ASK)
    return settlePlan(fixture, state, { ...plan, checks: plan.checks.map((c) => ({ ...c, result: rolled(degree) })) })
  }

  it('lets a success see through to what the target feels: the writer is told, and the turn keeps it for the reader’s memory', () => {
    const plan = settled('mara', 'success')
    expect(plan.reads).toEqual([{ by: 'mara', target: 'tobin', feeling: { shade: 'sore', family: 'mad', intensity: 4, reason: 'she keeps asking' } }])
    const brief = buildWriterPrompt(fixture, yardScene(), plan, ASK).user
    expect(brief).toContain('- Tobin: in this exchange, get it dropped. Feels sore (mad): she keeps asking. It is plain to see: slams the gate. Mara sees through to it and may say so.')
    expect(buildWriterPrompt(fixture, yardScene(), settled('player', 'success'), ASK).user).toContain('You see through to it.')
    const next = applyTurn(fixture, yardScene(), { id: 't1', input: ASK, plan, beats: [], tags: parseReply('', []).tags, dice: 1 })
    expect(next.scene!.turns[0]!.reads).toEqual(plan.reads)
    expect(settled('mara', 'failure').reads).toBeUndefined()
  })

  it('makes the plan’s feels the new moods, for speakers and reactions alike, and leaves everyone else’s', () => {
    const state = yardScene()
    const plan = settled('mara', 'failure', state)
    const next = applyTurn(fixture, state, { id: 't1', input: ASK, plan, beats: [], tags: parseReply('', []).tags, dice: 1 })
    expect(next.scene!.moods['tobin']).toEqual({ shade: 'sore', family: 'mad', intensity: 4, reason: 'she keeps asking' })
    expect(next.scene!.moods['mara']).toEqual({ shade: 'glum', family: 'sad', intensity: 2 })
    const silent = applyTurn(fixture, state, { id: 't1', input: ASK, plan: { ...plan, speakers: [{ id: 'tobin', intent: 'x' }], reactions: [] }, beats: [], tags: parseReply('', []).tags, dice: 1 })
    expect(silent.scene!.moods).toEqual(state.scene!.moods)
  })

  it('lets a feeling ease at most one step a turn within its family; a new family or a rise is free (decided 2026-11-16)', () => {
    const state = withScene(yardScene(), { moods: { ...yardScene().scene!.moods, tobin: felt('sore', 5, 'mad') } })
    const plan = (feels: object) => validatePlan(fixture, state, reading([], { speakers: [{ id: 'tobin', goal: 'x', feels }] }), ASK)
    const eased = plan({ shade: 'sore', family: 'mad', intensity: 2 })
    expect(eased.plan.speakers[0]!.feels!.intensity).toBe(4)
    expect(eased.corrections).toContain('tobin\'s mad eases at most 1 a turn: 4, not 2')
    expect(plan({ shade: 'sore', family: 'mad', intensity: 4 }).plan.speakers[0]!.feels!.intensity).toBe(4)
    expect(plan({ shade: 'glum', family: 'sad', intensity: 1 }).plan.speakers[0]!.feels!.intensity).toBe(1)
  })

  it('refuses a feeling not in the ruleset with a correction, and the one from before carries', () => {
    const { plan, corrections } = validatePlan(fixture, yardScene(), reading([], { speakers: [{ id: 'tobin', goal: 'x', feels: { shade: 'livid', family: 'sad', intensity: 4 } }] }), ASK)
    expect(plan.speakers[0]!.feels).toBeUndefined()
    expect(corrections).toContain('tobin\'s feeling: "livid" isn\'t listed under "sad"; their feeling from before carries')
  })

  it('no longer reads the writer’s MOOD tag', () => {
    const parsed = parseReply('Tobin: "Nobody."\n[Tobin: MOOD rattled]', sceneSpeakers(fixture, yardScene()))
    expect(parsed.droppedTags).toEqual(['[Tobin: MOOD rattled]'])
  })
})
