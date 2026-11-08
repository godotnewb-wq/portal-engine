import { describe, expect, it } from 'vitest'
import type { CheckResult } from '@engine/rules'
import type { GameState, Turn } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { parseReply } from './beats'
import type { BeatPlan } from './plan'
import { parsePlan2, settlePlan2, validatePlan2 } from './plan2'
import { recentlyUsed, repeatProblems, usageOf } from './repeats'
import { applyTurn } from './turn'
import { sceneSpeakers } from './writer'
import { buildWriter2Prompt } from './writer2'

// Redesign step 2 (claude/scene-system-redesign.md §5): what is live each turn, and how strongly.
const ASK = 'Tobin, who came by?'
const plan = (speakers: object[], over: object = {}) =>
  parsePlan2(
    JSON.stringify({
      player_action: { doing: 'asks Tobin who came by', uncertain: false },
      speakers,
      moves: [
        { who: 'tobin', answers: 'player', move: 'dodge', uses: [] },
        { who: 'mara', answers: 1, move: 'push back', uses: ['mara.k1'] }
      ],
      ...over
    })
  )!
const tobin = (over: object = {}) => ({ id: 'tobin', goal: 'get it dropped', mood: 'uneasy', keeps: ['tobin.after-closing'], touched: 'who came by', approach: 'deflect', ...over })
const mara = (over: object = {}) => ({ id: 'mara', goal: 'catch him out', mood: 'sharp', ...over })
const rolled = (degree: CheckResult['degree']) => ({ degree, natural: 10, total: 10, dc: 10 }) as CheckResult
const withScene = (state: GameState, over: Partial<NonNullable<GameState['scene']>>): GameState => ({ ...state, scene: { ...state.scene!, ...over } })

describe('secrets are live only when something just said touches them', () => {
  it('keeps a secret when its trigger is in the player’s words', () => {
    const { plan: p, corrections } = validatePlan2(fixture, yardScene(), plan([tobin(), mara()]), ASK)
    expect(p.speakers[0]).toMatchObject({ kept: ['tobin.after-closing'], approach: 'deflect' })
    expect(corrections).toEqual([])
  })

  it('drops it when nothing said touches it, or when no trigger is named', () => {
    const elsewhere = validatePlan2(fixture, yardScene(), plan([tobin({ touched: 'the broken cart' }), mara()]), 'Nice evening.')
    expect(elsewhere.plan.speakers[0]!.hiding).toBeUndefined()
    expect(elsewhere.corrections).toContain('tobin\'s secret isn\'t in play: "the broken cart" isn\'t in what was just said')
    const unnamed = validatePlan2(fixture, yardScene(), plan([tobin({ touched: '' }), mara()]), ASK)
    expect(unnamed.plan.speakers[0]!.hiding).toBeUndefined()
    expect(unnamed.corrections).toContain("tobin's secret isn't in play: nothing named touches it")
  })

  it('only lets a character keep their own secrets', () => {
    const { plan: p, corrections } = validatePlan2(fixture, yardScene(), plan([tobin({ keeps: ['mara.two-books'] }), mara()]), ASK)
    expect(p.speakers[0]!.hiding).toBeUndefined()
    expect(corrections).toContain("tobin keeps something that isn't one of their secrets")
  })
})

