import { describe, expect, it } from 'vitest'
import { codexWarnings, entryById, locationChain } from '@engine/codex'
import { characterById } from '@engine/pack'
import { content } from './support'

/** How the pack is written, checked here rather than in the engine (claude/lore-injection.md §2.1). */
describe('the Neonpunk Nights codex', () => {
  it('loads with no stance words in its prose', () => {
    expect(content.codex.length).toBeGreaterThan(50)
    expect(codexWarnings(content.codex, content.vocabulary)).toEqual([])
  })

  it('says where in claude/lore.md every entry comes from', () => {
    expect(content.codex.filter((e) => !e.source).map((e) => e.file)).toEqual([])
  })

  it('has the eight authored factions, the two named sub-groups and the four one-way stances', () => {
    const top = content.setting.factions.filter((f) => !f.parent).map((f) => f.id)
    expect(top).toEqual(['spire-council', 'aether-grid-corporation', 'phoenix-academy', 'garden-guard', 'off-world-houses', 'refugee-networks', 'low-turns-syndicates', 'couriers'])
    expect(content.setting.factions.filter((f) => f.parent).map((f) => `${f.id} < ${f.parent}`)).toEqual(['house-sarrant < off-world-houses', 'drowned-saints < low-turns-syndicates'])
    expect(content.setting.stances.map((s) => `${s.from} → ${s.toward}: ${s.stance}`)).toEqual([
      'garden-guard → aether-grid-corporation: enemy',
      'aether-grid-corporation → garden-guard: rival',
      'spire-council → low-turns-syndicates: enemy',
      'spire-council → off-world-houses: friendly'
    ])
    for (const id of top) expect(entryById(content.codex, `faction.${id}`)?.stage).toBeTruthy()
  })

  it('lays the sandbox out as the map tree: four regions and twelve places, the two playable ones linked to their regions', () => {
    const at = (layer: number) => content.codex.filter((e) => e.kind === 'location' && e.layer === layer).map((e) => e.id)
    expect(at(1)).toHaveLength(5)
    expect(at(2).sort()).toEqual(['location.bulk.kilnworks', 'location.bulk.wheel', 'location.low-turns.ninth-turn', 'location.low-turns.seep'])
    expect(at(3)).toHaveLength(12)
    expect(content.locations.map((l) => [l.id, l.parent])).toEqual([
      ['coil-line-car-14', 'location.bulk.kilnworks'],
      ['sump-lantern', 'location.low-turns.ninth-turn']
    ])
    expect(locationChain(content.codex, 'location.low-turns.ninth-turn.sump-lantern').map((e) => e.name)).toEqual(['The Sump Lantern', 'The Ninth Turn', 'The Low Turns'])
  })

  it('keeps the reclamation and Sarrant’s money secret, and the load-shedding to Grid staff and Couriers', () => {
    for (const id of ['faction.aether-grid-corporation.reclamation', 'faction.off-world-houses.house-sarrant.ninth-turn']) {
      expect(entryById(content.codex, id)).toMatchObject({ knowledge: 'secret', audience: ['director'] })
    }
    expect(entryById(content.codex, 'faction.aether-grid-corporation.load-shedding')).toMatchObject({
      knowledge: 'circles',
      circle: { by: 'faction', faction: 'aether-grid-corporation', level: 'member' },
      also: [{ by: 'occupation', occupation: 'courier' }]
    })
  })

  it('gives the cast their faction standing and work (decided 2026-11-08)', () => {
    const who = (id: string) => {
      const c = characterById(content, id)!
      return [c.faction, c.level, c.rank, c.occupation]
    }
    expect(who('vex')).toEqual(['couriers', 'member', 'sigil-runner', 'courier'])
    expect(who('teo-varrin')).toEqual(['aether-grid-corporation', 'member', 'line tech', 'line technician'])
    expect(who('kesh')).toEqual(['spire-council', 'member', 'conductor', 'conductor'])
    expect(who('brask')).toEqual([undefined, undefined, undefined, 'mechanic'])
    expect(who('oria-senn')).toEqual([undefined, undefined, undefined, 'fixer'])
    expect(who('jun-halloway')).toEqual([undefined, undefined, undefined, 'nurse'])
  })
})

