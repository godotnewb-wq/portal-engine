import { describe, expect, it } from 'vitest'
import { dayOf, MINUTES_PER_DAY, startScene, type Aftermath, type GameState } from '@engine/state'
import { buildBriefs } from '@engine/scene'
import { fixture, yardScene } from '@tests/fixture'
import { dailyUpkeep, nextDay } from './aftermath'
import { applySummaries, buildSummaryPrompt, parseSummary, plainSummary, type Summary } from './summary'

// Milestone 4b, task 3: mood and aftermath across scenes (npc design §7; decided 2026-11-13).
const R = fixture.ruleset
const DAY = MINUTES_PER_DAY
const summary = (state: GameState, id: string, over: Partial<Summary> = {}): { id: string; summary: Summary } => ({ id, summary: { ...plainSummary(fixture, state, id), level: 'normal', ...over } })
const end = (state: GameState, ...s: { id: string; summary: Summary }[]) => applySummaries(fixture, state, s)
const later = (state: GameState, days: number): GameState => ({ ...state, time: state.time + days * DAY })
const carried = (owner: string, over: Partial<Aftermath> = {}, state = yardScene()): Aftermath => ({
  owner, shade: 'glum', family: 'sad', intensity: 3, reason: 'rain all week', since: state.time, scene: 'before', fadedOn: dayOf(R, state.time), ...over
})

