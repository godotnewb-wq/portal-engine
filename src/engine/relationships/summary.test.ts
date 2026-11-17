import { describe, expect, it } from 'vitest'
import { GameStateSchema, type GameState } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { endScene } from './endScene'
import { buildRelationshipPrompt, judgeScene } from './relationship'
import { addMeters, applySummaries, buildMemoryPrompt, parseSummary, plainSummary } from './summary'

const R = fixture.ruleset

/** The yard scene after one turn. */
function played(): GameState {
  const state = yardScene(2)
  state.scene!.turns.push({ id: 't1', player: 'Tobin?', beats: [{ kind: 'dialogue', speaker: 'tobin', text: 'I could not say.' }], checks: [], speakers: ['tobin'], texture: [] })
  return state
}

describe('feelings in the summary (milestone 4b)', () => {
  it('gives each witness their mood in words, and what they saw through to with a reading check', () => {
    const state = played()
    state.scene!.moods['tobin'] = { shade: 'sore', family: 'mad', intensity: 4, reason: 'she keeps asking' }
    state.scene!.turns[0]!.reads = [{ by: 'mara', target: 'tobin', feeling: { shade: 'sore', family: 'mad', intensity: 4, reason: 'she keeps asking' } }]
    expect(buildMemoryPrompt(fixture, state, 'mara').user).toContain('- Mara saw through to what Tobin really felt: sore (mad), 4 of 5: she keeps asking.')
    const tobin = buildMemoryPrompt(fixture, state, 'tobin').user
    expect(tobin).toContain('- Mood at the end: sore (mad), 4 of 5: she keeps asking; comfort 3/5.')
    expect(tobin).not.toContain('saw through')
  })
})

describe('the memory call (milestone 4c)', () => {
  it('is told what the same witness’s relationship call said, so the two can’t disagree; feelings too weak to carry are left out', () => {
    const state = played()
    state.scene!.judged = { mara: { reason: 'Tobin dodged her', delta: { warmth: 0, bond: 0 }, others: [], feels: { shade: 'glum', intensity: 2, reason: 'a long day' }, toward: [{ who: 'Tobin', shade: 'livid', intensity: 4, reason: 'he lied' }, { who: 'Kit', shade: 'glum', intensity: 1 }], resolved: ['player'] } }
    const { system, user } = buildMemoryPrompt(fixture, state, 'mara')
    expect(user).toContain("- What moved Mara in this scene, in Mara's own judgment: Tobin dodged her.")
    expect(user).toContain('- Mara leaves the scene feeling: glum, 2 of 5: a long day.')
    expect(user).toContain('- Feelings toward people that this scene left Mara with: toward Tobin: livid, 4 of 5: he lied.')
    expect(user).toContain('- A feeling Mara carried was settled in this scene with: Kit.')
    expect(system).toMatch(/^You write what one character remembers/)
    expect(system).not.toMatch(/warmth|"learned"|"ties"/)
    // A witness with no relationship answers gets none of these lines.
    expect(buildMemoryPrompt(fixture, state, 'tobin').user).not.toMatch(/own judgment|leaves the scene feeling/)
  })
})

