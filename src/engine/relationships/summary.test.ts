import { describe, expect, it } from 'vitest'
import { GameStateSchema, type GameState } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { endScene } from './endScene'
import { addMeters, applySummaries, buildSummaryPrompt, parseSummary, plainSummary } from './summary'

const R = fixture.ruleset

/** The yard scene after one turn. */
function played(): GameState {
  const state = yardScene(2)
  state.scene!.turns.push({ id: 't1', player: 'Tobin?', beats: [{ kind: 'dialogue', speaker: 'tobin', text: 'I could not say.' }], checks: [], speakers: ['tobin'], texture: [] })
  return state
}

describe('summaries in the pack’s meters and words', () => {
  it('asks for the ruleset’s meters, in its scale words, with what each meter means', () => {
    const { system, user } = buildSummaryPrompt(fixture, played(), 'mara')
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
    const state = played()
    const { state: next, reports } = applySummaries(fixture, state, [
      { id: 'tobin', summary: { ...plainSummary(fixture, state, 'tobin'), memory: 'Tobin was asked about last night.', delta: { warmth: -3, bond: 0 }, learned: ['after-closing', 'made-up'], others: [{ with: 'Mara', delta: { warmth: 3, bond: 0 }, reason: '' }] } }
    ])
    expect(next.scene).toBeNull()
    expect(next.meters['tobin']).toEqual({ warmth: -5, bond: -2 })
    expect(next.facts['tobin']).toEqual(['Tobin let someone into the yard after closing.'])
    // Tobin had no relation to Mara: it starts at the ruleset's 8 / 5 and moves from there.
    expect(next.relations.find((r) => r.from === 'tobin' && r.to === 'mara')).toEqual({ from: 'tobin', to: 'mara', meters: { warmth: 3, bond: 0 } })
    expect(reports[0]!.after).toEqual({ warmth: -5, bond: -2 })
    expect(GameStateSchema.parse(next)).toEqual(next)
  })

  it('ends a scene with one summary per witness, a failure costing only that witness', async () => {
    const { reports } = await endScene(fixture, played(), async (prompt) => {
      if (/^About Tobin/.test(prompt.user)) throw new Error('timeout')
      return JSON.stringify({ memory: 'Mara counted the crates.', warmth: 'warmer', bond: 'same' })
    })
    expect(reports.find((r) => r.id === 'mara')!.after).toEqual({ warmth: 5, bond: 3 })
    expect(reports.find((r) => r.id === 'tobin')).toMatchObject({ error: 'timeout', memory: 'Tobin spent time with Kit at The Guild Yard.' })
  })
})

describe('the scene-end trace (milestone 2, A1)', () => {
  it('records each witness: the call, what was read, and what changed; a failed call is kept with its error', async () => {
    const state = played()
    const end = await endScene(fixture, state, async (prompt) => {
      if (prompt.user.startsWith('About Tobin')) throw new Error('timed out')
      return { text: JSON.stringify({ memory: 'Mara saw through him.', level: 'normal', warmth: 'warmer', bond: 'same' }), meta: { model: 'judge' } }
    })
    const { trace } = end
    expect(trace.sceneId).toBe(state.scene!.id)
    expect(trace.calls.map((c) => [c.id, c.role, c.meta?.model ?? c.error])).toEqual([
      [`${state.scene!.id}:summary:mara`, 'summary', 'judge'],
      [`${state.scene!.id}:summary:tobin`, 'summary', 'timed out']
    ])
    const mara = trace.witnesses.find((w) => w.id === 'mara')!
    expect(mara.summary).toMatchObject({ memory: 'Mara saw through him.', delta: { warmth: 3, bond: 0 } })
    expect(mara.report).toMatchObject({ before: { warmth: 2, bond: 3 }, after: { warmth: 5, bond: 3 } })
    expect(trace.witnesses.find((w) => w.id === 'tobin')).toMatchObject({ error: 'timed out', summary: { level: 'fleeting' } })
  })
})
