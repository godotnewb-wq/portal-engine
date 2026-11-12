import { describe, expect, it } from 'vitest'
import { fixture, fixtureCodex } from '@tests/fixture'
import { buildCodex } from './load'
import { canonNames, codexFactionId, directorStage, loreLayers, stanceLines, triggeredEntries, writerStage, type LoreScene } from './layers'

const budget = { sceneTokens: fixture.ruleset.codex.sceneTokens, triggeredTokens: fixture.ruleset.codex.triggeredTokens }
const yard: LoreScene = {
  location: { id: 'the-yard', parent: 'location.lower.east-gate' },
  present: [{ id: 'mara', name: 'Mara Quill', species: 'person', faction: 'guild', level: 'trusted', occupation: 'clerk', holds: [] }],
  texts: [],
  ignore: ['Mara Quill', 'Mara', 'Tobin']
}
const ids = (entries: { id: string }[]) => entries.map((e) => e.id)

describe('the stage', () => {
  it('is the primer, then every common stage line in a fixed order: background, history, places, peoples, worldviews, factions, concepts, current', () => {
    const stage = directorStage(fixture.primer, fixture.codex, fixture.setting)
    expect(stage.text.startsWith(fixture.primer)).toBe(true)
    expect(stage.ids).toEqual(['location.upper', 'location.lower', 'faction.guild', 'faction.watch', 'concept.pennies'])
    expect(stage.text).not.toContain('Night Shift')
    expect(directorStage(fixture.primer, [], fixture.setting).text).toBe(fixture.primer)
  })

  it('gives the writer the tone and the names it may use, and no titles or secrets', () => {
    expect(canonNames(fixture.codex)).toEqual(expect.arrayContaining(['The Guild', 'the hall', 'The Night Shift', 'The Guild Yard', 'East Gate']))
    expect(canonNames(fixture.codex)).not.toContain('How the tallies work')
    expect(canonNames(fixture.codex)).not.toContain('The second ledger')
    expect(writerStage(fixture.tone, fixture.codex).text).toMatch(/^Tone:\nPlain and brisk\.\n\nNames in this world/)
  })
})

/** The fixture's codex plus some entries written here. */
const withEntries = (...files: [string, string][]) =>
  buildCodex([...fixtureCodex(), ...files.map(([path, header]) => ({ path, text: `---\n${header}\n---\nSome text.\n` }))]).entries

describe('names come from labels (milestone 3.5, task 2)', () => {
  const codex = withEntries(
    ['concepts/fog.md', 'title: How the fog rolls in\nlabel: The Grey\nkind: concept\nkeywords: [Tally Desk]\nsummary: x'],
    ['concepts/ropes.md', 'title: Rope work\nkind: concept\nsummary: x'],
    ['concepts/hush.md', 'title: The hush\nlabel: The Hush Room\nkind: concept\nknowledge: circles\nalso: [occupation porter]\nsummary: x']
  )

  it('gives the writer only common labels and their aliases, whatever the kind; never titles or keywords', () => {
    const names = canonNames(codex)
    expect(names).toEqual(expect.arrayContaining(['The Grey', 'The Guild', 'the hall', 'Pennies']))
    for (const not of ['How the fog rolls in', 'Rope work', 'Tally Desk', 'The Hush Room', 'Automaton culture']) expect(names).not.toContain(not)
  })

  it('lets a title trigger its entry, with or without a label', () => {
    expect(ids(triggeredEntries(codex, ['so that’s how the fog rolls in'], []))).toContain('concept.fog')
    expect(ids(triggeredEntries(codex, ['any rope work today?'], []))).toContain('concept.ropes')
    expect(ids(triggeredEntries(codex, ['the grey again'], []))).toContain('concept.fog')
  })

  it('matches a one-word label only as written in model text, but a title that is no label in any case', () => {
    const one = withEntries(['concepts/ropes.md', 'title: Ropes\nkind: concept\nsummary: x'], ['concepts/fog.md', 'title: Grey\nlabel: Grey\nkind: concept\nsummary: x'])
    expect(ids(triggeredEntries(one, [], [], ['a grey morning']))).not.toContain('concept.fog')
    expect(ids(triggeredEntries(one, [], [], ['the Grey came down']))).toContain('concept.fog')
    expect(ids(triggeredEntries(one, [], [], ['coils of ropes']))).toContain('concept.ropes')
  })
})