describe('the Neonpunk Nights lore layers (the worked example, claude/lore-injection.md §12)', () => {
  it('at the Sump Lantern: the place, the Ninth Turn and the Low Turns, the Couriers for Vex, and the peoples present', async () => {
    const { createInitialState, startScene } = await import('@engine/state')
    const { turnLore } = await import('@engine/scene')
    const state = startScene(content, createInitialState(content, 1), 'sump-lantern', ['vex', 'brask', 'oria-senn'])
    const lore = turnLore(content, state, 'Is this job for the Grid Corporation, Oria?')
    const scene = lore.layers.scene.entries.map((e) => e.id)
    expect(scene.slice(0, 3)).toEqual(['location.low-turns.ninth-turn.sump-lantern', 'location.low-turns.ninth-turn', 'location.low-turns'])
    expect(scene).toEqual(expect.arrayContaining(['faction.couriers', 'species.deep-elf', 'species.goblin', 'species.light-elf']))
    const triggered = lore.layers.triggered.entries.map((e) => e.id)
    expect(triggered).toEqual(expect.arrayContaining(['faction.aether-grid-corporation', 'faction.aether-grid-corporation.apprenticeships']))
    // Insider entries wait for the knowledge filter; the reclamation never comes this way.
    expect(triggered.filter((id) => /load-shedding|reclamation|view-of-others/.test(id))).toEqual([])
    expect(lore.stage.text).toContain('The Aether Grid Corporation pipes refined Aether up the spire')
    expect(lore.writerStage.text).toContain('the Grid')
  })
})

describe('the Neonpunk Nights knowledge filter', () => {
  const lore = async (location: string, cast: string[], input: string) => {
    const { createInitialState, startScene } = await import('@engine/state')
    const { turnLore } = await import('@engine/scene')
    return turnLore(content, startScene(content, createInitialState(content, 1), location, cast), input)
  }

  it('gives Vex the load-shedding as Courier knowledge at the Sump Lantern; Brask and Oria don’t know it', async () => {
    const l = await lore('sump-lantern', ['vex', 'brask', 'oria-senn'], 'Evening.')
    expect(l.layers.scene.text).toContain('How the grid really runs (insider knowledge: only Vex here knows this)')
  })

  it('gives Teo the Grid’s insider entries as a member when the Grid comes up on the tram, never the reclamation', async () => {
    const l = await lore('coil-line-car-14', ['kesh', 'jun-halloway', 'teo-varrin'], 'Is the Grid cutting the power on purpose?')
    const all = [...l.layers.scene.entries, ...l.layers.triggered.entries].map((e) => e.id)
    expect(all).toEqual(expect.arrayContaining(['faction.aether-grid-corporation.load-shedding', 'faction.aether-grid-corporation.view-of-others']))
    expect(all.filter((id) => /reclamation|ninth-turn$/.test(id))).toEqual([])
    expect([l.layers.scene.text, l.layers.triggered.text].join('\n')).toContain('only Teo here knows this')
  })

  it('gives the director the official stances among the factions in play, both ways where both exist', async () => {
    const l = await lore('coil-line-car-14', ['kesh', 'jun-halloway', 'teo-varrin'], 'Does the Garden Guard cut the lines?')
    // House Sarrant is in play through the Grid's linked entry; the Council's stance toward the Houses covers it.
    expect(l.layers.stances).toEqual([
      '- The Spire Council toward House Sarrant: friendly',
      '- The Aether Grid Corporation toward The Garden Guard: rival',
      '- The Garden Guard toward The Aether Grid Corporation: enemy'
    ])
  })
})
