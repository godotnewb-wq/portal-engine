import { describe, expect, it } from 'vitest'
import { buildDirectorPrompt, applyTurn, parsePlan, parseReply, validatePlan } from '@engine/scene'
import type { Pack } from '@engine/pack'
import { answerTie, tagsToward, tieQuestion, type GameState } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { buildTiePrompt, checkTies, parseTies, settleTies } from './tieCheck'
import { applySummaries, plainSummary } from './summary'

// Milestone 4b: relationship changes are read from the finished scene (relationships §3; decided 2026-11-15, user).
const ASK = 'Tobin, will you work for Mara?'
/** The yard after one turn, so there is a scene to read. */
const played = (state: GameState = yardScene()): GameState => {
  const raw = parsePlan(JSON.stringify({ speakers: [{ id: 'mara', goal: 'hire him' }], moves: [{ who: 'mara', answers: 'player', move: 'offer' }] }))!
  const { plan } = validatePlan(fixture, state, raw, ASK)
  return applyTurn(fixture, state, { id: 't1', input: ASK, plan, beats: [{ kind: 'dialogue', speaker: 'mara', text: 'Work for me.' }], tags: parseReply('', []).tags, dice: state.dice })
}

describe('the end-of-scene tie check', () => {
  it('shows who was there with pronouns, their tags now, the tag list and the scene by turn', () => {
    const p = buildTiePrompt(fixture, played())
    expect(p.system).toMatch(/^You read a finished scene/)
    expect(p.system).toContain('Never end and add the same tag.')
    expect(p.system).toMatch(/Kit is the player \(they\/them\)/)
    expect(p.user).toMatch(/# Who was in the scene\n- Mara \[mara\], /)
    expect(p.user).toContain('- Mara → Tobin: foe ("rival")')
    expect(p.user).toMatch(/## Turn 1\nKit: Tobin, will you work for Mara\?\nMara: Work for me\./)
  })

  it('reads the proposals, and nothing from a reply without a list', () => {
    expect(parseTies('{"ties": [{"turn": 1, "from": "mara", "to": "tobin", "add": "hand", "reason": "she takes him on"}]}')).toEqual([{ turn: 1, from: 'mara', to: 'tobin', add: 'hand', reason: 'she takes him on' }])
    expect(parseTies('{"ties": []}')).toEqual([])
    expect(parseTies('No changes.')).toBeUndefined()
  })

  it('applies changes by id, name or word, in order, each checked against the ones before; refuses the rest', () => {
    const state = played()
    const { state: next, applied, pending, refused } = settleTies(fixture, state, [
      { turn: 1, from: 'Mara', to: 'tobin', add: 'apprentice', back_word: 'master', reason: 'she takes him on' },
      { from: 'mara', to: 'tobin', end: 'hand', add: 'elder', reason: 'it turns out they are kin' },
      { from: 'mara', to: 'pell', add: 'hand', reason: '' },
      { from: 'tobin', to: 'mara', add: 'cousin', reason: '' },
      { from: 'mara', to: 'tobin', end: 'elder', add: 'elder', reason: 'nothing really' }
    ])
    expect(applied.map((e) => [e.added, e.ended, e.turn])).toEqual([[['hand'], [], state.scene!.turns[0]!.id], [['elder'], ['hand'], state.scene!.turns[0]!.id]])
    expect(pending).toEqual([])
    expect(refused).toEqual(['3: "pell" wasn\'t someone else in the scene', '4: no tag "cousin"', '5: it ends and adds "elder", which changes nothing'])
    expect(tagsToward(next, 'mara', 'tobin').map((t) => t.tag)).toEqual(['foe', 'elder'])
    expect(next.scene!.tieEvents).toEqual(applied)
  })

  describe('a partner tag that ends on its own leaves an ex behind (decided 2026-11-16)', () => {
    const partners: Pack = {
      ...fixture,
      ruleset: {
        ...fixture.ruleset,
        ties: {
          ...fixture.ruleset.ties,
          groups: [...fixture.ruleset.ties.groups, { id: 'partners', name: 'Partners' }],
          tags: [
            ...fixture.ruleset.ties.tags,
            ...['partner', 'fiance', 'spouse'].map((id) => ({ id, group: 'partners', counterpart: id, words: [id], oneSided: false, family: false, endsAs: 'ex' })),
            { id: 'ex', group: 'partners', counterpart: 'ex', words: ['ex'], oneSided: false, family: false }
          ]
        }
      }
    }
    /** The yard with Mara and Tobin holding `tag` toward each other, and Mara holding it toward the player. */
    const holding = (tag: string): GameState => {
      const s = played()
      const relations = s.relations.filter((x) => !(x.from === 'mara' && x.to === 'tobin') && !(x.from === 'tobin' && x.to === 'mara'))
      const rel = (from: string, to: string) => ({ from, to, meters: { ...fixture.ruleset.relations.start }, tags: [{ tag }] })
      return { ...s, relations: [...relations, rel('mara', 'tobin'), rel('tobin', 'mara')], playerTies: { ...s.playerTies, mara: { tags: [{ tag }] } } }
    }
    const tags = (s: GameState, from: string, to: string) => tagsToward(s, from, to).map((t) => t.tag)

    it('adds ex on both sides, as part of the breakup’s own event', () => {
      const { state, applied } = settleTies(partners, holding('partner'), [{ from: 'mara', to: 'tobin', end: 'partner', reason: 'they split' }])
      expect([tags(state, 'mara', 'tobin'), tags(state, 'tobin', 'mara')]).toEqual([['ex'], ['ex']])
      expect(applied.map((e) => [e.added, e.ended])).toEqual([[['ex'], ['partner']]])
      expect(state.scene!.tieEvents).toEqual(applied)
    })

    it('ends partner when ex is added outright, on both sides (run 3: the pair were left partners and exes)', () => {
      const { state, applied } = settleTies(partners, holding('partner'), [{ from: 'mara', to: 'tobin', add: 'ex', reason: 'they split' }])
      expect([tags(state, 'mara', 'tobin'), tags(state, 'tobin', 'mara')]).toEqual([['ex'], ['ex']])
      expect(applied.map((e) => [e.added, e.ended])).toEqual([[['ex'], ['partner']]])
    })

    it('adds ex toward the player too', () => {
      const { state } = settleTies(partners, holding('spouse'), [{ from: 'mara', to: 'player', end: 'spouse', reason: 'divorce' }])
      expect(tags(state, 'mara', 'player')).toEqual(['ex'])
    })

    it('adds nothing when the pair moves on to another partner tag, in the same change or another', () => {
      const one = settleTies(partners, holding('fiance'), [{ from: 'mara', to: 'tobin', end: 'fiance', add: 'spouse', reason: 'wed' }])
      expect(tags(one.state, 'mara', 'tobin')).toEqual(['spouse'])
      const two = settleTies(partners, holding('fiance'), [
        { from: 'mara', to: 'tobin', end: 'fiance', reason: 'no longer engaged' },
        { from: 'mara', to: 'tobin', add: 'spouse', reason: 'wed' }
      ])
      expect(tags(two.state, 'mara', 'tobin')).toEqual(['spouse'])
      expect(two.applied.map((e) => e.added)).toEqual([[], ['spouse']])
    })
  })

  it('turns a change written from the player’s side around, with the counterpart tag and words; a one-sided tag can’t be (decided 2026-11-16)', () => {
    const owed = { ...played(), playerTies: { mara: { tags: [{ tag: 'hand' }] } } }
    const { state, applied, refused } = settleTies(fixture, owed, [
      { from: 'Kit', to: 'mara', end: 'master', reason: 'Kit quits' },
      { from: 'player', to: 'tobin', add: 'foe', reason: 'Kit swears to bring him down' }
    ])
    expect(applied.map((e) => [e.from, e.to, e.ended])).toEqual([['mara', 'player', ['hand']]])
    expect(state.playerTies['mara']!.tags).toEqual([])
    expect(refused).toEqual(["2: Kit holds no tags, and a one-sided tag can't be turned around"])
  })

  it('holds an arrangement with the player for their answer, and lets a character make the player a foe on their own', () => {
    const { state: next, pending } = settleTies(fixture, played(), [
      { from: 'mara', to: 'Kit', add: 'hand', reason: 'she hires Kit' },
      { from: 'tobin', to: 'player', add: 'foe', reason: 'Kit sold him out' }
    ])
    expect(pending).toEqual([{ from: 'mara', to: 'player', add: 'hand', reason: 'she hires Kit' }])
    expect(next.scene!.pendingTies).toEqual(pending)
    expect(next.playerTies['mara']).toBeUndefined()
    expect(next.playerTies['tobin']!.tags.map((t) => t.tag)).toEqual(['master', 'foe'])
    expect(tieQuestion(fixture, pending[0]!)).toBe("Become Mara's hand?")
    // A yes applies it and becomes a tie event, so the summaries force the Core memory; a no is only recorded.
    const yes = answerTie(fixture, next, 0, true)
    expect(yes.playerTies['mara']).toEqual({ tags: [{ tag: 'hand' }], note: 'she hires Kit' })
    expect(yes.scene!.tieEvents.at(-1)).toMatchObject({ from: 'mara', to: 'player', added: ['hand'] })
    const memories = applySummaries(fixture, yes, [{ id: 'mara', summary: plainSummary(fixture, yes, 'mara') }]).state.memories
    expect(memories.find((m) => m.owner === 'mara')).toMatchObject({ level: 'core', reason: expect.stringMatching(/relationship/) })
    const no = answerTie(fixture, next, 0, false)
    expect(no.playerTies['mara']).toBeUndefined()
    expect(no.scene!.answered).toEqual([{ from: 'mara', to: 'player', add: 'hand', reason: 'she hires Kit', accepted: false }])
  })

  it('makes one call on the given model; a failed or unreadable reply changes nothing; a scene with no turns isn’t read', async () => {
    const ok = await checkTies(fixture, played(), async () => '{"ties": [{"from": "mara", "to": "tobin", "add": "hand", "reason": "she takes him on"}]}', () => 0)
    expect(ok.trace).toMatchObject({ callId: expect.stringMatching(/:ties$/), applied: [{ added: ['hand'] }], refused: [] })
    expect(ok.trace.calls.map((c) => c.role)).toEqual(['ties'])
    const failed = await checkTies(fixture, played(), async () => Promise.reject(new Error('timeout')), () => 0)
    expect(failed.trace.error).toBe('timeout')
    expect(failed.state.scene!.tieEvents).toEqual([])
    const unreadable = await checkTies(fixture, played(), async () => 'Nothing changed.', () => 0)
    expect(unreadable.trace.error).toMatch(/no "ties" list/)
    let asked = 0
    const empty = await checkTies(fixture, yardScene(), async () => (asked++, '{"ties": []}'), () => 0)
    expect([asked, empty.trace.calls]).toEqual([0, []])
  })

  it('leaves the director out of it: no tie field or tag list in its prompt, and the plan has none', () => {
    const p = buildDirectorPrompt(fixture, played(), 'Thanks.')
    expect(p.system).not.toMatch(/"ties"|back_word/)
    expect(p.system).toContain('Relationship tags (what people are to each other) change only after the scene')
  })
})