describe('history, background and current (milestone 3.5, task 3)', () => {
  const body = (what: string) => `${what} `.repeat(40).trim()
  const files = (...more: [string, string, string][]) =>
    buildCodex([...fixtureCodex(), ...more.map(([path, header, text]) => ({ path, text: `---\n${header}\n---\n${text}\n` }))]).entries
  const codex = files(
    ['background/the-fog.md', 'title: The fog\nkind: background\nkeywords: [fog]\nsummary: Fog lies over the ward.\nstage: Fog lies over the ward.', body('Fog lies over the ward.')],
    ['history/the-flood.md', 'title: The flood\nkind: history\nkeywords: [fog]\nsummary: The ward flooded long ago.\nstage: The ward flooded long ago.\nrelated: [location.lower]', body('The ward flooded about ninety years ago.')],
    ['current/the-strike.md', 'title: The strike\nkind: current\nkeywords: [fog]\nsummary: The porters are on strike.\nstage: The porters are on strike.', body('The porters are on strike this week.')]
  )

  it('puts how things are and what happened first on the stage, and what’s going on now last', () => {
    const stage = directorStage(fixture.primer, codex, fixture.setting).ids
    expect(stage.slice(0, 2)).toEqual(['background.the-fog', 'history.the-flood'])
    expect(stage.at(-1)).toBe('current.the-strike')
  })

  it('lists what’s going on now before history, and history before background, in a layer', () => {
    const { triggered } = loreLayers(codex, fixture.setting, { ...yard, texts: ['the fog again'] }, { ...budget, triggeredTokens: 100_000 })
    const order = ids(triggered.entries).filter((id) => /^(current|history|background)\./.test(id))
    expect(order).toEqual(['current.the-strike', 'history.the-flood', 'background.the-fog'])
  })

  it('gives way under budget pressure: background first, then history, then what’s going on now', () => {
    const at = (triggeredTokens: number) => loreLayers(codex, fixture.setting, { ...yard, texts: ['the fog again'] }, { ...budget, triggeredTokens }).triggered
    const full = at(100_000).tokens
    // Walking the budget down, record the order entries shorten and then drop.
    const shortened: string[] = []
    const dropped: string[] = []
    for (let b = full; b >= 0; b -= 5) {
      const layer = at(b)
      for (const id of layer.shortened) if (!shortened.includes(id)) shortened.push(id)
      for (const id of layer.dropped) if (!dropped.includes(id)) dropped.push(id)
      expect(layer.tokens).toBeLessThanOrEqual(Math.max(b, 0))
    }
    expect(shortened).toEqual(['background.the-fog', 'history.the-flood', 'current.the-strike'])
    expect(dropped).toEqual(['background.the-fog', 'history.the-flood', 'current.the-strike'])
  })

  it('keeps the stage uncapped', () => {
    const stage = directorStage(fixture.primer, codex, fixture.setting)
    expect(stage.text).toContain('Fog lies over the ward.')
    expect(stage.text).toContain('The porters are on strike.')
  })
})

describe('the scene-scoped layer', () => {
  it('carries the place’s whole map chain, the factions and peoples of those present, and what the place links to as summaries', () => {
    const { scene } = loreLayers(fixture.codex, fixture.setting, yard, budget)
    expect(scene.entries).toEqual([
      { id: 'location.lower.east-gate.the-yard', title: 'The Guild Yard', form: 'full' },
      { id: 'location.lower.east-gate', title: 'East Gate', form: 'full' },
      { id: 'location.lower', title: 'The Lower Ward', form: 'full' },
      { id: 'faction.guild', title: 'The Guild', form: 'full' }
    ])
    expect(scene.text).toContain('## The Guild Yard [location.lower.east-gate.the-yard]\nCrates stand three high')
  })

  it('walks a sub-group up to its parent, and gives an automaton their people’s culture', () => {
    expect(codexFactionId(fixture.setting, 'night-shift')).toBe('faction.guild.night-shift')
    const { scene } = loreLayers(fixture.codex, fixture.setting, { ...yard, present: [{ id: 'x', name: 'Cog', species: 'automaton', faction: 'night-shift', holds: [] }] }, budget)
    expect(ids(scene.entries)).toEqual(expect.arrayContaining(['faction.guild', 'faction.guild.night-shift', 'species.automaton']))
  })

  it('carries an insider entry only when someone present knows it, marked with who; never a secret', () => {
    const texts = ['the tallies, the second ledger and the back door']
    const asMara = loreLayers(fixture.codex, fixture.setting, { ...yard, texts }, budget)
    const all = [...ids(asMara.scene.entries), ...ids(asMara.triggered.entries)]
    expect(all).toContain('faction.guild.tallies')
    expect(asMara.triggered.text).toContain('## How the tallies work [faction.guild.tallies] (insider knowledge: only Mara here knows this)')
    expect(all.filter((id) => /ledger|back-door/.test(id))).toEqual([])
    const outsider = loreLayers(fixture.codex, fixture.setting, { ...yard, present: [{ id: 'pell', name: 'Pell', species: 'person', holds: [] }], texts }, budget)
    expect([...ids(outsider.scene.entries), ...ids(outsider.triggered.entries)].filter((id) => /tallies|ledger|back-door/.test(id))).toEqual([])
  })

  it('brings the insider entries someone’s trade opens, without anyone naming them', () => {
    const porter = loreLayers(fixture.codex, fixture.setting, { ...yard, present: [{ id: 'tobin', name: 'Tobin', species: 'person', occupation: 'porter', holds: [] }] }, budget)
    expect(porter.scene.text).toContain('How the tallies work [faction.guild.tallies] (insider knowledge: only Tobin here knows this)')
  })

  it('is the same text for the same inputs', () => {
    expect(loreLayers(fixture.codex, fixture.setting, yard, budget)).toEqual(loreLayers(fixture.codex, fixture.setting, yard, budget))
  })

  it('drops the least specific entries to summaries first under budget pressure, keeping the place in full', () => {
    const { scene } = loreLayers(fixture.codex, fixture.setting, yard, { ...budget, sceneTokens: 100 })
    expect(scene.entries.find((e) => e.id === 'location.lower.east-gate.the-yard')?.form).toBe('full')
    expect(scene.entries.find((e) => e.id === 'faction.guild')?.form).toBe('summary')
    expect(scene.tokens).toBeLessThanOrEqual(100)
  })
})