describe('what a summary leaves a witness carrying', () => {
  it('reads feels, toward and resolved from the reply', () => {
    const s = parseSummary(R, JSON.stringify({ memory: 'x', feels: { shade: 'glum', intensity: 2 }, toward: [{ who: 'tobin', shade: 'livid', intensity: 4 }, 'nonsense'], resolved: ['player', 3] }))
    expect(s).toMatchObject({ feels: { shade: 'glum', intensity: 2 }, toward: [{ who: 'tobin', shade: 'livid', intensity: 4 }], resolved: ['player'] })
  })

  it('makes a feeling toward someone, with who by id, name or the player, and marks everyone there as having seen the player', () => {
    const state = yardScene()
    const { state: next, reports } = end(state, summary(state, 'mara', { toward: [{ who: 'Tobin', shade: 'livid', intensity: 4, reason: 'he lied' }, { who: 'Kit', shade: 'glum', intensity: 2 }] }), summary(state, 'tobin'))
    expect(next.aftermath).toEqual([
      { owner: 'mara', toward: 'tobin', shade: 'livid', family: 'mad', intensity: 4, reason: 'he lied', since: state.time, scene: state.scene!.id, fadedOn: dayOf(R, state.time) },
      { owner: 'mara', toward: 'player', shade: 'glum', family: 'sad', intensity: 2, reason: '', since: state.time, scene: state.scene!.id, fadedOn: dayOf(R, state.time) }
    ])
    expect(next.lastSeen).toEqual({ mara: state.time, tobin: state.time })
    expect(reports[0]!.carried!.toward.map((t) => t.toward)).toEqual(['tobin', 'player'])
  })

  it('refuses a feeling toward themselves or nobody, a shade not listed, and surprise, which is felt in the moment only', () => {
    const state = yardScene()
    const { state: next, reports } = end(state, summary(state, 'mara', { toward: [{ who: 'mara', shade: 'glum', intensity: 2 }, { who: 'tobin', shade: 'happy', intensity: 2 }, { who: 'tobin', shade: 'jolted', intensity: 2 }], feels: { shade: 'jolted', intensity: 2 } }))
    expect(next.aftermath).toEqual([])
    expect(reports[0]!.carried!.dropped).toEqual(['toward "mara": not someone they could feel toward', 'toward tobin: "happy" isn\'t a shade', 'toward tobin: "jolted" is felt in the moment only', 'feels: "jolted" is felt in the moment only'])
  })

  it('carries a strong feeling, or any with a Core memory, as aftermath; a mild one passes; their mood stands in when the summary gives none', () => {
    const state = yardScene()
    const strong = end(state, summary(state, 'mara', { feels: { shade: 'livid', intensity: 4, reason: 'the tallies' } })).state
    expect(strong.aftermath).toMatchObject([{ owner: 'mara', shade: 'livid', intensity: 4 }])
    expect(strong.aftermath[0]!.toward).toBeUndefined()
    expect(end(state, summary(state, 'mara', { feels: { shade: 'glum', intensity: 2 } })).state.aftermath).toEqual([])
    expect(end(state, summary(state, 'mara', { feels: { shade: 'glum', intensity: 2 }, level: 'core' })).state.aftermath).toMatchObject([{ shade: 'glum', intensity: 2 }])
    const shaken = { ...state, scene: { ...state.scene!, moods: { ...state.scene!.moods, tobin: { shade: 'sore', family: 'mad', intensity: 5, reason: 'caught out' } } } }
    expect(end(shaken, summary(shaken, 'tobin')).state.aftermath).toMatchObject([{ owner: 'tobin', shade: 'sore', family: 'mad', intensity: 5, reason: 'caught out' }])
  })

  it('renews a family already carried, and past the limit replaces the weakest, keeping the history of feelings toward someone', () => {
    const base = yardScene()
    const state = { ...base, aftermath: [carried('mara', { toward: 'tobin', family: 'mad', shade: 'livid', intensity: 4 }), carried('mara', { toward: 'tobin', intensity: 2 })] }
    const renewed = end(state, summary(state, 'mara', { toward: [{ who: 'tobin', shade: 'sore', family: 'sad', intensity: 3, reason: 'again' }] })).state
    expect(renewed.aftermath.filter((a) => a.toward === 'tobin').map((a) => [a.shade, a.intensity])).toEqual([['livid', 4], ['sore', 3]])
    const general = { ...base, aftermath: [carried('mara', { intensity: 2 }), carried('mara', { family: 'mad', shade: 'sore', intensity: 3 })] }
    expect(end(general, summary(general, 'mara', { feels: { shade: 'livid', intensity: 5 } })).state.aftermath.map((a) => a.shade)).toEqual(['glum', 'livid'])
    // Past the limit (one, in this variant), the weakest goes; toward one person it ends into the history.
    const one = { ...fixture, ruleset: { ...R, people: { ...R.people, aftermath: { ...R.people.aftermath, max: 1, towardMax: 1 } } } }
    const single = { ...base, aftermath: [carried('mara', { intensity: 2 }), carried('mara', { toward: 'tobin', intensity: 2 })] }
    const replaced = applySummaries(one, single, [summary(single, 'mara', { feels: { shade: 'livid', intensity: 5 }, toward: [{ who: 'tobin', shade: 'livid', intensity: 4 }] })]).state
    expect(replaced.aftermath.map((a) => [a.toward ?? '', a.shade])).toEqual([['tobin', 'livid'], ['', 'livid']])
    expect(replaced.endedFeelings).toEqual([{ owner: 'mara', toward: 'tobin', family: 'sad', at: base.time, how: 'replaced' }])
  })

  it('ends feelings a scene resolved, into the history', () => {
    const base = yardScene()
    const state = { ...base, aftermath: [carried('mara', { toward: 'player', family: 'mad', shade: 'livid', intensity: 4 })] }
    const { state: next, reports } = end(state, summary(state, 'mara', { resolved: ['player', 'tobin'] }))
    expect(next.aftermath).toEqual([])
    expect(next.endedFeelings).toEqual([{ owner: 'mara', toward: 'player', family: 'mad', at: state.time, how: 'resolved' }])
    expect(reports[0]!.carried).toMatchObject({ resolved: ['player'], dropped: ['resolved "tobin": no feeling toward them'] })
  })
})

