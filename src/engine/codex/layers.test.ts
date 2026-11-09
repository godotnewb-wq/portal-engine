import { describe, expect, it } from 'vitest'
import { fixture } from '@tests/fixture'
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
  it('is the primer, then every common stage line in a fixed order: world, places, peoples, worldviews, factions, concepts', () => {
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

describe('the scene-scoped layer', () => {
  it('carries the place’s whole map chain, the factions and peoples of those present, and what the place links to as summaries', () => {
    const { scene } = loreLayers(fixture.codex, fixture.setting, yard, budget)
    expect(scene.entries).toEqual([
      { id: 'location.lower.east-gate.the-yard', name: 'The Guild Yard', form: 'full' },
      { id: 'location.lower.east-gate', name: 'East Gate', form: 'full' },
      { id: 'location.lower', name: 'The Lower Ward', form: 'full' },
      { id: 'faction.guild', name: 'The Guild', form: 'full' }
    ])
    expect(scene.text).toContain('## The Guild Yard\nCrates stand three high')
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
    expect(asMara.triggered.text).toContain('## How the tallies work (insider knowledge: only Mara here knows this)')
    expect(all.filter((id) => /ledger|back-door/.test(id))).toEqual([])
    const outsider = loreLayers(fixture.codex, fixture.setting, { ...yard, present: [{ id: 'pell', name: 'Pell', species: 'person', holds: [] }], texts }, budget)
    expect([...ids(outsider.scene.entries), ...ids(outsider.triggered.entries)].filter((id) => /tallies|ledger|back-door/.test(id))).toEqual([])
  })

  it('brings the insider entries someone’s trade opens, without anyone naming them', () => {
    const porter = loreLayers(fixture.codex, fixture.setting, { ...yard, present: [{ id: 'tobin', name: 'Tobin', species: 'person', occupation: 'porter', holds: [] }] }, budget)
    expect(porter.scene.text).toContain('How the tallies work (insider knowledge: only Tobin here knows this)')
  })

  it('is the same text for the same inputs', () => {
    expect(loreLayers(fixture.codex, fixture.setting, yard, budget)).toEqual(loreLayers(fixture.codex, fixture.setting, yard, budget))
  })

  it('drops the least specific entries to summaries first under budget pressure, keeping the place in full', () => {
    const { scene } = loreLayers(fixture.codex, fixture.setting, yard, { ...budget, sceneTokens: 90 })
    expect(scene.entries.find((e) => e.id === 'location.lower.east-gate.the-yard')?.form).toBe('full')
    expect(scene.entries.find((e) => e.id === 'faction.guild')?.form).toBe('summary')
    expect(scene.tokens).toBeLessThanOrEqual(90)
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
