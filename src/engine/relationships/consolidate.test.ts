import { describe, expect, it } from 'vitest'
import { hasLearned, learnedEntries, recall } from '@engine/memory'
import { characterById } from '@engine/pack'
import { applyTurn, parsePlan, parseReply, validatePlan } from '@engine/scene'
import { MINUTES_PER_DAY, type GameState, type Memory } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { applyConsolidation, consolidate, consolidationGroups, parseConsolidation, subjectsOf } from './consolidate'
import { applySummaries, buildSummaryPrompt, plainSummary } from './summary'

// Milestone 4b, task 5c: topic tagging and consolidation (memory §7; decided 2026-11-13).
const DAY = MINUTES_PER_DAY
const NOW = 40 * DAY
const mem = (n: number, over: Partial<Memory> = {}): Memory => ({ id: `mara.m${n}`, owner: 'mara', text: `moment ${n}`, level: 'normal', at: 0, revisits: 0, fadeFrom: 0, about: ['player'], focus: [], inRecall: true, topics: [], ...over })
const world = (memories: Memory[]): GameState => ({ ...yardScene(), scene: null, time: NOW, memories })

describe('subjects', () => {
  it('are a memory’s topics and the people it is about, the player only when it is about them; never who was merely there, or the place', () => {
    expect(subjectsOf(mem(1, { topics: ['faction.guild'], about: ['player', 'tobin'], focus: ['player', 'tobin'], place: 'the-yard' }))).toEqual([
      { kind: 'topic', id: 'faction.guild' },
      { kind: 'person', id: 'tobin' },
      { kind: 'player', id: 'player' }
    ])
    expect(subjectsOf(mem(2, { about: ['player', 'tobin'], place: 'the-yard' }))).toEqual([])
  })
})

describe('which memories merge', () => {
  it('needs at least five on one subject, older than 14 days, Normal or Fleeting, in recall and never merged before', () => {
    const five = [1, 2, 3, 4, 5].map((n) => mem(n, { about: ['player', 'tobin'], focus: ['tobin'] }))
    expect(consolidationGroups(fixture, world(five)).map((g) => [g.owner, g.subject, g.memories.length])).toEqual([['mara', { kind: 'person', id: 'tobin' }, 5]])
    const notYet = (over: Partial<Memory>) => consolidationGroups(fixture, world([...five.slice(0, 4), mem(5, { about: ['player', 'tobin'], focus: ['tobin'], ...over })]))
    expect(notYet({ level: 'core' })).toEqual([])
    // Raised to Core by revisits alone, it still merges (tuned 2026-11-15).
    expect(notYet({ level: 'core', promoted: true })).toHaveLength(1)
    expect(notYet({ at: NOW - 13 * DAY })).toEqual([])
    expect(notYet({ inRecall: false })).toEqual([])
    expect(notYet({ from: ['mara.m9'] })).toEqual([])
    expect(notYet({ mergedInto: 'mara.m9' })).toEqual([])
  })

  it('puts each memory in one group, the most specific subject first, and never groups memories the player was merely in', () => {
    const topic = [1, 2, 3, 4, 5].map((n) => mem(n, { topics: ['faction.guild'], about: ['player', 'tobin'], focus: ['tobin'] }))
    const tobinOnly = [6, 7, 8].map((n) => mem(n, { about: ['player', 'tobin'], focus: ['tobin'] }))
    const aboutKit = [9, 10, 11, 12, 13].map((n) => mem(n, { focus: ['player'] }))
    const background = [14, 15, 16, 17, 18, 19].map((n) => mem(n, { place: 'the-yard' }))
    const groups = consolidationGroups(fixture, world([...topic, ...tobinOnly, ...aboutKit, ...background]))
    // The guild topic takes its five; Tobin is left with three (too few); the five about Kit make a group; the six
    // where Kit and the yard were only the setting make none.
    expect(groups.map((g) => [g.subject.kind, g.subject.id, g.memories.length])).toEqual([['topic', 'faction.guild', 5], ['player', 'player', 5]])
  })
})