describe('a tie change on screen (relationships §3, task 4)', () => {
  it('makes both sides’ memories Core, whatever the summary chose, and tells the summary what changed', () => {
    const base = yardScene()
    const state = { ...base, scene: { ...base.scene!, tieEvents: [{ from: 'mara', to: 'tobin', added: ['hand'], ended: [], word: 'apprentice', reason: 'she takes him on' }] } }
    expect(buildSummaryPrompt(fixture, state, 'tobin').user).toContain("- What changed between people this scene (a Core memory for Tobin): Tobin becomes Mara's apprentice (she takes him on).")
    const { state: next, reports } = end(state, summary(state, 'mara', { memory: 'I took Tobin on.', level: 'fleeting' }), summary(state, 'tobin', { memory: 'Mara took me on.', level: 'normal' }))
    expect(next.memories.map((m) => [m.owner, m.level])).toEqual([['mara', 'core'], ['tobin', 'core']])
    expect(reports.map((x) => x.level)).toEqual(['core', 'core'])
  })
})

describe('the repeat rule', () => {
  const grievance = (state: GameState) => summary(state, 'mara', { toward: [{ who: 'player', shade: 'livid', intensity: 4, reason: 'forgot again' }] })
  const history = (state: GameState, n: number, ago = 10) => ({
    ...state,
    endedFeelings: Array.from({ length: n }, () => ({ owner: 'mara', toward: 'player', family: 'mad', at: state.time - ago * DAY, how: 'faded' as const }))
  })

  it('moves the mapped meter a little more each time the same family comes back toward the same person', () => {
    const state = yardScene()
    expect(end(state, grievance(state)).state.meters['mara']).toEqual(state.meters['mara'])
    const once = end(history(state, 1), grievance(history(state, 1)))
    expect(once.state.meters['mara']!['warmth']).toBe(state.meters['mara']!['warmth']! - 1)
    expect(once.reports[0]!.carried!.toward[0]!.repeat).toEqual({ count: 1, meter: 'warmth', change: -1 })
    // The ruleset's steps are 1, 2: from the second repeat on, 2.
    expect(end(history(state, 3), grievance(history(state, 3))).state.meters['mara']!['warmth']).toBe(state.meters['mara']!['warmth']! - 2)
  })

  it('forgets what ended before the history window, and moves a relation for a feeling toward another character', () => {
    const state = yardScene()
    expect(end(history(state, 1, 40), grievance(history(state, 1, 40))).state.meters['mara']).toEqual(state.meters['mara'])
    const toTobin = { ...state, endedFeelings: [{ owner: 'mara', toward: 'tobin', family: 'mad', at: state.time - DAY, how: 'resolved' as const }] }
    const next = end(toTobin, summary(toTobin, 'mara', { toward: [{ who: 'tobin', shade: 'livid', intensity: 4 }] })).state
    const before = state.relations.find((x) => x.from === 'mara' && x.to === 'tobin')!.meters
    expect(next.relations.find((x) => x.from === 'mara' && x.to === 'tobin')!.meters).toEqual({ ...before, warmth: before['warmth']! - 1 })
  })
})

