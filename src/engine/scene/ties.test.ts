import { describe, expect, it } from 'vitest'
import { answerTie, applyTie, needsAgreement, tagNamed, tagsToward, tieProblem, tieQuestion, type GameState, type TieChange } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { parseReply } from './beats'
import { buildDirectorPrompt } from './director'
import { parsePlan, validatePlan } from './plan'
import { applyTurn } from './turn'

// Milestone 4b, task 4: relationship tags change through story developments (relationships §3; decided 2026-11-13).
const change = (c: Partial<TieChange> & { from: string; to: string }): TieChange => ({ reason: '', ...c })
const ASK = 'Tobin, will you work for Mara?'
const plan = (ties: object[]) => parsePlan(JSON.stringify({ speakers: [{ id: 'mara', goal: 'hire him' }], moves: [{ who: 'mara', answers: 'player', move: 'offer' }], ties }))!
const turned = (state: GameState, ties: object[]) => {
  const { plan: p, corrections } = validatePlan(fixture, state, plan(ties), ASK)
  return { plan: p, corrections, next: applyTurn(fixture, state, { id: 't1', input: ASK, plan: p, beats: [], tags: parseReply('', []).tags, dice: state.dice }) }
}

describe('tie changes', () => {
  it('know tags by id or word, and which tags with the player need the player’s yes', () => {
    expect(tagNamed(fixture, 'apprentice')).toBe('hand')
    expect(tagNamed(fixture, 'FOE')).toBe('foe')
    expect(tagNamed(fixture, 'cousin')).toBeUndefined()
    expect([needsAgreement(fixture, 'hand'), needsAgreement(fixture, 'elder'), needsAgreement(fixture, 'foe')]).toEqual([true, true, false])
  })

  it('change both sides with the counterpart, and make the reason the note on both', () => {
    const { state, event } = applyTie(fixture, yardScene(), change({ from: 'mara', to: 'tobin', add: 'hand', word: 'apprentice', backWord: 'master', reason: 'she takes him on' }), 't1')
    expect(tagsToward(state, 'mara', 'tobin')).toEqual([{ tag: 'foe', word: 'rival' }, { tag: 'hand', word: 'apprentice' }])
    expect(state.relations.find((x) => x.from === 'tobin' && x.to === 'mara')).toMatchObject({ tags: [{ tag: 'master', word: 'master' }], note: 'she takes him on', meters: fixture.ruleset.relations.start })
    expect(state.relations.find((x) => x.from === 'mara' && x.to === 'tobin')!.note).toBe('she takes him on')
    expect(event).toEqual({ from: 'mara', to: 'tobin', added: ['hand'], ended: [], word: 'apprentice', reason: 'she takes him on', turn: 't1' })
    // Ending it ends the counterpart too.
    const ended = applyTie(fixture, state, change({ from: 'mara', to: 'tobin', end: 'hand' })).state
    expect([tagsToward(ended, 'mara', 'tobin'), tagsToward(ended, 'tobin', 'mara')]).toEqual([[{ tag: 'foe', word: 'rival' }], []])
  })

  it('past the limit end the oldest tag that isn’t family, and refuse one when every tag held is family', () => {
    const hired = applyTie(fixture, yardScene(), change({ from: 'mara', to: 'tobin', add: 'hand' })).state
    // Two is the fixture's limit: a third ends "foe", her oldest that isn't family.
    const kin = applyTie(fixture, hired, change({ from: 'mara', to: 'tobin', add: 'elder', backWord: 'younger brother' }))
    expect(tagsToward(kin.state, 'mara', 'tobin').map((t) => t.tag)).toEqual(['hand', 'elder'])
    expect(kin.event.ended).toEqual(['foe'])
    expect(tagsToward(kin.state, 'tobin', 'mara')).toEqual([{ tag: 'master' }, { tag: 'younger', word: 'younger brother' }])
    const family: GameState = { ...yardScene(), relations: [{ from: 'mara', to: 'tobin', tags: [{ tag: 'elder' }, { tag: 'younger' }], meters: { warmth: 0, bond: 0 } }] }
    expect(tieProblem(fixture, family, change({ from: 'mara', to: 'tobin', add: 'hand' }))).toBe('mara toward tobin: all 2 of the tags already held are family')
  })

  it('refuse ending a tag not held or adding one already held, and leave a one-sided tag unmirrored', () => {
    expect(tieProblem(fixture, yardScene(), change({ from: 'mara', to: 'tobin', end: 'hand' }))).toBe('mara doesn\'t hold "hand" toward tobin')
    expect(tieProblem(fixture, yardScene(), change({ from: 'mara', to: 'tobin', add: 'foe' }))).toBe('mara already holds "foe" toward tobin')
    // Ending a tag and adding it back is no development, even with a new word (the end-of-Milestone-4 bench's wedding).
    expect(tieProblem(fixture, yardScene(), change({ from: 'mara', to: 'tobin', end: 'foe', add: 'foe', word: 'enemy' }))).toBe('it ends and adds "foe", which changes nothing')
    const { plan: p, corrections, next } = turned(yardScene(), [{ from: 'mara', to: 'tobin', end: 'foe', add: 'foe', reason: 'nothing really' }])
    expect(p.ties ?? []).toEqual([])
    expect(corrections).toContain('dropped tie 1: it ends and adds "foe", which changes nothing')
    expect(next.scene!.tieEvents).toEqual([])
    const grudge = applyTie(fixture, yardScene(), change({ from: 'tobin', to: 'mara', add: 'foe' })).state
    expect([tagsToward(grudge, 'tobin', 'mara'), tagsToward(grudge, 'mara', 'tobin')]).toEqual([[{ tag: 'foe' }], [{ tag: 'foe', word: 'rival' }]])
  })
})

