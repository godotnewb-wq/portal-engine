import { describe, expect, it } from 'vitest'
import { fadeMemories, recall, selectMemories } from '@engine/memory'
import { characterById } from '@engine/pack'
import { buildBriefs, applyTurn, parseReply, validatePlan, parsePlan } from '@engine/scene'
import { MINUTES_PER_DAY, type GameState, type Memory } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { dailyUpkeep } from './aftermath'
import { applySummaries, buildMemoryPrompt, plainSummary, type Summary, type WrittenMemory } from './summary'

// Milestone 4b, task 5a: the Memory Bank's shape, levels, limits and fading, and relevance-based recall (memory §3–6).
const R = fixture.ruleset
const DAY = MINUTES_PER_DAY
const mara = characterById(fixture, 'mara')!
const tobin = characterById(fixture, 'tobin')!
const mem = (over: Partial<Memory> & { id: string }): Memory => ({ owner: 'mara', text: over.id, level: 'normal', at: 0, revisits: 0, fadeFrom: 0, about: [], focus: [], inRecall: true, topics: [], ...over })
const written = (text: string, level: WrittenMemory['level'] = 'normal', why = ''): WrittenMemory => ({ text, level, why })
const end = (state: GameState, id: string, over: Partial<Summary>) => applySummaries(fixture, state, [{ id, summary: { ...plainSummary(fixture, state, id), ...over } }])
/** The yard with Mara having felt something strong this scene, so the guard lets her Core memories stand. */
const stirred = (state = yardScene()) => ({ ...state, scene: { ...state.scene!, peaks: { ...state.scene!.peaks, mara: 4, tobin: 4 } } })

describe('recall', () => {
  const context = { people: ['player', 'tobin'], place: 'the-yard' }
  it('ranks by the scene’s people and place, then recency, and gives Core at most about half the slots', () => {
    const pool = [
      mem({ id: 'old-core-here', level: 'core', about: ['tobin'], place: 'the-yard', at: 1 }),
      mem({ id: 'new-core-elsewhere', level: 'core', at: 9 }),
      mem({ id: 'core-3', level: 'core', at: 3 }),
      mem({ id: 'normal-here', about: ['tobin'], at: 2 }),
      mem({ id: 'normal-recent', at: 8 }),
      mem({ id: 'faded', at: 10, inRecall: false })
    ]
    // Four slots: two Core, two others.
    expect(selectMemories(R, pool, 4, context).map((m) => m.id)).toEqual(['old-core-here', 'new-core-elsewhere', 'normal-here', 'normal-recent'])
    // With no others, Core fills every slot; with few Core, the rest fill them.
    expect(selectMemories(R, pool.filter((m) => m.level === 'core'), 4, context)).toHaveLength(3)
    expect(selectMemories(R, [pool[0]!, pool[3]!, pool[4]!, mem({ id: 'n3', at: 5 })], 4, context).map((m) => m.id)).toEqual(['old-core-here', 'normal-here', 'normal-recent', 'n3'])
  })
})

describe('fading', () => {
  it('steps Normal down to Fleeting after 30 days, takes Fleeting out of recall after 7 more, never touches Core, and keeps everything', () => {
    const pool = [mem({ id: 'n' }), mem({ id: 'f', level: 'fleeting' }), mem({ id: 'c', level: 'core' })]
    const at = (days: number) => fadeMemories(R, pool, days * DAY).map((m) => [m.id, m.level, m.inRecall])
    expect(at(6)).toEqual([['n', 'normal', true], ['f', 'fleeting', true], ['c', 'core', true]])
    expect(at(7)).toEqual([['n', 'normal', true], ['f', 'fleeting', false], ['c', 'core', true]])
    expect(at(30)).toEqual([['n', 'fleeting', true], ['f', 'fleeting', false], ['c', 'core', true]])
    expect(at(37)).toEqual([['n', 'fleeting', false], ['f', 'fleeting', false], ['c', 'core', true]])
    // The daily upkeep runs it.
    const state = { ...yardScene(), scene: null, memories: pool, time: 8 * DAY }
    expect(dailyUpkeep(fixture, state).memories.find((m) => m.id === 'f')!.inRecall).toBe(false)
  })
})

