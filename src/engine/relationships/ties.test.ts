import { describe, expect, it } from 'vitest'
import type { Pack } from '@engine/pack'
import { answerTie, tagsToward, tieQuestion, type GameState } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { buildRelationshipPrompt, judgeScene, parseRelationship } from './relationship'
import { applySummaries, plainSummary } from './summary'
import { findLine, settleTies, type StatedTie } from './ties'

// Milestone 4c: each witness says what someone became to them, and the game settles what they said (relationships §3;
// decided 2026-11-16, user).
const HIRE = 'Work for me, Tobin. Start at dawn.'
const YES = "I will. I'll be at the gate before the bell."
/** The yard after two turns: Mara takes Tobin on and he accepts; then Kit says they are done with Mara. */
const played = (state: GameState = yardScene()): GameState => {
  state.scene!.turns.push(
    { id: 't1', player: 'Tobin, will you work for Mara?', beats: [{ kind: 'dialogue', speaker: 'mara', text: HIRE }, { kind: 'dialogue', speaker: 'tobin', text: YES }], checks: [], speakers: ['mara', 'tobin'], texture: [] },
    { id: 't2', player: "Mara, I'm finished here. Find another hand.", beats: [{ kind: 'narration', text: 'Mara shuts the tally book.' }], checks: [], speakers: [], texture: [] }
  )
  return state
}
const said = (by: string, who: string, rest: Partial<StatedTie>): StatedTie => ({ by, with: who, line: HIRE, ...rest })

describe('the relationship call', () => {
  it('shows what each person is to the witness now, asks for ties in the first person, and lists the words a tie can be', () => {
    const p = buildRelationshipPrompt(fixture, played(), 'mara')
    expect(p.system).toMatch(/^You judge how one scene/)
    expect(p.system).toMatch(/Kit is the player \(they\/them\)/)
    expect(p.system).toContain('"ties": [{"with": "id", "now": "...", "no_longer": "...", "line": "..."}]')
    // The example is no work tie, which bench runs copied word for word (Milestone 5 plan, task 5).
    expect(p.system).toContain('"Ada is now my wife" is {"with": "ada", "now": "wife", "line": "..."}')
    // The fixture asks nothing about work that lasts, so the call has no such field.
    expect(p.system).not.toContain('lasting')
    expect(p.system).toContain('an order given once, one favor or help with one task is not a tie')
    expect(p.system).toContain('- What someone can be to Mara: Blood: older sister/older brother, younger sister/younger brother. Trade: master, hand/apprentice, foe.')
    expect(p.user).toContain('- What each person here is to Mara now: Tobin [tobin]: rival; Kit [player]: no tie.')
    expect(p.user).toMatch(/Kit: Tobin, will you work for Mara\?\nMara: Work for me, Tobin\. Start at dawn\./)
    // The memory call's material stays out of it.
    expect(p.user).not.toMatch(/Topics that came up|a Core memory/)
  })

  it('reads the meters, feelings and ties, and nothing from a reply that isn’t JSON', () => {
    const r = parseRelationship(fixture, '<think>hm</think>{"reason": "he said yes", "warmth": "warmer", "bond": "nonsense", "others": [{"with": "tobin", "warmth": "colder"}], "toward": [{"who": "tobin", "shade": "sore", "intensity": 3}], "resolved": ["player"], "ties": [{"with": "tobin", "now": "apprentice", "line": "I will."}, {"with": "tobin"}, {"with": "player", "no_longer": "master"}]}')
    expect(r).toEqual({
      reason: 'he said yes',
      delta: { warmth: 3, bond: 0 },
      others: [{ with: 'tobin', delta: { warmth: -3, bond: 0 }, reason: '' }],
      toward: [{ who: 'tobin', shade: 'sore', intensity: 3 }],
      resolved: ['player'],
      ties: [{ with: 'tobin', now: 'apprentice', line: 'I will.' }, { with: 'player', no_longer: 'master', line: '' }]
    })
    expect(parseRelationship(fixture, 'Nothing changed.')).toBeUndefined()
  })

  it('asks every witness at once and keeps their answers on the scene; a failed or unreadable call changes nothing for them', async () => {
    const state = played()
    const { state: next, trace } = await judgeScene(
      fixture,
      state,
      async (prompt) => {
        if (prompt.user.startsWith('About Tobin')) return 'Nothing much.'
        return JSON.stringify({ reason: 'he said yes', warmth: 'warmer', bond: 'same', ties: [{ with: 'tobin', now: 'hand', line: HIRE }] })
      },
      () => 0
    )
    expect(trace.calls.map((c) => [c.id, c.role])).toEqual([[`${state.scene!.id}:relationship:mara`, 'relationship'], [`${state.scene!.id}:relationship:tobin`, 'relationship']])
    expect(trace.witnesses.map((w) => [w.id, w.error])).toEqual([['mara', undefined], ['tobin', 'the reply was not a JSON object']])
    // Tobin's call said nothing, so Mara's side stands alone and no tag begins.
    expect(trace).toMatchObject({ stated: [{ by: 'mara', with: 'tobin', now: 'hand' }], applied: [], alone: ["Mara says Tobin is now Mara's hand; Tobin doesn't say Mara is now Tobin's master"] })
    expect(next.scene!.judged).toEqual({ mara: { reason: 'he said yes', delta: { warmth: 3, bond: 0 }, others: [], toward: [], resolved: [] }, tobin: { reason: '', delta: {}, others: [], toward: [], resolved: [], error: 'the reply was not a JSON object' } })
  })
})

