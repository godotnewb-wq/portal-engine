import { describe, expect, it } from 'vitest'
import { fixture } from '@tests/fixture'
import type { Character } from '@engine/characters'
import { cardProblems, cardWarnings, hauntsOverlap, tieProblems } from './cards'
import { characterById } from './content'

const R = fixture.ruleset
const mara = characterById(fixture, 'mara')!
const tobin = characterById(fixture, 'tobin')!
const check = (c: Partial<Character>) => cardProblems(R, fixture.codex, { ...mara, ...c } as Character)
const haunt = (from: string, to: string, days?: 'weekdays' | 'weekends' | string[]) => ({ location: 'location.upper', from, to, note: 'x', ...(days && { days }) })

// Milestone 4a, task 4: the full card's fields are checked against the ruleset's vocabularies.
describe('cardProblems', () => {
  it('accepts the fixture’s complete cards', () => {
    expect(cardProblems(R, fixture.codex, mara)).toEqual([])
    expect(cardProblems(R, fixture.codex, tobin)).toEqual([])
  })

  it('checks age, layers and growth words against the ruleset', () => {
    expect(
      check({
        age: 'ancient',
        layers: { axes: { grit: 'squishy', nerve: 'bold' }, attachment: {}, values: [{ value: 'fame', strength: 'lots', stance: 'likes' }], foundations: { law: 'adores' } },
        malleability: 'bendy',
        fieldLocks: { guard: 'welded', mood: 'shut' }
      })
    ).toEqual([
      'mara: age "ancient" isn\'t one of: young, grown, old',
      'mara: Grit "squishy" isn\'t one of: soft, steady, hard',
      'mara: layers.axes names unknown axis "nerve"',
      'mara: value "fame" isn\'t one of: order, gain, kin',
      'mara: strength of "fame" "lots" isn\'t one of: some, much',
      'mara: sensitivity for "law" "adores" isn\'t one of: shrugs, minds, rages',
      'mara: malleability "bendy" isn\'t one of: set, loose',
      'mara: lock on "guard" "welded" isn\'t one of: open, shut',
      'mara: locked field "mood" isn\'t one of: grit, guard, reach, values, foundations, malleability'
    ])
  })

  it('keeps masking and display lines to the non-mood families and listed shades', () => {
    expect(check({ expression: { masking: { startled: 'thick', sad: 'opaque' }, display: { glad: 'beams' }, shades: { moody: 'sulks' } } })).toEqual([
      'mara: masked family "startled" isn\'t one of: sad, mad',
      'mara: masking for "sad" "opaque" isn\'t one of: bare, thin, thick',
      'mara: display family "glad" isn\'t one of: sad, mad',
      'mara: display shade "moody" isn\'t one of: glum, sore, livid, jolted'
    ])
  })

  it('checks gates, blockers and disclosure minimums against the actions, meters and ladder', () => {
    const secret = { ...mara.secrets[0]!, disclose: { bond: 'besties', trust: 'fair' } }
    expect(check({ gates: { assist: { base: { bond: 'warm' } }, flirt: {} }, blockers: [{ action: 'marry', reason: 'x' }], secrets: [secret] })).toEqual([
      'mara: gates.assist.base\'s bond "warm" isn\'t one of: any, cool, fair, fond, nope',
      'mara: gated action "flirt" isn\'t one of: assist, recruit, warning, leave, bond',
      'mara: blocked action "marry" isn\'t one of: assist, recruit, warning, leave, bond',
      'mara: secret "two-books"\'s disclose\'s bond "besties" isn\'t one of: any, cool, fair, fond, nope',
      'mara: secret "two-books"\'s disclose names unknown meter "trust"'
    ])
  })

  it('holds motives to the types, strengths and limit, and merges same-type motives with the same evidence', () => {
    const m = (type: string, evidence: string, strength = 'firm') => ({ type, strength, evidence, reason: 'r' })
    expect(check({ motives: [m('coin', 'contract'), m('coin', 'contract', 'slight'), m('grudge', 'x', 'huge')] })).toEqual([
      'mara: motive type "grudge" isn\'t one of: oath, coin, threat',
      'mara: strength of the grudge motive "huge" isn\'t one of: slight, firm',
      'mara: 3 motives; at most 2',
      'mara: two coin motives with the same evidence "contract" are one motive'
    ])
    expect(check({ motives: [m('coin', 'contract'), m('coin', 'the debt')] })).toEqual([])
  })

  it('needs haunts at codex locations, on real days, without overlaps', () => {
    expect(check({ haunts: [{ ...haunt('09:00', '12:00'), location: 'location.nowhere' }, haunt('11:00', '13:00'), haunt('20:00', '20:00', ['funday'])] })).toEqual([
      'mara: haunt 1 is at "location.nowhere", which isn\'t a codex location',
      'mara: haunt 3 starts and ends at 20:00',
      'mara: haunt 3 names unknown day "funday"',
      'mara: haunts 1 and 2 overlap'
    ])
  })
})