describe('days', () => {
  it('moves the clock to the next morning between scenes, and only then', () => {
    const state = { ...yardScene(), scene: null }
    // The fixture's morning is 06:00; the game starts at 20:00 on day 0.
    expect(nextDay(fixture, state).time).toBe(DAY + 360)
    expect(nextDay(fixture, { ...state, time: 300 }).time).toBe(360)
    expect(() => nextDay(fixture, yardScene())).toThrow(/between scenes/)
  })

  it('fades aftermath a point every two days and ends it at 0, keeping the history of feelings toward someone', () => {
    const base = { ...yardScene(), scene: null }
    const state = { ...base, aftermath: [carried('mara', { intensity: 3 }), carried('tobin', { toward: 'player', family: 'mad', shade: 'sore', intensity: 2 })] }
    const two = dailyUpkeep(fixture, later(state, 2))
    expect(two.aftermath.map((a) => [a.owner, a.intensity])).toEqual([['mara', 2], ['tobin', 1]])
    // Running it again the same day changes nothing.
    expect(dailyUpkeep(fixture, two)).toEqual(two)
    const four = dailyUpkeep(fixture, later(two, 2))
    expect(four.aftermath.map((a) => [a.owner, a.intensity])).toEqual([['mara', 1]])
    expect(four.endedFeelings).toEqual([{ owner: 'tobin', toward: 'player', family: 'mad', at: four.time, how: 'faded' }])
    // History older than the window is dropped.
    expect(dailyUpkeep(fixture, later(four, 31)).endedFeelings).toEqual([])
  })

  it('opens a scene in the strongest active feeling, one toward someone here winning a tie, and in the card’s mood otherwise', () => {
    const base = { ...yardScene(), scene: null }
    const open = (aftermath: Aftermath[], days = 0) => startScene(fixture, later({ ...base, aftermath }, days), 'the-yard', ['mara', 'tobin']).scene!.moods['mara']
    expect(open([])).toMatchObject({ shade: 'glum', text: 'busy, curious' })
    expect(open([carried('mara', { intensity: 3 }), carried('mara', { toward: 'player', family: 'mad', shade: 'sore', intensity: 3, reason: 'forgot' })])).toEqual({ shade: 'sore', family: 'mad', intensity: 3, reason: 'toward Kit: forgot' })
    // Toward someone not here, it doesn't set the mood; faded to 1 after two days, a stronger general one wins.
    expect(open([carried('mara', { toward: 'pell', intensity: 5 }), carried('mara', { intensity: 2 })])).toEqual({ shade: 'glum', family: 'sad', intensity: 2, reason: 'rain all week' })
    expect(open([carried('mara', { intensity: 2 })], 4)).toMatchObject({ text: 'busy, curious' })
  })
})

describe('in the prompts', () => {
  it('gives the director what they carry, toward people here, and how long since a close tie saw the player', () => {
    const base = { ...yardScene(), scene: null }
    const state = startScene(fixture, {
      ...later(base, 3),
      aftermath: [carried('tobin', { since: base.time }), carried('tobin', { toward: 'mara', family: 'mad', shade: 'sore', intensity: 3, reason: 'she shouted' }), carried('tobin', { toward: 'pell', intensity: 4 })],
      lastSeen: { tobin: base.time, mara: base.time }
    }, 'the-yard', ['mara', 'tobin'])
    const sheet = buildBriefs(fixture, state, 'Evening.').sheets['tobin']!
    expect(sheet).toContain('Carrying: glum, 2 of 5: rain all week (3 days ago).')
    // Three days on, it has faded a point.
    expect(sheet).toContain('Feelings toward people here: toward Mara: sore (mad), 2 of 5: she shouted (3 days ago).')
    expect(sheet).not.toContain('pell')
    // Tobin's tie to the player (employer) is one the ruleset says he'd notice; Mara holds none.
    expect(sheet).toContain("Hadn't seen Kit in 3 days before this scene.")
    expect(buildBriefs(fixture, state, 'Evening.').sheets['mara']).not.toContain("Hadn't seen")
  })

  it('gives the summary what they carry, the feelings toward people here that passed, and asks for feels, toward and resolved', () => {
    const state = { ...yardScene(), aftermath: [carried('mara', { toward: 'tobin', family: 'mad', shade: 'livid', intensity: 4, reason: 'he lied' })], endedFeelings: [{ owner: 'mara', toward: 'player', family: 'mad', at: yardScene().time - 2 * DAY, how: 'faded' as const }] }
    const { system, user } = buildSummaryPrompt(fixture, state, 'mara')
    expect(user).toContain('- Feelings toward people, from before: toward Tobin: livid, 4 of 5: he lied (today).')
    expect(user).toContain('- Earlier feelings toward people here that have passed: mad toward Kit, once (last 2 days ago).')
    expect(system).toContain('- toward: feelings this scene left Mara with toward one person (who: "tobin", or "player" for Kit)')
    expect(system).toContain('Shades by family (usual intensity): sad: glum 1–3, sore 2–4; mad: sore 2–4, livid 4–5')
  })
})