describe('the triggered layer', () => {
  it('matches keywords, names and aliases in any case, with plurals, and ignores a leading "the"', () => {
    const hit = (t: string) => ids(triggeredEntries(fixture.codex, [t], []))
    expect(hit('Ask the watch about it')).toContain('faction.watch')
    expect(hit('two PENNIES')).toContain('concept.pennies')
    expect(hit('watchmen everywhere')).toContain('faction.watch')
    expect(hit('a watchtower')).not.toContain('faction.watch')
  })

  it('brings a named faction’s other entries too, but not its sub-groups’', () => {
    const hit = ids(triggeredEntries(fixture.codex, ['the Guild again'], []))
    expect(hit).toEqual(expect.arrayContaining(['faction.guild', 'faction.guild.tallies']))
    expect(hit).not.toContain('faction.guild.night-shift.back-door')
  })

  it('matches what the player says in any case, but a capitalized one-word name in model text only as written', () => {
    expect(ids(triggeredEntries(fixture.codex, ['ask the guild'], []))).toContain('faction.guild')
    expect(ids(triggeredEntries(fixture.codex, [], [], ['the guild bell rang twice']))).not.toContain('faction.guild')
    expect(ids(triggeredEntries(fixture.codex, [], [], ['the Guild bell rang twice']))).toContain('faction.guild')
    // Keywords and multi-word names keep matching in any case.
    expect(ids(triggeredEntries(fixture.codex, [], [], ['down by the guild hall']))).toContain('faction.guild')
  })

  it('ignores words inside character names', () => {
    expect(ids(triggeredEntries(fixture.codex, ['Penny Watch said hello'], ['Penny Watch']))).toEqual([])
  })

  it('leaves out what the scene layer already carries in full', () => {
    const { triggered } = loreLayers(fixture.codex, fixture.setting, { ...yard, texts: ['the Guild and the Ward Watch'] }, budget)
    expect(ids(triggered.entries)).not.toContain('faction.guild')
    expect(ids(triggered.entries)).toContain('faction.watch')
  })
})

describe('stance lines', () => {
  it('give each official stance among the factions in play, one way, in the pack’s words', () => {
    const { stances } = loreLayers(fixture.codex, fixture.setting, { ...yard, texts: ['the watch'] }, { ...budget, stanceWords: fixture.vocabulary.stanceWords })
    expect(stances).toEqual(['- The Ward Watch toward The Guild: sour'])
  })

  it('cover a sub-group through its parent, but don’t repeat it when the parent is in play', () => {
    expect(stanceLines(fixture.setting, fixture.vocabulary.stanceWords, ['watch', 'night-shift'])).toEqual(['- The Ward Watch toward The Night Shift: sour'])
    expect(stanceLines(fixture.setting, fixture.vocabulary.stanceWords, ['watch', 'night-shift', 'guild'])).toEqual(['- The Ward Watch toward The Guild: sour'])
    expect(stanceLines(fixture.setting, fixture.vocabulary.stanceWords, ['guild'])).toEqual([])
  })
})