describe('finding the quoted line in the scene', () => {
  const state = played()
  it('forgives punctuation, case and a speaker’s name in front, and reads the player’s words too', () => {
    expect(findLine(state, 'work for me, tobin — start at dawn')).toBe(0)
    expect(findLine(state, `Tobin: "${YES}"`)).toBe(0)
    expect(findLine(state, 'I’m finished here. Find another hand.')).toBe(1)
  })
  it('takes a line with a few words off when most of its words are in one turn', () => {
    expect(findLine(state, "I will, I'll be at the gate before the morning bell")).toBe(0)
    expect(findLine(state, 'I will be your apprentice from now on, Mara')).toBeUndefined()
  })
  it('finds nothing for a line that isn’t there, an empty one, or one too short to mean anything', () => {
    expect(findLine(state, 'You are hired.')).toBeUndefined()
    expect(findLine(state, '')).toBeUndefined()
    expect(findLine(state, 'Tobin.')).toBeUndefined()
  })
})

describe('settling what the witnesses said', () => {
  const tags = (s: GameState, from: string, to: string) => tagsToward(s, from, to).map((t) => t.tag)

  it('begins a two-sided tag when both say it, each with their own word, on the turn of the line', () => {
    const state = played()
    const { state: next, applied, refused, alone } = settleTies(fixture, state, [said('Mara', 'tobin', { now: 'apprentice' }), said('tobin', 'Mara', { now: 'master', line: YES })])
    expect([refused, alone]).toEqual([[], []])
    expect(applied).toEqual([{ from: 'mara', to: 'tobin', added: ['hand'], ended: [], word: 'apprentice', reason: '', line: HIRE, turn: 't1' }])
    expect(tagsToward(next, 'mara', 'tobin')).toEqual([{ tag: 'foe', word: 'rival' }, { tag: 'hand', word: 'apprentice' }])
    expect(tagsToward(next, 'tobin', 'mara')).toEqual([{ tag: 'master', word: 'master' }])
    expect(next.scene!.tieEvents).toEqual(applied)
    // No reason is given in the first person, so the note on the relationship is left as it was.
    expect(next.relations.find((x) => x.from === 'mara' && x.to === 'tobin')!.note).toBe(state.relations.find((x) => x.from === 'mara' && x.to === 'tobin')!.note)
  })

  it('changes nothing when one side says it alone, or the two sides say different things (one order makes no boss)', () => {
    const one = settleTies(fixture, played(), [said('mara', 'tobin', { now: 'hand' })])
    expect(one.applied).toEqual([])
    expect(one.alone).toEqual(["Mara says Tobin is now Mara's hand; Tobin doesn't say Mara is now Tobin's master"])
    expect(tags(one.state, 'mara', 'tobin')).toEqual(['foe'])
    const two = settleTies(fixture, played(), [said('mara', 'tobin', { now: 'hand' }), said('tobin', 'mara', { now: 'older sister' })])
    expect(two.applied).toEqual([])
    expect(two.alone).toHaveLength(2)
  })

  it('refuses a statement about someone who wasn’t there, a tag that doesn’t exist, and a line that isn’t in the scene', () => {
    const { applied, refused } = settleTies(fixture, played(), [
      said('mara', 'pell', { now: 'hand' }),
      said('mara', 'tobin', { now: 'cousin' }),
      said('mara', 'tobin', { now: 'hand', line: 'You work for me now, boy.' }),
      said('mara', 'tobin', { no_longer: 'rival', line: '' }),
      said('tobin', 'mara', { now: 'master', line: YES })
    ])
    expect(applied).toEqual([])
    expect(refused).toEqual([
      'Mara, about "pell": they weren\'t someone else in the scene',
      'Mara, about Tobin: no tag "cousin"',
      'Mara, about Tobin: the line isn\'t in the scene ("You work for me now, boy.")',
      "Mara, about Tobin: the line isn't in the scene (none given)"
    ])
  })

  it('begins a one-sided tag and ends any tag on one call; an ending both report happens once', () => {
    const state = played()
    const hired = settleTies(fixture, state, [said('mara', 'tobin', { now: 'hand' }), said('tobin', 'mara', { now: 'master', line: YES })]).state
    const { state: next, applied, refused } = settleTies(fixture, hired, [
      said('tobin', 'mara', { now: 'foe', line: YES }),
      said('tobin', 'mara', { no_longer: 'master', line: YES }),
      said('mara', 'tobin', { no_longer: 'apprentice' }),
      said('mara', 'tobin', { no_longer: 'older sister' })
    ])
    expect(applied.map((e) => [e.from, e.to, e.added, e.ended])).toEqual([['tobin', 'mara', ['foe'], []], ['tobin', 'mara', [], ['master']]])
    expect(refused).toEqual(['Mara, about Tobin: mara doesn\'t hold "elder" toward tobin'])
    expect([tags(next, 'tobin', 'mara'), tags(next, 'mara', 'tobin')]).toEqual([['foe'], ['foe']])
  })

  describe('partner tags: one at a time, and an ex left behind (decided 2026-11-16)', () => {
    const partners: Pack = {
      ...fixture,
      ruleset: {
        ...fixture.ruleset,
        ties: {
          ...fixture.ruleset.ties,
          max: 3,
          groups: [...fixture.ruleset.ties.groups, { id: 'partners', name: 'Partners', oneAtATime: true }],
          tags: [
            ...fixture.ruleset.ties.tags,
            ...['partner', 'fiance'].map((id) => ({ id, group: 'partners', counterpart: id, words: [id], oneSided: false, family: false, endsAs: 'ex' })),
            { id: 'spouse', group: 'partners', counterpart: 'spouse', words: ['husband', 'wife', 'spouse'], oneSided: false, family: false, endsAs: 'ex' },
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

    it('a wedding both state ends the engagement without anyone saying so, each with their own word', () => {
      const { state, applied } = settleTies(partners, holding('fiance'), [said('mara', 'tobin', { now: 'husband' }), said('tobin', 'mara', { now: 'wife', line: YES })])
      expect(applied.map((e) => [e.added, e.ended])).toEqual([[['spouse'], ['fiance']]])
      expect([tagsToward(state, 'mara', 'tobin'), tagsToward(state, 'tobin', 'mara')]).toEqual([[{ tag: 'spouse', word: 'husband' }], [{ tag: 'spouse', word: 'wife' }]])
    })

    it('a wedding stated with its ending by both happens once, and one only one side states changes nothing: no exes', () => {
      const both = settleTies(partners, holding('fiance'), [said('mara', 'tobin', { no_longer: 'fiance', now: 'husband' }), said('tobin', 'mara', { no_longer: 'fiance', now: 'wife', line: YES })])
      expect([both.applied.map((e) => [e.added, e.ended]), both.refused]).toEqual([[[['spouse'], ['fiance']]], []])
      const one = settleTies(partners, holding('fiance'), [said('mara', 'tobin', { no_longer: 'fiance', now: 'husband' })])
      expect([one.applied, one.alone.length]).toEqual([[], 1])
      expect(tagsToward(one.state, 'mara', 'tobin')).toEqual([{ tag: 'fiance' }])
    })

    it('a breakup one of them states leaves an ex on both sides, as part of the breakup’s own event', () => {
      const { state, applied } = settleTies(partners, holding('partner'), [said('tobin', 'mara', { no_longer: 'partner', line: YES })])
      expect([tagsToward(state, 'mara', 'tobin'), tagsToward(state, 'tobin', 'mara')]).toEqual([[{ tag: 'ex' }], [{ tag: 'ex' }]])
      expect(applied.map((e) => [e.from, e.added, e.ended])).toEqual([['tobin', ['ex'], ['partner']]])
      expect(state.scene!.tieEvents).toEqual(applied)
    })

    it('ends partner when ex is stated outright by both, and leaves an ex toward the player too', () => {
      const exes = settleTies(partners, holding('partner'), [said('mara', 'tobin', { now: 'ex' }), said('tobin', 'mara', { now: 'ex', line: YES })])
      expect([tagsToward(exes.state, 'mara', 'tobin'), exes.applied.map((e) => [e.added, e.ended])]).toEqual([[{ tag: 'ex', word: 'ex' }], [[['ex'], ['partner']]]])
      const player = settleTies(partners, holding('spouse'), [said('mara', 'Kit', { no_longer: 'spouse', line: 'I’m finished here. Find another hand.' })])
      expect(tagsToward(player.state, 'mara', 'player')).toEqual([{ tag: 'ex' }])
      expect(player.applied[0]!.turn).toBe('t2')
    })
  })

  it('holds an arrangement with the player for their answer, lets a character make the player a foe on their own, and ends a tie with the player at once', () => {
    const state = played()
    const { state: next, applied, pending } = settleTies(fixture, state, [
      said('mara', 'Kit', { now: 'hand' }),
      said('tobin', 'player', { now: 'foe', line: YES }),
      said('tobin', 'player', { no_longer: 'master', line: "Mara, I'm finished here. Find another hand." })
    ])
    expect(pending).toEqual([{ from: 'mara', to: 'player', add: 'hand', word: 'hand', reason: '', line: HIRE }])
    expect(next.scene!.pendingTies).toEqual(pending)
    expect(next.playerTies['mara']).toBeUndefined()
    expect(applied.map((e) => [e.added, e.ended])).toEqual([[['foe'], []], [[], ['master']]])
    expect(next.playerTies['tobin']!.tags.map((t) => t.tag)).toEqual(['foe'])
    expect(tieQuestion(fixture, pending[0]!)).toBe("Become Mara's hand?")
    // A yes applies it and becomes a tie event, so the memory call is told and the Core memory is forced; a no is only recorded.
    const yes = answerTie(fixture, next, 0, true)
    expect(yes.playerTies['mara']).toEqual({ tags: [{ tag: 'hand', word: 'hand' }], note: undefined })
    expect(yes.scene!.tieEvents.at(-1)).toMatchObject({ from: 'mara', to: 'player', added: ['hand'], line: HIRE })
    const memories = applySummaries(fixture, yes, [{ id: 'mara', summary: plainSummary(fixture, yes, 'mara') }]).state.memories
    expect(memories.find((m) => m.owner === 'mara')).toMatchObject({ level: 'core', reason: expect.stringMatching(/relationship/) })
    const no = answerTie(fixture, next, 0, false)
    expect(no.playerTies['mara']).toBeUndefined()
    expect(no.scene!.answered).toEqual([{ ...pending[0]!, accepted: false }])
  })
})

// Milestone 5 plan, task 5 (decided 2026-11-19, user): a hire for one job makes no work tie. The fixture asks nothing
// about that, so these run on a copy whose trade tags need lasting work and say which way they run.
describe('work that lasts', () => {
  const lasting: Pack = {
    ...fixture,
    ruleset: {
      ...fixture.ruleset,
      ties: {
        ...fixture.ruleset.ties,
        tags: fixture.ruleset.ties.tags.map((t) => (t.id === 'master' ? { ...t, means: 'who {me} works for' } : t.id === 'hand' ? { ...t, means: 'who works for {me}' } : t)),
        lasting: { tags: ['master', 'hand'], words: [{ word: 'one job', lasting: false }, { word: 'for good', lasting: true }] }
      }
    }
  }
  const hire = (word?: string) => settleTies(lasting, played(), [said('mara', 'tobin', { now: 'hand', ...(word && { lasting: word }) }), said('tobin', 'mara', { now: 'master', line: YES, ...(word && { lasting: word }) })])

  it('asks whether the work goes on, and says which way each work tie runs', () => {
    const p = buildRelationshipPrompt(lasting, played(), 'mara')
    expect(p.system).toContain('"no_longer": "...", "lasting": "...", "line": "..."')
    expect(p.system).toContain('- lasting: only for a new master/hand tie, one of: one job, for good.')
    expect(p.system).toContain('Trade: master (who Mara works for), hand/apprentice (who works for Mara), foe.')
    expect(parseRelationship(lasting, JSON.stringify({ ties: [{ with: 'tobin', now: 'hand', lasting: 'for good', line: HIRE }] }))!.ties).toEqual([{ with: 'tobin', now: 'hand', lasting: 'for good', line: HIRE }])
  })

  it('begins a work tie only when both sides say it goes on', () => {
    const steady = hire('for good')
    expect(steady.refused).toEqual([])
    expect(steady.applied.map((e) => e.added)).toEqual([['hand']])
  })

  it('refuses a work tie for one job, or with nothing said about it, on each side', () => {
    expect(hire('one job')).toMatchObject({
      applied: [],
      refused: ['Mara, about Tobin: a new hand tie needs work that goes on, and it says "one job"', 'Tobin, about Mara: a new master tie needs work that goes on, and it says "one job"']
    })
    expect(hire().refused[0]).toBe('Mara, about Tobin: a new hand tie needs work that goes on, and it says nothing about that')
    expect(hire('maybe').applied).toEqual([])
  })

  it('asks nothing of a tie outside the list, or of one that ends', () => {
    const foe = settleTies(lasting, played(), [said('tobin', 'mara', { now: 'foe' })])
    expect(foe.applied.map((e) => e.added)).toEqual([['foe']])
    const ended = settleTies(lasting, played(), [said('mara', 'tobin', { no_longer: 'foe' })])
    expect(ended.refused).toEqual([])
  })
})

// Milestone 5 plan, task 5's scored run (decided 2026-11-21, user): a witness made the player a friend on the
// player's own "I'm witnessing". A tie that begins toward the player without their yes needs the scene to show it.
describe('ties toward the player, shown by the scene', () => {
  const OWN = 'Tobin, will you work for Mara?'

  it('refuse a new tie that rests only on the player’s words', () => {
    const r = settleTies(fixture, played(), [said('tobin', 'player', { now: 'foe', line: OWN })])
    expect(r.applied).toEqual([])
    expect(r.refused).toEqual([`Tobin, about Kit: a new foe tie toward the player needs the scene to show it, not the player's own words ("${OWN}")`])
  })

  it('begin one shown by a line in the scene', () => {
    expect(settleTies(fixture, played(), [said('tobin', 'player', { now: 'foe', line: YES })]).applied.map((e) => e.added)).toEqual([['foe']])
  })

  it('still end on the player’s words, and still let an arrangement wait for the player’s yes', () => {
    const state = played()
    state.playerTies['mara'] = { tags: [{ tag: 'foe' }] }
    expect(settleTies(fixture, state, [said('mara', 'player', { no_longer: 'foe', line: "Mara, I'm finished here. Find another hand." })]).applied.map((e) => e.ended)).toEqual([['foe']])
    expect(settleTies(fixture, played(), [said('mara', 'player', { now: 'hand', line: OWN })]).pending.map((p) => p.add)).toEqual(['hand'])
  })
})
