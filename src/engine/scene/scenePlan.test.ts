import { describe, expect, it } from 'vitest'
import type { GameState } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { gatherScene } from './gather'
import { liveRecords, parseScenePlan, RawScenePlanSchema, validateScenePlan, type RawScenePlan } from './scenePlan'

// The `scene` pipeline's plan (Milestone 5 plan, task 1): the director sets the situation and what's at stake and
// plans no lines; the game checks it against what it gathered.

const raw = (over: Record<string, unknown> = {}): RawScenePlan => RawScenePlanSchema.parse({ focus: ['mara'], moments: [{ who: 'mara', lands: 'A fair question.', wants: 'to be accurate' }], ...over })
const check = (input: string, over: Record<string, unknown> = {}, state: GameState = yardScene()) => validateScenePlan(fixture, state, raw(over), gatherScene(fixture, state, input), input)

describe('reading the plan', () => {
  it('takes a focus and moments, leniently, and nothing from a reply without them', () => {
    const p = parseScenePlan('<think>hm</think>{"focus": "mara", "moments": [{"who": "mara", "lands": "x", "wants": "y"}], "pressures": "nonsense", "end_scene": "no"}')!
    expect(p.focus).toEqual(['mara'])
    expect(p.pressures).toEqual([])
    expect(p.end_scene).toBe(false)
    expect(parseScenePlan('{"moves": []}')).toBeNull()
    expect(parseScenePlan('No plan.')).toBeNull()
  })
})

