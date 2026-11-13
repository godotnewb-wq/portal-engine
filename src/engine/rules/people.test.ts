import { describe, expect, it } from 'vitest'
import { fixture } from '@tests/fixture'
import { peopleProblems, rungIndex, type PeopleRules, type TiesRules } from './people'

const P = fixture.ruleset.people
const T = fixture.ruleset.ties
const meters = fixture.ruleset.meters.list.map((m) => m.id)

// Milestone 4a, task 4: the vocabularies a pack describes people in, checked against themselves.
describe('peopleProblems', () => {
  it('accepts the fixture’s vocabularies', () => {
    expect(peopleProblems(P, T, meters)).toEqual([])
  })

  it('needs a ladder from no requirement, rising, to blocked', () => {
    const ladder: PeopleRules['ladder'] = [
      { word: 'cool', min: -4, blocked: false },
      { word: 'fond', min: 5, blocked: false },
      { word: 'fair', min: 1, blocked: false },
      { word: 'any', blocked: false }
    ]
    expect(peopleProblems({ ...P, ladder }, T, meters)).toEqual([
      'the ladder must start with a rung that has no requirement',
      'the ladder must end with a blocked rung',
      'ladder rung "fair" must ask more than the one before'
    ])
  })

  it('checks gate words, motive floors and links against the ladder, meters, axes and values', () => {
    const p: PeopleRules = {
      ...P,
      gates: { assist: { trust: 'fair', bond: 'warmish' } },
      motives: { ...P.motives, types: [{ id: 'coin', floors: { bond: 'lots' }, shiftsAssist: true }] },
      links: [
        { axis: 'grit', stage: 'mushy', action: 'recruit', meter: 'bond', shift: 1 },
        { value: 'fame', strength: 'much', action: 'recruit', meter: 'bond', shift: 1 }
      ]
    }
    expect(peopleProblems(p, T, meters)).toEqual([
      'gates.assist names unknown meter "trust"',
      'gates.assist uses "warmish", which isn\'t on the ladder',
      'motive "coin"\'s floors uses "lots", which isn\'t on the ladder',
      'link 1 names "mushy", not a stage of "grit"',
      'link 2 names unknown value "fame"'
    ])
  })

  it('checks shades against the families and the 1–5 scale, and masking against its axis', () => {
    const p: PeopleRules = {
      ...P,
      emotions: { ...P.emotions, shades: [...P.emotions.shades, { word: 'wistful', families: ['blue'], intensity: [4, 2] }] },
      masking: { ...P.masking, byStage: { open: 'bare', level: 'thinnish' } }
    }
    expect(peopleProblems(p, T, meters)).toEqual([
      'shade "wistful" names unknown family "blue"',
      'shade "wistful" needs a typical intensity within 1–5, low first',
      'masking.byStage has no level for "closed"',
      'masking.byStage gives "level" the unknown level "thinnish"'
    ])
  })

  it('needs every tag’s counterpart to point back, with the same one-sided and family flags', () => {
    const t: TiesRules = {
      ...T,
      tags: [
        ...T.tags.filter((x) => x.id !== 'hand'),
        { id: 'hand', group: 'trade', counterpart: 'elder', words: ['hand'], oneSided: false, family: false },
        { id: 'pal', group: 'mates', counterpart: 'chum', words: ['pal'], oneSided: false, family: false }
      ]
    }
    expect(peopleProblems(P, t, meters)).toEqual([
      'tag "master"\'s counterpart "hand" doesn\'t point back to it',
      'tag "hand"\'s counterpart "elder" doesn\'t point back to it',
      'tag "pal" is in unknown group "mates"',
      'tag "pal" has unknown counterpart "chum"'
    ])
  })

  it('finds a rung by its word, 0 being no requirement', () => {
    expect(rungIndex(P, 'any')).toBe(0)
    expect(rungIndex(P, 'fond')).toBe(3)
    expect(rungIndex(P, 'nope')).toBe(4)
  })
})