describe('merging', () => {
  const learned = (n: number) => mem(n, { secret: 'tobin.after-closing', about: ['tobin'], focus: ['tobin'], topics: ['tobin.after-closing'] })
  const group = (memories: Memory[]) => consolidationGroups(fixture, world(memories))[0]!

  it('makes one Normal memory with its originals’ people, topics and learned secrets, and takes them out of recall, linked', () => {
    const originals = [learned(1), ...[2, 3, 4, 5].map((n) => mem(n, { about: ['player', 'tobin'], focus: ['tobin', 'player'], place: 'the-yard', topics: ['tobin.after-closing'] }))]
    const state = world(originals)
    const { state: next, made } = applyConsolidation(fixture, state, group(originals), 'All month, Tobin kept letting people in after closing, and Mara knew.')
    expect(made).toEqual({
      id: 'mara.m6', owner: 'mara', text: 'All month, Tobin kept letting people in after closing, and Mara knew.', level: 'normal', at: NOW, revisits: 0, fadeFrom: NOW,
      about: ['tobin', 'player'], focus: ['tobin', 'player'], inRecall: true, topics: ['tobin.after-closing'], from: ['mara.m1', 'mara.m2', 'mara.m3', 'mara.m4', 'mara.m5'], inherited: [{ secret: 'tobin.after-closing' }]
    })
    expect(next.memories.filter((m) => m.from === undefined).every((m) => !m.inRecall && m.mergedInto === 'mara.m6')).toBe(true)
    // What was learned is still known through the merged memory, and recall brings the merged one.
    expect(hasLearned({ ...next, memories: next.memories.filter((m) => m.id === 'mara.m6') }, 'mara', 'tobin.after-closing')).toBe(true)
    expect(recall(fixture.ruleset, next, characterById(fixture, 'mara')!).map((m) => m.id)).toEqual(['mara.m6'])
  })

  it('carries codex pointers too, and refuses a text that is empty or over the word cap', () => {
    const linked = [1, 2, 3, 4, 5].map((n) => mem(n, { owner: 'tobin', id: `tobin.m${n}`, about: ['mara'], focus: ['mara'], ...(n === 1 && { secret: 'mara.two-books', codex: 'faction.guild.second-ledger' }) }))
    const { state } = applyConsolidation(fixture, world(linked), group(linked), 'Mara keeps the second ledger.')
    expect(learnedEntries(state, 'tobin')).toEqual(['faction.guild.second-ledger'])
    expect(applyConsolidation(fixture, world(linked), group(linked), '').refused).toBe('no text')
    expect(applyConsolidation(fixture, world(linked), group(linked), Array(61).fill('word').join(' ')).refused).toBe('61 words; the most is 60')
  })

  it('reads the reply as JSON or prose', () => {
    expect(parseConsolidation('{"text": " It added up. "}')).toBe('It added up.')
    expect(parseConsolidation('<think>hm</think>It added up.')).toBe('It added up.')
    expect(parseConsolidation('{"text": 3}')).toBe('')
  })

  it('runs one call per group, keeps going past a failure, and leaves a failed group’s memories as they were', async () => {
    const memories = [...[1, 2, 3, 4, 5].map((n) => mem(n, { about: ['player', 'tobin'], focus: ['tobin'] })), ...[1, 2, 3, 4, 5].map((n) => mem(n, { id: `tobin.m${n}`, owner: 'tobin', focus: ['player'] }))]
    const prompts: string[] = []
    const { state, trace } = await consolidate(fixture, world(memories), async (prompt) => {
      prompts.push(prompt.user)
      if (prompt.user.startsWith('Tobin')) throw new Error('timed out')
      return { text: JSON.stringify({ text: 'Tobin and Mara kept circling the same night.' }) }
    }, () => 0)
    expect(prompts[0]).toBe(["Mara's memories about Tobin, oldest first:", ...[1, 2, 3, 4, 5].map((n) => `- (40 days ago) moment ${n}`)].join('\n'))
    expect(trace.groups.map((g) => [g.owner, g.made, g.error])).toEqual([['mara', 'mara.m6', undefined], ['tobin', undefined, 'timed out']])
    expect(trace.calls.map((c) => c.role)).toEqual(['consolidation', 'consolidation'])
    expect(state.memories.filter((m) => m.owner === 'tobin').every((m) => m.inRecall && !m.mergedInto)).toBe(true)
  })
})

describe('topics', () => {
  it('come from the codex entries the conversation brought up and the secrets that came out; the summary picks only those', () => {
    const base = yardScene()
    const p = validatePlan(fixture, base, parsePlan(JSON.stringify({ speakers: [{ id: 'tobin', goal: 'x' }], moves: [{ who: 'tobin', answers: 'player', move: 'reveal', uses: ['tobin.after-closing'] }] }))!, 'x').plan
    const state = applyTurn(fixture, base, { id: 't1', input: 'x', plan: p, beats: [{ kind: 'dialogue', speaker: 'tobin', text: 'x' }], tags: parseReply('', []).tags, dice: 1, topics: ['faction.guild'] })
    expect(state.scene!.turns[0]!.topics).toEqual(['faction.guild', 'tobin.after-closing'])
    const prompt = buildSummaryPrompt(fixture, state, 'mara')
    expect(prompt.user).toContain("- Topics that came up this scene: [faction.guild] The Guild; [tobin.after-closing] Tobin's secret.")
    expect(prompt.system).toContain('- topics: for each memory, the ids of the topics that came up this scene that it is about')
    const { state: next, reports } = applySummaries(fixture, state, [{ id: 'mara', summary: { ...plainSummary(fixture, state, 'mara'), memories: [{ text: 'Tobin let someone in.', level: 'normal', why: '', topics: ['tobin.after-closing', 'faction.watch'] }] } }])
    expect(next.memories[0]!.topics).toEqual(['tobin.after-closing'])
    // The summary left the secret out of `heard`, but its memory is about it, so that memory carries it (as in the end-of-Milestone-4 bench run 2).
    expect(next.memories.map((m) => m.secret)).toEqual(['tobin.after-closing'])
    expect(reports[0]!.memoryNotes).toEqual(["dropped topics that didn't come up: faction.watch", 'heard "tobin.after-closing": left out of the summary, learned all the same'])
  })
})
