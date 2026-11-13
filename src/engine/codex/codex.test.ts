import { describe, expect, it } from 'vitest'
import { fixture, fixtureCodex } from '@tests/fixture'
import { codexProblems, codexWarnings, LORE_LINE_WORDS, type CodexContext } from './checks'
import { buildCodex, entryById, idFromPath, locationChain, type CodexFile } from './load'
import { parseSelector } from './schema'

const ctx = (over: Partial<CodexContext> = {}): CodexContext => ({
  setting: fixture.setting,
  characterIds: fixture.characters.map((c) => c.id),
  locations: fixture.locations,
  fullWords: fixture.ruleset.codex.fullWords,
  stanceWarnings: fixture.vocabulary.stanceWarnings,
  ...over
})
const entry = (path: string, header: string, body = 'Some text.'): CodexFile => ({ path, text: `---\n${header.trim()}\n---\n${body}\n` })
/** The fixture's codex plus some files, and every problem they give. */
function problemsWith(...files: CodexFile[]): string[] {
  const built = buildCodex([...fixtureCodex(), ...files])
  return [...built.problems, ...codexProblems(built.entries, ctx())]
}

describe('ids from paths', () => {
  it('names the kind by folder, adds a part per folder, and lets main.md take its folder’s id', () => {
    expect(idFromPath('factions/guild/main.md')).toMatchObject({ id: 'faction.guild', isMain: true })
    expect(idFromPath('factions/guild/tallies.md')).toMatchObject({ id: 'faction.guild.tallies', isMain: false })
    expect(idFromPath('locations/lower/east-gate/the-yard.md')).toMatchObject({ id: 'location.lower.east-gate.the-yard' })
    expect(idFromPath('concepts/pennies.md')).toMatchObject({ id: 'concept.pennies' })
  })

  it('refuses paths that can’t give a valid id', () => {
    expect(idFromPath('notes/x.md')).toMatch(/isn't a codex folder/)
    expect(idFromPath('concepts/Pennies.md')).toMatch(/isn't a valid id part/)
    expect(idFromPath('concepts/main.md')).toMatch(/must sit inside a folder/)
    expect(idFromPath('concepts/pennies.txt')).toMatch(/\.md files/)
  })
})

describe('the fixture codex', () => {
  it('loads without problems or warnings', () => {
    expect(fixture.codex.length).toBeGreaterThan(10)
    expect(codexWarnings(fixture.codex, ctx())).toEqual([])
  })

  it('reads each place’s map chain from its id: place, region, tier', () => {
    expect(locationChain(fixture.codex, 'location.lower.east-gate.the-yard').map((e) => [e.id, e.layer])).toEqual([
      ['location.lower.east-gate.the-yard', 3],
      ['location.lower.east-gate', 2],
      ['location.lower', 1]
    ])
  })

  it('gives circles entries their faction at member and above when no circle is written, and secrets only the director', () => {
    expect(entryById(fixture.codex, 'faction.guild.tallies')).toMatchObject({ faction: 'guild', circle: { by: 'faction', faction: 'guild', level: 'member' }, also: [{ by: 'occupation', occupation: 'porter' }] })
    expect(entryById(fixture.codex, 'faction.guild.night-shift.back-door')?.circle).toEqual({ by: 'faction', faction: 'night-shift', level: 'member' })
    expect(entryById(fixture.codex, 'faction.guild.second-ledger')).toMatchObject({ audience: ['director'], cap: 2, knownBy: [{ by: 'faction', faction: 'guild', level: 'trusted' }, { by: 'character', character: 'mara' }] })
  })
})

describe('titles and labels (milestone 3.5, task 2)', () => {
  it('reads a title for every entry and a label only where the thing has an in-world name', () => {
    expect(entryById(fixture.codex, 'faction.guild')).toMatchObject({ title: 'The Guild', label: 'The Guild', aliases: ['the hall'] })
    expect(entryById(fixture.codex, 'faction.guild.tallies')?.title).toBe('How the tallies work')
    expect(entryById(fixture.codex, 'faction.guild.tallies')?.label).toBeUndefined()
  })

  it('needs a nonblank title', () => {
    // The header reader turns a blank value away first, with its line.
    expect(problemsWith(entry('concepts/blank.md', 'title:  \nkind: concept\nsummary: x'))).toContain('codex/concepts/blank.md: line 2: a key with no value')
    expect(problemsWith(entry('concepts/quoted.md', 'title: " "\nkind: concept\nsummary: x')).some((p) => p.startsWith('codex/concepts/quoted.md: title:'))).toBe(true)
    expect(problemsWith(entry('concepts/none.md', 'kind: concept\nsummary: x')).some((p) => p.startsWith('codex/concepts/none.md: title:'))).toBe(true)
    expect(problemsWith(entry('concepts/old.md', 'name: Old\nkind: concept\nsummary: x')).some((p) => p.startsWith('codex/concepts/old.md: header:'))).toBe(true)
  })

  it('files what happened, how things are and what’s going on now in their own folders (task 3)', () => {
    expect(idFromPath('history/the-flood.md')).toMatchObject({ id: 'history.the-flood' })
    expect(idFromPath('background/the-fog.md')).toMatchObject({ id: 'background.the-fog' })
    expect(idFromPath('current/the-strike.md')).toMatchObject({ id: 'current.the-strike' })
    expect(idFromPath('world/old.md')).toMatch(/"world" isn't a codex folder/)
    expect(idFromPath('events/old.md')).toMatch(/"events" isn't a codex folder/)
    expect(problemsWith(entry('history/fog.md', 'title: Fog\nkind: background\nsummary: x'))).toContain("codex/history/fog.md: a background entry can't go in history/ (expected history)")
    expect(problemsWith(entry('history/flood.md', 'title: The flood\nkind: history\nsummary: x\nrelated: [location.nowhere]'))).toContain('codex/history/flood.md: "related" names unknown entry "location.nowhere"')
  })

  it('refuses aliases without a label', () => {
    expect(problemsWith(entry('concepts/fog.md', 'title: How the fog rolls in\nkind: concept\naliases: [the murk]\nsummary: x'))).toContain(
      'codex/concepts/fog.md: aliases are other names for its label, so an entry with aliases needs a label'
    )
  })

  it('keeps labels and aliases unique across the codex, inside a faction’s folder too, ignoring case and a leading "the"', () => {
    expect(problemsWith(entry('factions/guild/fees.md', 'title: Guild fees\nlabel: Hall\nkind: faction\nsummary: x'))).toContain(
      'codex/factions/guild/main.md: its label or alias "hall" is also a label or alias of factions/guild/fees.md'
    )
    // A title or keyword may repeat a related entry's name; only names must be unique.
    expect(problemsWith(entry('factions/guild/fees.md', 'title: The hall fees\nkind: faction\nkeywords: [the hall]\nsummary: x'))).toEqual([])
  })
})

describe('selectors', () => {
  it('read factions with an optional level, and occupations, tiers, species and characters', () => {
    expect(parseSelector('guild')).toEqual({ by: 'faction', faction: 'guild', level: 'member' })
    expect(parseSelector('faction guild affiliated+')).toEqual({ by: 'faction', faction: 'guild', level: 'affiliated' })
    expect(parseSelector('occupation Night Porter')).toEqual({ by: 'occupation', occupation: 'night porter' })
    expect(parseSelector('guild boss+')).toMatch(/isn't a level/)
  })
})

describe('content checks', () => {
  it('report the file and line of a header outside the subset, and fields the schema doesn’t know', () => {
    expect(problemsWith({ path: 'concepts/bad.md', text: '---\ntitle: Bad\n  indented: x\n---\nText' })).toContain('codex/concepts/bad.md: line 3: indented lines aren’t allowed (no nesting or multi-line values)')
    expect(problemsWith(entry('concepts/bad.md', 'title: Bad\nkind: concept\nsummary: x\ncolour: red')).some((p) => p.startsWith('codex/concepts/bad.md: header:'))).toBe(true)
  })

  it('catch a kind in the wrong folder, and two files giving one id', () => {
    expect(problemsWith(entry('concepts/odd.md', 'title: Odd\nkind: faction\nsummary: x'))).toContain('codex/concepts/odd.md: a faction entry can\'t go in concepts/ (expected concept)')
    expect(problemsWith(entry('concepts/pennies/main.md', 'title: Coins\nkind: concept\nsummary: x'))).toContain('codex/concepts/pennies/main.md: gives the same id as concepts/pennies.md (concept.pennies)')
  })

  it('catch keywords and names shared by unrelated entries, but not within a faction’s folder', () => {
    const p = problemsWith(entry('concepts/tolls.md', 'title: Tolls\nkind: concept\nkeywords: [pennies]\nsummary: x'), entry('concepts/hall.md', 'title: The Hall\nlabel: The Hall\nkind: concept\naliases: [the hall]\nsummary: x'))
    expect(p).toContain('codex/concepts/tolls.md: its keyword or title "pennies" is also used by unrelated concepts/pennies.md')
    expect(p).toContain('codex/factions/guild/main.md: its label or alias "hall" is also a label or alias of concepts/hall.md')
    expect(problemsWith(entry('factions/guild/fees.md', 'title: Fees\nkind: faction\nkeywords: [tally]\nsummary: x'))).toEqual([])
  })

  it('catch text over the ruleset’s word cap', () => {
    expect(problemsWith(entry('concepts/long.md', 'title: Long\nkind: concept\nsummary: x', 'word '.repeat(fixture.ruleset.codex.fullWords + 1)))).toContain(`codex/concepts/long.md: its text is ${fixture.ruleset.codex.fullWords + 1} words; the most is ${fixture.ruleset.codex.fullWords}`)
    expect(problemsWith(entry('concepts/wordy.md', `title: Wordy\nkind: concept\nsummary: ${'word '.repeat(LORE_LINE_WORDS + 1).trim()}`, 'Short.'))).toContain(`codex/concepts/wordy.md: its summary is ${LORE_LINE_WORDS + 1} words; the most is ${LORE_LINE_WORDS}, since it stands in for a lore line that runs long`)
  })

  it('keep secrets from the writer, and stage lines on common top-level entries', () => {
    const p = problemsWith(
      entry('factions/guild/leak.md', 'title: Leak\nkind: faction\nsummary: x\nknowledge: secret\nknown-by: [guild]\naudience: [director, writer]'),
      entry('factions/guild/inner.md', 'title: Inner\nkind: faction\nsummary: x\nknowledge: circles\nstage: Everyone knows.'),
      entry('factions/guild/night-shift/crew.md', 'title: Crew\nkind: faction\nsummary: x\nstage: A line.')
    )
    expect(p).toContain('codex/factions/guild/leak.md: a secret entry can’t have the writer in its audience')
    expect(p).toContain('codex/factions/guild/inner.md: only common entries have a stage line')
    expect(p).toContain('codex/factions/guild/night-shift/crew.md: only a top-level faction’s main entry has a stage line')
  })

  it('keep circle and also to circles entries, known-by to secrets, and need someone to know each', () => {
    const p = problemsWith(
      entry('factions/guild/open.md', 'title: Open\nkind: faction\nsummary: x\nalso: [occupation porter]'),
      entry('factions/guild/hush.md', 'title: Hush\nkind: faction\nsummary: x\nknowledge: secret'),
      entry('concepts/inside.md', 'title: Inside\nkind: concept\nsummary: x\nknowledge: circles')
    )
    expect(p).toContain('codex/factions/guild/open.md: "circle" and "also" are for circles entries only (secrets use "known-by")')
    expect(p).toContain('codex/factions/guild/hush.md: a secret entry needs "known-by": who may hold it')
    expect(p).toContain('codex/concepts/inside.md: a circles entry outside a faction needs a "circle" or "also" saying who’s inside')
  })

  it('catch selectors and related ids naming things that don’t exist', () => {
    const p = problemsWith(entry('concepts/inside.md', 'title: Inside\nkind: concept\nsummary: x\nknowledge: circles\ncircle: navy trusted+\nalso: [character nobody, tier sky, species dragon]\nrelated: [concept.nothing]'))
    expect(p).toEqual(
      expect.arrayContaining([
        'codex/concepts/inside.md: "navy trusted+" names unknown faction "navy"',
        'codex/concepts/inside.md: "character nobody" names unknown character "nobody"',
        'codex/concepts/inside.md: "tier sky" names unknown tier "sky"',
        'codex/concepts/inside.md: "species dragon" names unknown species "dragon"',
        'codex/concepts/inside.md: "related" names unknown entry "concept.nothing"'
      ])
    )
  })

  it('keep the map tree to the setting’s tiers, three layers, with every layer above written', () => {
    const p = problemsWith(entry('locations/sky/main.md', 'title: Sky\nkind: location\nsummary: x'), entry('locations/upper/hill/house/attic.md', 'title: Attic\nkind: location\nsummary: x'))
    expect(p).toContain('codex/locations/sky/main.md: "sky" isn\'t one of the setting\'s tiers')
    expect(p).toContain('codex/locations/upper/hill/house/attic.md: locations go 3 layers deep at most (tier, region, place)')
    expect(p).toContain('codex/locations/upper/hill/house/attic.md: its parent "location.upper.hill" has no entry (add upper/hill/main.md)')
  })

  it('keep faction folders to the setting’s sub-groups', () => {
    expect(problemsWith(entry('factions/night-shift/main.md', 'title: Night Shift again\nkind: faction\nsummary: x'))).toContain("codex/factions/night-shift/main.md: faction folders must follow the setting's sub-groups: expected factions/guild/night-shift/")
    expect(problemsWith(entry('factions/navy/main.md', 'title: Navy\nkind: faction\nsummary: x'))).toContain('codex/factions/navy/main.md: "navy" isn\'t one of the setting\'s factions')
  })

  it('check a location file’s parent is a region under its tier', () => {
    const yard = fixture.locations[0]!
    const check = (parent: string, tier = yard.tier) => codexProblems(fixture.codex, ctx({ locations: [{ ...yard, tier, parent }] }))
    expect(check('location.lower.east-gate')).toEqual([])
    expect(check('location.lower')).toEqual(['locations/the-yard.json: parent "location.lower" must be a region (layer 2)'])
    expect(check('location.lower.east-gate', 'upper')).toEqual(['locations/the-yard.json: parent "location.lower.east-gate" isn\'t under its tier "upper"'])
    expect(check('location.nowhere')).toEqual(['locations/the-yard.json: parent "location.nowhere" isn\'t a codex location'])
  })

  it('warn about stance words in codex text', () => {
    const built = buildCodex([entry('concepts/old.md', 'title: Old\nkind: concept\nsummary: x', 'The guild and the watch have a long feud.')])
    expect(codexWarnings(built.entries, ctx())).toEqual(['codex/concepts/old.md: says "feud"; stances belong in setting data'])
  })
})