describe('in the plan', () => {
  it('apply on the turn, by id, name or word, checked in order, with failures as corrections', () => {
    const { plan: p, corrections, next } = turned(yardScene(), [
      { from: 'Mara', to: 'tobin', add: 'apprentice', back_word: 'master', reason: 'she takes him on' },
      { from: 'mara', to: 'tobin', end: 'hand', add: 'elder', reason: 'it turns out they are kin' },
      { from: 'mara', to: 'pell', add: 'hand' },
      { from: 'tobin', to: 'mara', add: 'cousin' }
    ])
    expect(p.ties!.map((t) => [t.change.add, t.change.end, t.pending])).toEqual([['hand', undefined, false], ['elder', 'hand', false]])
    expect(corrections).toEqual(expect.arrayContaining(['dropped tie 3: "pell" isn\'t someone here', 'dropped tie 4: no tag "cousin"']))
    expect(tagsToward(next, 'mara', 'tobin').map((t) => t.tag)).toEqual(['foe', 'elder'])
    expect(next.scene!.tieEvents.map((e) => [e.added, e.ended, e.turn])).toEqual([[['hand'], [], 't1'], [['elder'], ['hand'], 't1']])
  })

  it('hold an arrangement with the player for their answer, but let a character make the player a foe on their own', () => {
    const { plan: p, next } = turned(yardScene(), [{ from: 'mara', to: 'Kit', add: 'hand', reason: 'she hires Kit' }, { from: 'tobin', to: 'player', add: 'foe', reason: 'Kit sold him out' }])
    expect(p.ties!.map((t) => t.pending)).toEqual([true, false])
    expect(next.scene!.pendingTies).toEqual([{ from: 'mara', to: 'player', add: 'hand', reason: 'she hires Kit' }])
    expect(next.playerTies['mara']).toBeUndefined()
    expect(next.playerTies['tobin']!.tags.map((t) => t.tag)).toEqual(['master', 'foe'])
    expect(tieQuestion(fixture, next.scene!.pendingTies[0]!)).toBe("Become Mara's hand?")
  })

  it('apply a yes, drop a no, and tell the director either way on the next turn only', () => {
    const { next } = turned(yardScene(), [{ from: 'mara', to: 'player', add: 'hand', reason: 'she hires Kit' }])
    const yes = answerTie(fixture, next, 0, true)
    expect(yes.playerTies['mara']).toEqual({ tags: [{ tag: 'hand' }], note: 'she hires Kit' })
    expect(yes.scene!.pendingTies).toEqual([])
    expect(yes.scene!.tieEvents).toMatchObject([{ from: 'mara', to: 'player', added: ['hand'] }])
    expect(buildDirectorPrompt(fixture, yes, 'Thanks.').user).toContain("# The player's answers since the last turn\n- Said yes: Kit becomes Mara's hand.")
    const no = answerTie(fixture, next, 0, false)
    expect(no.playerTies['mara']).toBeUndefined()
    expect(no.scene!.answered).toEqual([{ from: 'mara', to: 'player', add: 'hand', reason: 'she hires Kit', accepted: false }])
    const after = applyTurn(fixture, no, { id: 't2', input: 'Thanks.', plan: plan([]) && validatePlan(fixture, no, plan([]), 'Thanks.').plan, beats: [], tags: parseReply('', []).tags, dice: no.dice })
    expect(after.scene!.answered).toEqual([])
    expect(() => answerTie(fixture, after, 0, true)).toThrow(/No such tie change/)
  })
})
