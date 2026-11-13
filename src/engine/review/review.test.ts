import { describe, expect, it } from 'vitest'
import { fixture, yardScene } from '@tests/fixture'
import { runTurn, type TurnLlm } from '@engine/scene'
import { buildScorerPrompt, currentFlags, FLAG_REASONS, itemsFor, parseScore, RUBRIC, type FlagRecord } from '.'

const PLAN = JSON.stringify({
  speakers: [{ id: 'tobin', goal: 'Dodge.', mood: 'uneasy', keeps: ['tobin.after-closing'], touched: 'who came by', approach: 'deflect' }],
  moves: [{ who: 'tobin', answers: 'player', move: 'dodge' }],
  reactions: [{ id: 'mara', beat: 'watches his hands' }],
  checks: [{ id: 'see', who: 'mara', skill: 'notice', difficulty: 'tough', stakes: 'spots the tell' }]
})
const llm: TurnLlm = { direct: async () => PLAN, write: async () => 'NARRATION: Mara watches his hands.\nTobin: "Locked up early."' }

describe('flags', () => {
  it('keep a fixed reason list that names no world', () => {
    expect(FLAG_REASONS).toContain('acted for the player')
    expect(FLAG_REASONS).toHaveLength(11)
  })

  it('stand as the newest record on each beat or turn; a clear removes it', () => {
    const base = { session: 's2', turnSession: 's1', turnId: 't1' }
    const records: FlagRecord[] = [
      { ...base, beat: 1, flag: { rating: 'bad', reasons: [], note: '' }, at: '2026-01-01T00:00:02Z' },
      { ...base, beat: 1, flag: { rating: 'good', reasons: [], note: '' }, at: '2026-01-01T00:00:01Z' },
      { ...base, beat: 2, flag: { rating: 'meh', reasons: [], note: '' }, at: '2026-01-01T00:00:01Z' },
      { ...base, beat: 2, flag: null, at: '2026-01-01T00:00:03Z' },
      { ...base, flag: { rating: 'good', reasons: ['great line'], note: 'nice' }, at: '2026-01-01T00:00:01Z' }
    ]
    const now = currentFlags(records)
    expect([...now.keys()].sort()).toEqual(['s1/t1/1', 's1/t1/turn'])
    expect(now.get('s1/t1/1')!.flag.rating).toBe('bad')
  })
})

describe('the AI scorer', () => {
  it('asks only the rubric items that apply, with the pack’s material in its slots, and never sees flags', async () => {
    const { trace } = await runTurn(fixture, yardScene(), 'Tobin, who came by?', llm, () => {}, { forceNatural: 15 })
    const asked = itemsFor(trace).map((i) => i.id)
    // A first turn: no focus rotation or repetition yet. It has a check and a secret, so 3, 5 and 9 apply.
    expect(asked).toEqual(RUBRIC.map((i) => i.id).filter((id) => id !== 2 && id !== 13))
    const { system, user } = buildScorerPrompt(fixture, trace, 'the-yard')
    expect(system).toMatch(/^5\. \[director\] A secret/m)
    expect(system).not.toMatch(/^2\. /m)
    expect(system).toContain(fixture.tone.split('\n')[0])
    expect(system).toMatch(/## Tobin \[tobin\]/)
    expect(user).toMatch(/# Check results\n- \[see\] Mara — Notice/)
    expect(user).toMatch(/2\. Tobin: Locked up early\./)
    expect(`${system}${user}`).not.toMatch(/flag/i)
  })

  it('reads its reply leniently: clamps scores, drops items it wasn’t asked, beats that don’t exist and reasons not on the list', async () => {
    const { trace } = await runTurn(fixture, yardScene(), 'Hello', llm)
    const reply = `Sure.\n${JSON.stringify({
      items: [{ id: 7, score: 9, reason: 'fine' }, { id: 2, score: 3, reason: 'not asked' }, { id: 7, score: 1, reason: 'twice' }, { id: '12', score: '2.6', reason: 'told' }],
      beats: [{ beat: 2, rating: 'bad', reasons: ['Voice', 'vibes'], note: 'flat' }, { beat: 9, rating: 'good' }, { beat: 1, rating: 'awful' }]
    })}`
    expect(parseScore(reply, trace)).toEqual({
      items: [{ id: 7, score: 5, reason: 'fine' }, { id: 12, score: 3, reason: 'told' }],
      beats: [{ beat: 2, rating: 'bad', reasons: ['voice'], note: 'flat' }]
    })
    expect(parseScore('no json here', trace)).toBeNull()
  })
})