describe('hauntsOverlap', () => {
  it('needs a shared day and overlapping hours', () => {
    expect(hauntsOverlap(haunt('08:00', '12:00'), haunt('12:00', '16:00'))).toBe(false)
    expect(hauntsOverlap(haunt('08:00', '12:00', 'weekdays'), haunt('10:00', '14:00', 'weekends'))).toBe(false)
    expect(hauntsOverlap(haunt('08:00', '12:00', ['monday']), haunt('10:00', '14:00', 'weekdays'))).toBe(true)
  })

  it('carries a window past midnight into the next day', () => {
    expect(hauntsOverlap(haunt('22:00', '02:00', ['friday']), haunt('01:00', '03:00', ['saturday']))).toBe(true)
    expect(hauntsOverlap(haunt('22:00', '02:00', ['friday']), haunt('01:00', '03:00', ['friday']))).toBe(false)
    expect(hauntsOverlap(haunt('22:00', '02:00', ['sunday']), haunt('01:00', '03:00', ['monday']))).toBe(true)
  })
})

describe('cardWarnings', () => {
  it('is silent for cards complete for their tier', () => {
    expect(cardWarnings(R, mara)).toEqual([])
    expect(cardWarnings(R, tobin)).toEqual([])
  })

  it('names what a card lacks for its tier’s form', () => {
    const bare = { ...mara, age: undefined, malleability: undefined, haunts: [], tells: [], layers: undefined, expression: undefined, voice: { ...mara.voice, shifts: { ...mara.voice.shifts, afraid: undefined } } } as Character
    expect(cardWarnings(R, bare)).toEqual([
      'mara has no age stage',
      'mara has no malleability',
      "mara's voice card has no afraid shift",
      'mara (major) lists 0 haunts; the form expects 1–2',
      'mara (major) lists 0 tells; the form expects 1–2',
      'mara (major) lists 0 personality axes; the form expects 2',
      'mara (major) lists 0 values; the form expects 1–2',
      'mara (major) has no Reach stage',
      'mara (major) has no Harm sensitivity',
      'mara (major) has no Law sensitivity',
      'mara has no display line for sad, mad'
    ])
  })
})

describe('tieProblems', () => {
  const cast = fixture.characters
  const withTies = (maraTags: { tag: string }[], tobinRelations: Character['relations'] = []) =>
    tieProblems(R, cast.map((c) => (c.id === 'mara' ? { ...c, relations: [{ ...c.relations[0]!, tags: maraTags }] } : { ...c, relations: tobinRelations })))

  it('accepts the fixture: a one-sided tag needs no counterpart, and tags toward the player aren’t mirrored', () => {
    expect(tieProblems(R, cast)).toEqual([])
  })

  it('allows only listed tags, up to the limit, each once', () => {
    expect(withTies([{ tag: 'foe' }, { tag: 'foe' }, { tag: 'pal' }])).toEqual([
      'mara toward tobin uses unknown tag "pal"',
      'mara toward tobin holds 3 tags; at most 2',
      'mara toward tobin holds "foe" twice'
    ])
  })

  it('needs a mirrored counterpart for every tag that isn’t one-sided', () => {
    expect(withTies([{ tag: 'master' }])).toEqual(['mara holds "master" toward tobin, who doesn\'t hold "hand" back'])
    expect(withTies([{ tag: 'master' }], [{ to: 'mara', tags: [{ tag: 'hand' }], note: 'x', meters: tobin.meters }])).toEqual([])
    expect(withTies([{ tag: 'elder' }], [{ to: 'mara', tags: [{ tag: 'elder' }], note: 'x', meters: tobin.meters }])).toEqual([
      'mara holds "elder" toward tobin, who doesn\'t hold "younger" back',
      'tobin holds "elder" toward mara, who doesn\'t hold "younger" back'
    ])
  })
})