describe('focus and moments', () => {
  it('keeps people present, at most three, and takes the focus from the moments when none is given', () => {
    expect(check('Evening.', { focus: ['mara', 'ghost', 'mara'] })).toMatchObject({ plan: { focus: ['mara'] }, corrections: ['dropped "ghost" from focus: not present'] })
    expect(check('Evening.', { focus: [], moments: [{ who: 'tobin', lands: 'a', wants: 'b' }] }).plan.focus).toEqual(['tobin'])
  })

  it('needs a moment for everyone in focus, and none for anyone else', () => {
    const { plan, corrections } = check('Evening.', { focus: ['mara', 'tobin'], moments: [{ who: 'mara', lands: 'a', wants: 'b' }, { who: 'kit', lands: 'c', wants: 'd' }] })
    expect(plan.moments.map((m) => m.who)).toEqual(['mara'])
    expect(corrections).toEqual(['dropped the moment for "kit": not in focus', 'tobin is in focus with no moment'])
  })

  it('checks and eases a feeling as the situation plan does, and keeps the lines to a situation in words', () => {
    const { plan, corrections } = check('Evening.', { moments: [{ who: 'mara', feels: { shade: 'nonsense', intensity: 3 }, lands: 'She says "go away" and means it.', wants: Array(40).fill('word').join(' ') }] })
    expect(plan.moments[0]!.feels).toBeUndefined()
    expect(plan.moments[0]!.wants.split(' ')).toHaveLength(30)
    expect(corrections).toEqual([expect.stringMatching(/^mara's feeling: .*; their feeling from before carries$/), "mara's moment quotes dialogue", 'what mara wants was 40 words; cut to 30'])
  })
})

describe('aim strength', () => {
  it('starts from the gathered strength and moves at most one step', () => {
    expect(check('Evening.', { moments: [{ who: 'mara', lands: 'a', wants: 'b', pressure: 'driven' }] })).toMatchObject({ plan: { strengths: { mara: 'keen', tobin: 'idle' } }, corrections: ["mara's pressure moved one step, to keen"] })
    expect(check('Evening.', { moments: [{ who: 'mara', lands: 'a', wants: 'b', pressure: 'frantic' }] }).corrections).toEqual(['mara: no pressure word "frantic"'])
  })
})

describe('pressures', () => {
  it('take a secret only when something just said touches it, with the game’s trigger', () => {
    const touched = check('Is there a second ledger?', { pressures: [{ who: 'mara', kind: 'secret', secret: 'mara.two-books', touched: 'ledger' }] })
    expect(touched.plan.pressures).toEqual([{ who: 'mara', kind: 'secret', ref: 'mara.two-books', text: expect.any(String), how: 'keyword', touched: 'second ledger' }])
    expect(touched.corrections).toEqual([])
    expect(check('Cold tonight.', { pressures: [{ who: 'mara', kind: 'secret', secret: 'mara.two-books' }] })).toMatchObject({ plan: { pressures: [] }, corrections: ['dropped mara\'s secret "mara.two-books": nothing just said touches it'] })
    // A quote the director made up doesn't stand in for what touched it.
    expect(check('Is there a second ledger?', { pressures: [{ who: 'mara', kind: 'secret', secret: 'mara.two-books', touched: 'the books' }] }).corrections).toEqual(['mara\'s secret: "the books" isn\'t in what was just said; "second ledger" touched it'])
  })

  it('take a tie in play, by id or name', () => {
    expect(check('Evening.', { pressures: [{ who: 'mara', kind: 'tie', with: 'Tobin' }] }).plan.pressures).toEqual([{ who: 'mara', kind: 'tie', ref: 'tobin', text: 'rival; has known him since the guild took him on', how: 'present' }])
    expect(check('Evening.', { pressures: [{ who: 'mara', kind: 'tie', with: 'player' }] }).corrections).toEqual(['dropped mara\'s tie to "player": not in play'])
  })

  it('take an aim only above the weakest word: a background aim shapes choices, never the topic', () => {
    expect(check('Evening.', { pressures: [{ who: 'mara', kind: 'goal' }] }).corrections).toEqual(["dropped mara's aim as a pressure: at idle it shapes their choices, never the topic"])
    const keen = check('Evening.', { moments: [{ who: 'mara', lands: 'a', wants: 'b', pressure: 'keen' }], pressures: [{ who: 'mara', kind: 'goal' }] })
    expect(keen.plan.pressures).toEqual([{ who: 'mara', kind: 'goal', ref: 'mara', text: 'Find out who keeps skimming the tallies', strength: 'keen' }])
  })

  it('are at most one each, for people in focus, of a known kind', () => {
    const { plan, corrections } = check('Is there a second ledger?', {
      pressures: [
        { who: 'mara', kind: 'tie', with: 'tobin' },
        { who: 'mara', kind: 'secret', secret: 'mara.two-books' },
        { who: 'tobin', kind: 'tie', with: 'player' },
        { who: 'mara', kind: 'mood' }
      ]
    })
    expect(plan.pressures.map((p) => p.kind)).toEqual(['tie'])
    expect(corrections).toEqual(['dropped a second pressure for mara: at most one', 'dropped a pressure for "tobin": not in focus', 'dropped a second pressure for mara: at most one'])
    expect(liveRecords(plan)).toEqual([{ who: 'mara', kind: 'tie', ref: 'tobin' }])
  })
})

describe('facts drawn on', () => {
  it('come only from the character’s pool', () => {
    const { plan, corrections } = check('Who was in the yard after closing?', { draws_on: [{ who: 'mara', facts: ['[mara.k1]', 'mara.k1', 'tobin.after-closing'] }] })
    expect(plan.pools['mara']!.map((f) => f.id)).toEqual(['mara.k1'])
    expect(corrections).toEqual(['mara can\'t draw on "tobin.after-closing": not in their pool'])
  })
})

describe('checks, walk-ons and departures', () => {
  it('are checked as in the situation plan: a player check only for an uncertain attempt', () => {
    const plain = check('Evening.', { checks: [{ id: 'c1', who: 'player', skill: 'notice', difficulty: 'routine', stakes: 'x' }] })
    expect(plain).toMatchObject({ plan: { checks: [] }, corrections: ['dropped the player check: the player action is not an uncertain attempt'] })
    const trying = check('I climb the crates.', { player_action: { doing: 'climbs the crates', uncertain: true }, checks: [{ id: 'c1', who: 'player', skill: 'notice', difficulty: 'routine', stakes: 'x' }], leaves: ['tobin', 'ghost'] })
    expect(trying.plan.checks.map((c) => c.id)).toEqual(['c1'])
    expect(trying.plan.leaves).toEqual(['tobin'])
    expect(trying.corrections).toEqual(['ignored departure of "ghost": not present'])
  })
})
