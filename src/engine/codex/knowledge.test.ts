import { describe, expect, it } from 'vitest'
import { fixture } from '@tests/fixture'
import { entryById } from './load'
import { fits, knows, mayHold, standings, type Knower } from './knowledge'
import { parseSelector, type Selector } from './schema'

const sel = (t: string) => parseSelector(t) as Selector
const who = (k: Partial<Knower>): Knower => ({ id: 'x', name: 'X', species: 'person', holds: [], ...k })
const entry = (id: string) => entryById(fixture.codex, id)!

describe('the knowledge filter (claude/lore-injection.md §7)', () => {
  it('reads standing on the four levels, one step lower in each parent, never above trusted', () => {
    expect([...standings(fixture.setting, { faction: 'night-shift', level: 'leadership' })]).toEqual([['night-shift', 'leadership'], ['guild', 'trusted']])
    expect([...standings(fixture.setting, { faction: 'night-shift', level: 'affiliated' })]).toEqual([['night-shift', 'affiliated']])
    expect([...standings(fixture.setting, { faction: 'guild' })]).toEqual([])
  })

  it('fits a faction selector at that level or above, and a blank level fits none', () => {
    expect(fits(fixture.setting, sel('guild'), who({ faction: 'guild', level: 'member' }))).toBe(true)
    expect(fits(fixture.setting, sel('guild trusted+'), who({ faction: 'guild', level: 'member' }))).toBe(false)
    expect(fits(fixture.setting, sel('guild affiliated+'), who({ faction: 'night-shift', level: 'member' }))).toBe(true)
    expect(fits(fixture.setting, sel('guild'), who({ faction: 'night-shift', level: 'member' }))).toBe(false)
    expect(fits(fixture.setting, sel('guild affiliated+'), who({ faction: 'guild' }))).toBe(false)
  })

  it('fits occupations (any case), species and named characters; blank fields fit nothing', () => {
    expect(fits(fixture.setting, sel('occupation porter'), who({ occupation: 'Porter' }))).toBe(true)
    expect(fits(fixture.setting, sel('occupation porter'), who({}))).toBe(false)
    expect(fits(fixture.setting, sel('species automaton'), who({ species: 'automaton' }))).toBe(true)
    expect(fits(fixture.setting, sel('character mara'), who({ id: 'mara' }))).toBe(true)
  })

  it('lets everyone know common entries, insiders know circles entries, and only holders know secrets', () => {
    const mara = who({ id: 'mara', faction: 'guild', level: 'trusted' })
    expect(knows(fixture.setting, entry('faction.guild'), who({}))).toBe(true)
    expect(knows(fixture.setting, entry('faction.guild.tallies'), mara)).toBe(true)
    expect(knows(fixture.setting, entry('faction.guild.tallies'), who({ occupation: 'porter' }))).toBe(true)
    expect(knows(fixture.setting, entry('faction.guild.tallies'), who({ occupation: 'clerk' }))).toBe(false)
    expect(knows(fixture.setting, entry('faction.guild.second-ledger'), mara)).toBe(false)
    expect(knows(fixture.setting, entry('faction.guild.second-ledger'), { ...mara, holds: ['faction.guild.second-ledger'] })).toBe(true)
    expect(mayHold(fixture.setting, entry('faction.guild.second-ledger'), mara)).toBe(true)
    expect(mayHold(fixture.setting, entry('faction.guild.second-ledger'), who({ faction: 'guild', level: 'member' }))).toBe(false)
  })
})