describe('summaries in the pack’s meters and words', () => {
  it('asks for the ruleset’s meters, in its scale words, with what each meter means', () => {
    const { system, user } = buildRelationshipPrompt(fixture, played(), 'mara')
    expect(system).toMatch(/"warmth": "\.\.\.", "bond": "\.\.\."/)
    expect(system).toMatch(/each one of: "colder", "same", "warmer"/)
    expect(system).toMatch(/warmth is how much they like the other; bond is how much they would do for the other/)
    expect(system).not.toMatch(/approval|interest/)
    expect(user).toMatch(/toward Kit: warmth: civil; bond: loose/)
    expect(user).toMatch(/Toward Tobin: warmth: civil; bond: loose \(has known him since the guild took him on\)/)
  })

  it('maps the words to numbers through the ruleset, ignoring words not on its scale', () => {
    const s = parseSummary(R, JSON.stringify({ memory: 'Tobin dodged.', level: 'normal', warmth: 'Warmer', bond: 'much more', others: [{ with: 'tobin', warmth: 'colder' }] }))
    expect(s.delta).toEqual({ warmth: 3, bond: 0 })
    expect(s.others[0]!.delta).toEqual({ warmth: -3, bond: 0 })
  })

  it('keeps meters within the ruleset’s signed range, and reads a missing meter as neutral', () => {
    expect(addMeters(R, { warmth: 9, bond: -9 }, { warmth: 3, bond: -3 })).toEqual({ warmth: 10, bond: -10 })
    expect(addMeters(R, { warmth: 2 }, { bond: -3 })).toEqual({ warmth: 2, bond: -3 })
  })

  it('applies summaries: memories, meters, real secrets, new relations from the ruleset’s start values', () => {
    // What the player found out is what came out on screen (milestone 4c), not the witness's say.
    const state = played()
    state.scene!.told.push('tobin.after-closing')
    const { state: next, reports } = applySummaries(fixture, state, [
      { id: 'tobin', summary: { ...plainSummary(fixture, state, 'tobin'), memories: [{ text: 'Tobin was asked about last night.', level: 'normal', why: '' }], delta: { warmth: -3, bond: 0 }, others: [{ with: 'Mara', delta: { warmth: 3, bond: 0 }, reason: '' }] } }
    ])
    expect(next.scene).toBeNull()
    expect(next.meters['tobin']).toEqual({ warmth: -5, bond: -2 })
    expect(next.facts['tobin']).toEqual(['Tobin let someone into the yard after closing.'])
    // Tobin had no relation to Mara: it starts at the ruleset's 8 / 5 and moves from there.
    expect(next.relations.find((r) => r.from === 'tobin' && r.to === 'mara')).toEqual({ from: 'tobin', to: 'mara', tags: [], meters: { warmth: 3, bond: 0 } })
    expect(reports[0]!.after).toEqual({ warmth: -5, bond: -2 })
    expect(GameStateSchema.parse(next)).toEqual(next)
  })

  it('ends a scene with two calls per witness, a failure costing only that witness and that half', async () => {
    const memoryCall = (prompt: { system: string }) => prompt.system.startsWith('You write what one character remembers')
    // Tobin's memory call fails: a plain memory, and his meters still move by his relationship call.
    const judged = await judgeScene(fixture, played(), async () => JSON.stringify({ warmth: 'warmer', bond: 'same' }))
    const { reports } = await endScene(fixture, judged.state, async (prompt) => {
      expect(memoryCall(prompt)).toBe(true)
      if (/^About Tobin/.test(prompt.user)) throw new Error('timeout')
      return JSON.stringify({ memories: [{ text: 'Mara counted the crates.', level: 'normal' }], warmth: 'colder' })
    })
    // The memory call's reply moves no meters, whatever it says.
    expect(reports.find((r) => r.id === 'mara')).toMatchObject({ memory: 'Mara counted the crates.', after: { warmth: 5, bond: 3 } })
    expect(reports.find((r) => r.id === 'tobin')).toMatchObject({ error: 'timeout', memory: 'Tobin spent time with Kit at The Guild Yard.', after: { warmth: 1, bond: -2 } })
    // Mara's relationship call fails: her meters stay, her memory is still written, and the report says which call failed.
    const half = await judgeScene(fixture, played(), async (prompt) => {
      if (/^About Mara/.test(prompt.user)) throw new Error('timeout')
      return JSON.stringify({ warmth: 'warmer', bond: 'same' })
    })
    expect(half.trace.witnesses.map((w) => [w.id, w.error])).toEqual([['mara', 'timeout'], ['tobin', undefined]])
    const ended = await endScene(fixture, half.state, async () => JSON.stringify({ memories: [{ text: 'A quiet evening.', level: 'fleeting' }] }))
    expect(ended.reports.find((r) => r.id === 'mara')).toMatchObject({ error: 'relationship call: timeout', memory: 'A quiet evening.', before: { warmth: 2, bond: 3 }, after: { warmth: 2, bond: 3 } })
    // A scene closed without its relationship calls writes memories and changes no meters.
    const bare = await endScene(fixture, played(), async () => JSON.stringify({ memories: [{ text: 'A quiet evening.', level: 'fleeting' }], warmth: 'warmer' }))
    expect(bare.reports.map((r) => [r.after, r.error])).toEqual([[{ warmth: 2, bond: 3 }, undefined], [{ warmth: -2, bond: -2 }, undefined]])
  })
})

describe('the scene-end trace (milestone 2, A1)', () => {
  it('records each witness: the call, what was read, and what changed; a failed call is kept with its error', async () => {
    const state = played()
    const reply = async (prompt: { user: string }) => {
      if (prompt.user.startsWith('About Tobin')) throw new Error('timed out')
      return { text: JSON.stringify({ memory: 'Mara saw through him.', level: 'normal', warmth: 'warmer', bond: 'same' }), meta: { model: 'judge' } }
    }
    const judged = await judgeScene(fixture, state, reply)
    expect(judged.trace.calls.map((c) => [c.id, c.role, c.meta?.model ?? c.error])).toEqual([
      [`${state.scene!.id}:relationship:mara`, 'relationship', 'judge'],
      [`${state.scene!.id}:relationship:tobin`, 'relationship', 'timed out']
    ])
    expect(judged.trace.witnesses).toMatchObject([{ id: 'mara', relationship: { delta: { warmth: 3, bond: 0 }, ties: [] } }, { id: 'tobin', error: 'timed out' }])
    const end = await endScene(fixture, judged.state, reply)
    const { trace } = end
    expect(trace.sceneId).toBe(state.scene!.id)
    expect(trace.calls.map((c) => [c.id, c.role, c.meta?.model ?? c.error])).toEqual([
      [`${state.scene!.id}:memory:mara`, 'memory', 'judge'],
      [`${state.scene!.id}:memory:tobin`, 'memory', 'timed out']
    ])
    const mara = trace.witnesses.find((w) => w.id === 'mara')!
    expect(mara.summary).toMatchObject({ memories: [{ text: 'Mara saw through him.', level: 'normal' }], delta: { warmth: 3, bond: 0 } })
    expect(mara.report).toMatchObject({ before: { warmth: 2, bond: 3 }, after: { warmth: 5, bond: 3 } })
    expect(trace.witnesses.find((w) => w.id === 'tobin')).toMatchObject({ error: 'timed out', summary: { memories: [{ level: 'fleeting' }] } })
  })
})
