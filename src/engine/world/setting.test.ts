import { describe, expect, it } from 'vitest'
import { fixture } from '@tests/fixture'
import { factionChain, parentLevel, settingProblems, SettingSchema } from './setting'

describe('factions and stances', () => {
  it('walk a sub-group up to its parent', () => {
    expect(factionChain(fixture.setting, 'night-shift').map((f) => f.id)).toEqual(['night-shift', 'guild'])
  })

  it('carry a sub-group level up one step lower, never above trusted', () => {
    expect(['affiliated', 'member', 'trusted', 'leadership'].map((l) => parentLevel(l as never))).toEqual([undefined, 'affiliated', 'member', 'trusted'])
  })

  it('find sub-groups of nothing, loops, and stances between unknown or the same factions, or written twice', () => {
    const s = SettingSchema.parse({
      ...structuredClone(fixture.setting),
      factions: [...fixture.setting.factions, { id: 'cell', name: 'Cell', parent: 'nobody' }, { id: 'a', name: 'A', parent: 'b' }, { id: 'b', name: 'B', parent: 'a' }],
      stances: [...fixture.setting.stances, { from: 'watch', toward: 'guild', stance: 'warm' }, { from: 'guild', toward: 'guild', stance: 'warm' }, { from: 'navy', toward: 'guild', stance: 'warm' }]
    })
    expect(settingProblems(s)).toEqual([
      'faction "cell" is a sub-group of unknown faction "nobody"',
      'faction "a" is part of a loop of sub-groups',
      'faction "b" is part of a loop of sub-groups',
      'the stance from "watch" toward "guild" is written twice',
      'faction "guild" has a stance toward itself',
      'a stance names unknown faction "navy"'
    ])
  })
})