describe('memories from a scene', () => {
  it('stores several, with ids, the scene, the place and who was there, up to the tier’s limit', () => {
    const state = yardScene()
    const { state: next, reports } = end(state, 'tobin', { memories: [written('One.'), written('Two.', 'fleeting'), written('Three.')] })
    expect(next.memories).toEqual([
      { id: 'tobin.m1', owner: 'tobin', text: 'One.', level: 'normal', scene: state.scene!.id, place: 'the-yard', at: state.time, revisits: 0, fadeFrom: state.time, about: ['player', 'mara'], focus: [], inRecall: true, topics: [] },
      expect.objectContaining({ id: 'tobin.m2', text: 'Two.', level: 'fleeting' })
    ])
    expect(reports[0]!.memoryNotes).toEqual(['kept the first 2 of 3 memories'])
    expect(reports[0]).toMatchObject({ memory: 'One.', level: 'normal' })
  })

  it('records who a memory is about: whom the summary names, and whom the scene changed something with, never just who was there', () => {
    const state = yardScene()
    const focus = (over: Partial<Summary>) => end(state, 'mara', over).state.memories.map((m) => m.focus)
    // Small talk, nothing changed: about no one, though Tobin and the player were there.
    expect(focus({ memories: [written('Small talk.')] })).toEqual([[]])
    expect(end(state, 'mara', { memories: [written('Small talk.')] }).state.memories[0]!.about).toEqual(['player', 'tobin'])
    // Named by the summary, by id or name; someone who wasn't there is left out.
    expect(focus({ memories: [{ ...written('Tobin dodged.'), about: ['Tobin', 'pell'] }] })).toEqual([['tobin']])
    // Her meters toward the player moved, or she carries a feeling toward him: about the player too.
    expect(focus({ memories: [written('Kit was kind.')], delta: { warmth: 3, bond: 0 } })).toEqual([['player']])
    expect(focus({ memories: [written('Kit forgot.')], toward: [{ who: 'player', shade: 'glum', intensity: 2 }] })).toEqual([['player']])
    expect(buildMemoryPrompt(fixture, state, 'mara').system).toContain('- about: for each memory, who it is really about: "tobin", "player" for Kit.')
  })

  it('needs a reason for Core, holds to the Core limit, and downgrades Core when nothing felt was strong (the guard)', () => {
    const many = [written('A.', 'core', 'it changed her'), written('B.', 'core', 'it changed her too'), written('C.', 'core')]
    const strong = end(stirred(), 'mara', { memories: many })
    expect(strong.state.memories.map((m) => [m.text, m.level, m.reason])).toEqual([['A.', 'core', 'it changed her'], ['B.', 'core', 'it changed her too'], ['C.', 'normal', undefined]])
    expect(strong.reports[0]!.memoryNotes).toEqual(['"C.…": Normal, not Core (no reason given)'])
    const tight = end(stirred(), 'tobin', { memories: [written('A.', 'core', 'x'), written('B.', 'core', 'y')] })
    expect(tight.state.memories.map((m) => m.level)).toEqual(['core', 'normal'])
    const calm = end(yardScene(), 'mara', { memories: [written('A.', 'core', 'it changed her')] })
    expect(calm.state.memories[0]!.level).toBe('normal')
    expect(calm.reports[0]!.memoryNotes).toEqual(['"A.…": Normal, not Core (nothing felt in the scene was strong enough)'])
  })

  it('forces Core for a secret of theirs said on screen, outside the limits, and tells the summary', () => {
    const base = yardScene()
    const state = { ...base, scene: { ...base.scene!, told: ['tobin.after-closing'] } }
    expect(buildMemoryPrompt(fixture, state, 'tobin').user).toContain("- Tobin's secret [after-closing] came out on screen this scene (a Core memory for Tobin).")
    const { state: next } = end(state, 'tobin', { memories: [written('He told.', 'fleeting'), written('Also this.', 'core', 'x')] })
    expect(next.memories.map((m) => [m.level, m.reason])).toEqual([['core', 'a secret of theirs came out'], ['normal', undefined]])
  })

  it('restarts a revisited memory’s clock, brings a faded one back and makes a Fleeting one Normal', () => {
    const base = stirred()
    const old = [mem({ id: 'mara.m1', level: 'fleeting', inRecall: false, at: -5 * DAY }), mem({ id: 'mara.m2', at: -2 * DAY }), mem({ id: 'tobin.m1', owner: 'tobin', at: -1 })]
    const state = { ...base, memories: old }
    const { state: next, reports } = end(state, 'mara', { memories: [written('Again.')], revisited: ['mara.m1', 'mara.m2', 'tobin.m1', 'mara.m3'] })
    const m = (id: string) => next.memories.find((x) => x.id === id)!
    // Made 5 and 2 days ago: too soon for either revisit to count toward Core (memory.upgrade.apartDays, 7).
    expect([m('mara.m1').level, m('mara.m1').inRecall, m('mara.m1').revisits, m('mara.m1').fadeFrom]).toEqual(['normal', true, 0, state.time])
    expect([m('mara.m2').level, m('mara.m2').revisits, m('mara.m2').revisited]).toEqual(['normal', 0, state.time])
    expect(m('tobin.m1').revisits).toBe(0)
    expect(reports[0]!.revisited).toEqual([{ id: 'mara.m1', level: 'normal' }, { id: 'mara.m2', level: 'normal' }])
    expect(reports[0]!.memoryNotes).toEqual(['revisited "tobin.m1": not one of their earlier memories', 'revisited "mara.m3": not one of their earlier memories'])
  })

  // Tuned 2026-11-15 (user): the bench's long run raised seven ordinary memories to Core, one revisit at a time.
  it('raises a Normal memory to Core only on its third revisit a week or more apart, within the scene’s Core limit', () => {
    const base = stirred()
    const old = [
      mem({ id: 'mara.m1', at: -30 * DAY, revisits: 2, counted: -10 * DAY }),
      mem({ id: 'mara.m2', at: -30 * DAY, revisits: 2, counted: -3 * DAY }),
      mem({ id: 'mara.m3', at: -30 * DAY, revisits: 1, counted: -20 * DAY })
    ]
    const { state: next, reports } = end({ ...base, memories: old }, 'mara', { memories: [written('Again.')], revisited: ['mara.m1', 'mara.m2', 'mara.m3'] })
    const m = (id: string) => next.memories.find((x) => x.id === id)!
    expect([m('mara.m1').level, m('mara.m1').revisits, m('mara.m1').counted, m('mara.m1').promoted]).toEqual(['core', 3, base.time, true])
    // Revisited 3 days after the last that counted: the clock restarts, the count doesn't move.
    expect([m('mara.m2').level, m('mara.m2').revisits, m('mara.m2').counted, m('mara.m2').fadeFrom]).toEqual(['normal', 2, -3 * DAY, base.time])
    expect([m('mara.m3').level, m('mara.m3').revisits]).toEqual(['normal', 2])
    expect(reports[0]!.memoryNotes).toContain('"mara.m1…": Core after 3 revisits')
    // The summary's own Core choices share the limit (Mara is Major: 2); an upgrade past it waits for a later revisit.
    const full = end({ ...base, memories: [old[0]!] }, 'mara', { memories: [written('It changed her.', 'core', 'she saw it'), written('So did this.', 'core', 'it mattered')], revisited: ['mara.m1'] })
    expect(full.state.memories.find((x) => x.id === 'mara.m1')!.level).toBe('normal')
    expect(full.reports[0]!.memoryNotes).toContain('"mara.m1…": stays Normal after 3 revisits (over the limit of 2)')
  })

  it('shows the summary its memories with ids, those recalled and those the scene brought in', () => {
    const base = yardScene()
    const faded = mem({ id: 'mara.m1', text: 'The second ledger was moved to the tally office.', level: 'fleeting', inRecall: false })
    const state = { ...base, memories: [faded, mem({ id: 'mara.m2', text: 'Tobin owes the yard a week.', about: ['tobin'] })] }
    // The player's words reach the faded memory; the brief brings it in, and the turn records it.
    const briefs = buildBriefs(fixture, state, 'Where is the second ledger now?')
    expect(briefs.details.find((d) => d.id === 'mara.m1')).toMatchObject({ kind: 'memory', rank: 'answer' })
    expect(briefs.trace.memories!['mara']).toBeGreaterThan(0)
    const plan = validatePlan(fixture, state, parsePlan(JSON.stringify({ speakers: [{ id: 'mara', goal: 'x' }], moves: [{ who: 'mara', answers: 'player', move: 'answer' }] }))!, 'x').plan
    const next = applyTurn(fixture, state, { id: 't1', input: 'x', plan, beats: [], tags: parseReply('', []).tags, dice: 1, memories: ['mara.m1'] })
    const user = buildMemoryPrompt(fixture, next, 'mara').user
    expect(user).toContain('- Remembers:\n  - [mara.m2] (normal) Tobin owes the yard a week.\n  - [mara.m1] (fleeting) The second ledger was moved to the tally office.')
  })

  it('brings recalled memories to the director for the scene’s people first, within the tier’s count', () => {
    const many = Array.from({ length: 6 }, (_, i) => mem({ id: `tobin.m${i + 1}`, owner: 'tobin', at: i, about: i === 0 ? ['mara'] : [] }))
    const state = { ...yardScene(), memories: many }
    expect(recall(R, state, tobin).map((m) => m.id)).toEqual(['tobin.m1', 'tobin.m6', 'tobin.m5', 'tobin.m4'])
    expect(recall(R, state, mara)).toEqual([])
  })
})