describe('an aim’s pressure', () => {
  it('moves at most one step a turn, and only presses into the writer’s brief above the weakest word', () => {
    const state = withScene(yardScene(), { pressures: { tobin: 0 } })
    const { plan: p, corrections } = validatePlan2(fixture, state, plan([tobin({ pressure: 'driven', keeps: [] }), mara({ pressure: 'idle' })]), ASK)
    expect(p.speakers.map((s) => s.pressure)).toEqual(['keen', 'idle'])
    expect(corrections).toContain("tobin's pressure moved one step, to keen")
    const brief = buildWriter2Prompt(fixture, state, p, ASK).user
    expect(brief).toMatch(/- Tobin: in this exchange, get it dropped\. Mood: uneasy\. Tonight's aim is on their mind and may come up if it fits: Keep anyone from asking about last night\./)
    expect(brief).toMatch(/- Mara: in this exchange, catch him out\. Mood: sharp\.\n/)
    const next = applyTurn(fixture, state, { id: 't1', input: ASK, plan: p, beats: [], tags: parseReply('', []).tags, dice: state.dice })
    expect(next.scene!.pressures).toEqual({ tobin: 1, mara: 0 })
  })

  it('names an unknown word and keeps the last level', () => {
    const { plan: p, corrections } = validatePlan2(fixture, withScene(yardScene(), { pressures: { mara: 2 } }), plan([mara({ pressure: 'frantic' })], { moves: [] }), ASK)
    expect(p.speakers[0]!.pressure).toBe('driven')
    expect(corrections).toContain('mara: no pressure word "frantic"')
  })
})

describe('seeing through a secret takes the roll (criterion 5)', () => {
  const caught = (state: GameState, degree: CheckResult['degree']): BeatPlan => {
    const raw = plan([tobin(), mara()], {
      checks: [{ id: 'read', who: 'mara', skill: 'notice', difficulty: 'tough', stakes: 'sees Tobin is hiding something' }],
      moves: [
        { who: 'tobin', answers: 'player', move: 'dodge', uses: [] },
        { who: 'mara', answers: 1, move: 'push back', uses: [], new: ['he is hiding something'], needs: 'read' },
        { who: 'tobin', answers: 2, move: 'refuse', uses: [] }
      ]
    })
    const { plan: p } = validatePlan2(fixture, state, raw, ASK)
    return settlePlan2(fixture, state, { ...p, checks: p.checks.map((c) => ({ ...c, result: rolled(degree) })) })
  }

  it('drops the move that needs a failed check, and its reply answers what it answered', () => {
    const failed = caught(yardScene(), 'failure')
    expect(failed.moves!.map((m) => [m.who, m.answers])).toEqual([['tobin', 'player'], ['tobin', 1]])
    const passed = caught(yardScene(), 'success')
    expect(passed.moves!.map((m) => [m.who, m.answers, m.needs])).toEqual([['tobin', 'player', undefined], ['mara', 1, 'read'], ['tobin', 2, undefined]])
    expect(buildWriter2Prompt(fixture, yardScene(), passed, ASK).user).toMatch(/2\. Mara, answering 1 \(Tobin\): push back \(may draw on: he is hiding something \[new to the player\]\) \(the check succeeded\)/)
  })

  it('shows a kept secret’s tell the first time, then again only when someone else’s check succeeds', () => {
    const state = yardScene()
    const { plan: first } = validatePlan2(fixture, state, plan([tobin(), mara()]), ASK)
    const settled = settlePlan2(fixture, state, first)
    expect(settled.speakers[0]!.tell).toBe('Hums')
    const after = applyTurn(fixture, state, { id: 't1', input: ASK, plan: settled, beats: [], tags: parseReply('', []).tags, dice: state.dice })
    expect(after.scene!.tells).toEqual(['tobin.after-closing'])
    const { plan: again } = validatePlan2(fixture, after, plan([tobin(), mara()]), ASK)
    expect(settlePlan2(fixture, after, again).speakers[0]!.tell).toBeUndefined()
    expect(buildWriter2Prompt(fixture, after, settlePlan2(fixture, after, again), ASK).user).toMatch(/Keeping to themselves: Tobin let someone into the yard after closing\. \(deflect\)\. It doesn't show\./)
    expect(caught(after, 'success').speakers[0]!.tell).toBe('Hums')
  })
})

describe('the repetition tracker', () => {
  const turn = (beats: Turn['beats']): Turn => ({ id: 'old', player: 'Hm.', beats, checks: [], speakers: [], texture: [] })
  const lately = withScene(yardScene(), {
    turns: [turn([{ kind: 'dialogue', speaker: 'mara', text: 'We do this by the book.' }, { kind: 'narration', text: 'Tobin polishes his plates with a rag.' }])]
  })

  it('lists what each character used in the last turns, and gives it to the writer', () => {
    expect(recentlyUsed(fixture, lately.scene!)).toEqual({ mara: { slang: ['by the book'], gestures: [] }, tobin: { slang: [], gestures: ['polishes his plates with a rag'] } })
    const { plan: p } = validatePlan2(fixture, lately, plan([tobin({ keeps: [] }), mara()]), ASK)
    expect(buildWriter2Prompt(fixture, lately, p, ASK).user).toMatch(/# Used in the last turns \(don't repeat\)\n- Mara: "by the book"\n- Tobin: polishes his plates with a rag/)
  })

  it('lets one repeat through and sends two or more back', () => {
    const speakers = sceneSpeakers(fixture, lately)
    const recent = recentlyUsed(fixture, lately.scene!)
    const once = parseReply('Mara: "By the book, then."\nNARRATION: The lamp hisses.', speakers)
    expect(repeatProblems(fixture, once, recent)).toEqual([])
    const twice = parseReply('Mara: "By the book, then."\nNARRATION: Tobin polishes his plates again.', speakers)
    expect(repeatProblems(fixture, twice, recent).map((p) => [p.kind, p.beat, p.text])).toEqual([['repeated', 1, 'by the book'], ['repeated', 2, 'Tobin polishes his plates again']])
  })

  it('counts slang, aim words and gestures for the metrics', () => {
    const usage = usageOf(fixture, [
      { kind: 'dialogue', speaker: 'mara', text: 'By the book. Who keeps skimming the tallies?' },
      { kind: 'dialogue', speaker: 'tobin', text: 'I could not say, miss.' },
      { kind: 'narration', text: 'Tobin polishes his plates.' }
    ])
    expect(usage).toEqual({
      slang: [{ beat: 1, speaker: 'mara', terms: ['by the book'] }],
      aim: [{ beat: 1, speaker: 'mara' }],
      gestures: [{ beat: 3, who: 'tobin', gesture: 'polishes his plates' }]
    })
  })
})
