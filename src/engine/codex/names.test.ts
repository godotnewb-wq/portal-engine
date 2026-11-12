import { describe, expect, it } from 'vitest'
import { fixture, fixtureCodex } from '@tests/fixture'
import { buildCodex } from './load'
import { candidates, checkNames, nameIndex, secretLeaks } from './names'

/** The fixture's codex plus some entries written here, and its name index. */
function indexWith(...files: [string, string][]) {
  const codex = buildCodex([...fixtureCodex(), ...files.map(([path, header]) => ({ path, text: `---\n${header}\n---\nSome text.\n` }))]).entries
  return { codex, index: nameIndex(codex, fixture.setting, ['Mara Quill'], fixture.vocabulary.genericWords) }
}
const found = (text: string, index: ReturnType<typeof indexWith>['index']) => checkNames(text, index).map((f) => (f.kind === 'wrong-name' ? `${f.name} → ${f.canon[0]}` : `new: ${f.name}`))

describe('the name index (milestone 3.5, task 2)', () => {
  const { index } = indexWith(
    ['concepts/fog.md', 'title: How the fog rolls in\nlabel: The Grey\nkind: concept\nkeywords: [the Tally Desk]\nsummary: x'],
    ['concepts/ropes.md', 'title: Rope work\nkind: concept\nsummary: x'],
    ['concepts/hush.md', 'title: The hush\nlabel: The Hush Room\nkind: concept\nknowledge: circles\nalso: [occupation porter]\nsummary: x']
  )

  it('holds every label and alias, insider ones too, and the setting’s names', () => {
    expect(index.written).toEqual(expect.arrayContaining(['The Grey', 'The Hush Room', 'The Guild', 'the hall', fixture.setting.name]))
  })

  it('leaves out titles and keywords, capitalized or not', () => {
    for (const not of ['How the fog rolls in', 'Rope work', 'the Tally Desk', 'How the tallies work', 'The second ledger']) expect(index.written).not.toContain(not)
  })
})

describe('setting factions without a name (milestone 3.5, task 4)', () => {
  // The Ward Watch as a plural category: its main entry loses its label (and so its aliases).
  const unnamed = fixture.codex.map((e) => (e.id === 'faction.watch' ? { ...e, label: undefined, aliases: [] } : e))
  const index = (codex: typeof fixture.codex, setting = fixture.setting) => nameIndex(codex, setting, [], fixture.vocabulary.genericWords)

  it('leaves out a setting faction’s name when its main codex entry has no label', () => {
    const watch = fixture.setting.factions.find((f) => f.id === 'watch')!.name
    expect(index(fixture.codex).written).toContain(watch)
    expect(index(unnamed).written).not.toContain(watch)
    expect(index(unnamed).written).toContain(fixture.setting.factions.find((f) => f.id === 'guild')!.name)
  })

  it('keeps a setting faction’s name when the codex has no main entry for it', () => {
    const setting = { ...fixture.setting, factions: [...fixture.setting.factions, { ...fixture.setting.factions[0]!, id: 'ferrymen', name: 'The Ferrymen' }] }
    expect(index(fixture.codex, setting).written).toContain('The Ferrymen')
  })
})

describe('possessives in names (milestone 3.5, task 2)', () => {
  const { index } = indexWith(['locations/lower/east-gate/tanners-row.md', "title: Tanners' Row\nlabel: Tanners' Row\nkind: location\nsummary: x"])

  it('passes a canon name that holds a possessive, written as it is, with either apostrophe', () => {
    expect(found("They met on Tanners' Row at dawn.", index)).toEqual([])
    expect(found('They met on Tanners’ Row at dawn.', index)).toEqual([])
    expect(found("Tanners' Row was quiet.", index)).toEqual([])
  })

  it('still flags the name without its apostrophe, giving the right one', () => {
    expect(found('They met on Tanners Row at dawn.', index)).toEqual(["Tanners Row → Tanners' Row"])
  })

  it('still ends a name at a possessive that isn’t part of one', () => {
    expect(candidates("the Guild's carts and Ada's Lantern").map((c) => c.name)).toEqual(['Guild', 'Ada', 'Lantern'])
    expect(candidates("Ada's Lantern")[0]?.withNext).toBe("Ada's Lantern")
    expect(found("The Guild's carts waited at East Gate.", index)).toEqual([])
  })

  it('joins a possessive to a name with "of the" inside it', () => {
    const { index: halls } = indexWith(['locations/lower/east-gate/hall.md', "title: Hall of the Tanners' Guild\nlabel: Keeper's Hall of the Lamps\nkind: location\nsummary: x"])
    expect(candidates("Keeper's Hall of the Lamps")[0]?.withNext).toBe("Keeper's Hall of the Lamps")
    expect(candidates('the Hall of the Lamps of the')[0]?.name).toBe('Hall of the Lamps')
    expect(found("They waited in Keeper's Hall of the Lamps.", halls)).toEqual([])
  })
})

describe('secret leaks (milestone 3.5, task 2)', () => {
  it('sees a secret by its title, label or a multi-word keyword, whether or not it has a label', () => {
    const { codex } = indexWith(['factions/guild/vault.md', 'title: The quiet vault\nlabel: The Strongroom Under Ash\nkind: faction\nknowledge: secret\nknown-by: [guild]\nkeywords: [false floor]\nsummary: x'])
    const leaked = (text: string) => secretLeaks(text, codex).map((l) => l.entry.id)
    expect(leaked('Nobody mentions the quiet vault.')).toContain('faction.guild.vault')
    expect(leaked('They say the Strongroom Under Ash is real.')).toContain('faction.guild.vault')
    expect(leaked('There is a false floor in the back.')).toContain('faction.guild.vault')
  })
})
