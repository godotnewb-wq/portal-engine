import { describe, expect, it } from 'vitest'
import { rulesetProblems, RulesetSchema } from '@engine/rules'
import { fixture } from '@tests/fixture'
import { buildPack, packProblems, type PackFiles } from './content'
import { ENGINE_VERSION, satisfies } from './manifest'

/** The fixture pack's files again, as plain data, to break one thing at a time. */
function files(): PackFiles {
  const { manifest, ruleset, setting, primer, tone, phrases, player, characters, locations } = structuredClone(fixture)
  return {
    manifest,
    ruleset,
    setting,
    primer,
    tone,
    phrases,
    player,
    characters: characters.map((data) => ({ file: `${data.id}.json`, data })),
    locations: locations.map((data) => ({ file: `${data.id}.json`, data }))
  }
}
const problemsOf = (f: PackFiles) => {
  const built = buildPack(f)
  return built.ok ? [] : built.problems
}

describe('satisfies (engine version ranges)', () => {
  it('reads caret, comparator, exact and any ranges', () => {
    expect(satisfies('0.2.0', '^0.2.0')).toBe(true)
    expect(satisfies('0.3.0', '^0.2.0')).toBe(false)
    expect(satisfies('1.4.2', '^1.0.0')).toBe(true)
    expect(satisfies('2.0.0', '^1.0.0')).toBe(false)
    expect(satisfies('0.2.5', '>=0.2.0 <1.0.0')).toBe(true)
    expect(satisfies('1.0.0', '>=0.2.0 <1.0.0')).toBe(false)
    expect(satisfies('0.2.0', '0.2.0')).toBe(true)
    expect(satisfies('9.9.9', '*')).toBe(true)
    expect(satisfies(ENGINE_VERSION, fixture.manifest.engine)).toBe(true)
  })
})

describe('buildPack', () => {
  it('builds the fixture pack', () => {
    expect(buildPack(files()).ok).toBe(true)
  })

  it('names the file and field that doesn’t fit its schema, and keeps the manifest', () => {
    const f = files()
    f.characters[0]!.data = { ...(f.characters[0]!.data as object), voice: undefined }
    const built = buildPack(f)
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.problems).toContain('characters/mara.json: voice: Invalid input: expected object, received undefined')
    expect(built.manifest?.id).toBe('test-fixture')
  })

  it('checks content against the ruleset’s skills, attributes and meters, and the setting’s tiers, species and factions', () => {
    const f = files()
    const mara = f.characters.find((c) => c.file === 'mara.json')!.data as Record<string, unknown> & { stats: { skills: object; attributes: object } }
    mara['species'] = 'dragon'
    mara['faction'] = 'navy'
    mara['meters'] = { warmth: 10, bond: 8, lust: 1 }
    mara.stats.skills = { notice: 1, empathy: 1 }
    mara.stats.attributes = { brawn: 3, wits: 11 }
    ;(f.locations[0]!.data as { tier: string }).tier = 'middle'
    expect(problemsOf(f)).toEqual(
      expect.arrayContaining([
        'mara is of unknown species "dragon"',
        'mara belongs to unknown faction "navy"',
        'mara has unknown meter "lust"',
        'mara has unknown skill "empathy"',
        'mara has no "nerve" attribute',
        'mara\'s wits 11 is outside 1–10',
        'the-yard is in unknown tier "middle"'
      ])
    )
  })

  it('holds ranks to the ruleset’s cap for the level', () => {
    const f = files()
    ;(f.player as { stats: { skills: Record<string, number> } }).stats.skills = { talk: 2 }
    expect(problemsOf(f)).toContain('the player\'s talk rank 2 is above the cap for level 1')
  })

  it('refuses a pack for another engine, an opening scene that can’t start, and a missing primer', () => {
    const f = files()
    f.manifest = { ...(f.manifest as object), engine: '^5.0.0', start: { location: 'nowhere', cast: ['ghost'] } }
    f.primer = ''
    expect(problemsOf(f)).toEqual(expect.arrayContaining([`pack.json: needs engine ^5.0.0; this is ${ENGINE_VERSION}`, 'setting/primer.md: missing or empty']))
    const g = files()
    g.manifest = { ...(g.manifest as object), start: { location: 'nowhere', cast: ['ghost'] } }
    expect(problemsOf(g)).toEqual(
      expect.arrayContaining(['pack.json: the opening scene is at unknown location "nowhere"', 'pack.json: the opening cast names unknown character "ghost"'])
    )
  })

  it('finds problems inside a ruleset: references between its own lists', () => {
    const r = RulesetSchema.parse({ ...structuredClone(fixture.ruleset), assists: { ...fixture.ruleset.assists, meter: 'love' } })
    r.skills.push({ id: 'cook', name: 'Cook', attribute: 'taste', description: '' })
    r.wordScale = r.wordScale.filter((w) => w.value !== 0)
    expect(rulesetProblems(r)).toEqual(['skill "cook" uses unknown attribute "taste"', 'assists use unknown meter "love"', 'the word scale needs a word worth 0 (no change)'])
  })

  it('reports duplicate ids and relations to nobody across files', () => {
    const mara = fixture.characters[0]!
    expect(packProblems({ ...fixture, characters: [...fixture.characters, mara, { ...mara, id: 'ghost', relations: [{ to: 'nobody', label: 'x', meters: mara.meters }] }] })).toEqual(
      expect.arrayContaining(['character id "mara" is used twice', 'ghost has a relation to unknown character "nobody"'])
    )
  })
})
