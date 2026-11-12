import { describe, expect, it } from 'vitest'
import { canonNames, checkNames, codexWarnings, entryById, locationChain, secretLeaks } from '@engine/codex'
import { packNames } from '@engine/scene'
import { characterById, knowerOf } from '@engine/pack'
import { content } from './support'

/** How the pack is written, checked here rather than in the engine (claude/lore-injection.md §2.1). */
describe('the Neonpunk Nights codex', () => {
  it('loads with no stance words in its prose', () => {
    expect(content.codex.length).toBeGreaterThan(50)
    expect(codexWarnings(content.codex, content.vocabulary)).toEqual([])
  })

  it('files the old world and event entries as history, background and current (milestone 3.5, task 3)', () => {
    const of = (kind: string) => content.codex.filter((e) => e.kind === kind).map((e) => e.id).sort()
    expect(of('history')).toEqual(['history.the-aether-arts', 'history.the-burn', 'history.the-old-world'])
    expect(of('background')).toEqual(['background.galactic-society', 'background.the-current-day', 'background.the-korrath', 'background.the-stillness'])
    expect(of('current')).toHaveLength(5)
    expect(entryById(content.codex, 'background.the-stillness')?.label).toBe('The Stillness')
    expect(content.codex).toHaveLength(84)
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
    expect(locationChain(content.codex, 'location.low-turns.ninth-turn.sump-lantern').map((e) => e.title)).toEqual(['The Sump Lantern', 'The Ninth Turn', 'The Low Turns'])
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
    expect(l.layers.scene.text).toContain('How the grid really runs [faction.aether-grid-corporation.load-shedding] (insider knowledge: only Vex here knows this)')
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

describe('the name check on Neonpunk prose', () => {
  const names = (text: string) => checkNames(text, packNames(content)).map((f) => (f.kind === 'wrong-name' ? `${f.name} → ${f.canon[0]}` : `new: ${f.name}`))

  it('passes canon names, aliases, possessives and two names side by side', () => {
    expect(names('A Grid Corp van idled outside the Wheel Clinic while the Saints watched the Lower Stairs.')).toEqual([])
    expect(names("House Sarrant's people met the Wardens of the Ninth Turn at Pump Station Nine.")).toEqual([])
    expect(names('The Low Turns Ward Office was shut. Behind Kettle Court, Coil Line Car 14 waited.')).toEqual([])
    // Found in the milestone 3.5 baseline bench: the possessive used to split this canon name and flag it.
    expect(names("Close enough to Glassblowers' Row you'll pass it.")).toEqual([])
    expect(names('The Abbess sent word to the Korrath elders; nobody here studies the Aether Arts.')).toEqual([])
  })

  it('knows the names that only keywords used to supply, and drops keywords that were never names (milestone 3.5)', () => {
    expect(names('The Abess wants her tithe, and a Korath elder heard it.')).toEqual(['The Abess → The Abbess', 'Korath → The Korrath'])
    const index = packNames(content)
    for (const not of ['Grid bills', 'Aether sickness', 'the Wheel market']) expect(index.written).not.toContain(not)
  })

  it('gives the writer labels only: no topic titles (milestone 3.5)', () => {
    const list = canonNames(content.codex)
    expect(list).toEqual(expect.arrayContaining(['The Lattice', 'The Aether', 'Cinders', 'The Korrath', 'The Aether Arts', 'The Abbess']))
    for (const not of ['Aether in the body', 'Street slang', 'How each tier lives', 'Body augmentation']) expect(list).not.toContain(not)
  })

  it('flags near misses with the right name, and new groups', () => {
    expect(names('Agents of the Grid Authority came for House Sarant.')).toEqual(['Grid Authority → The Aether Grid Corporation', 'House Sarant → House Sarrant'])
    expect(names('The Drowned Sinners and the Phoenix Collective both wanted it.')).toEqual(['The Drowned Sinners → The Drowned Saints', 'Phoenix Collective → The Phoenix Academy'])
    expect(names('A crew called the Rawdog Gang ran the stalls.')).toEqual(['new: Rawdog Gang'])
  })

  it('finds none in the pack’s own prose', () => {
    const prose = [...content.codex.flatMap((e) => [e.summary, e.full]), ...content.locations.map((l) => l.description)]
    expect(prose.flatMap(names)).toEqual([])
  })

  it('sees a codex secret named in prose', () => {
    const secret = content.codex.find((e) => e.knowledge === 'secret')!
    expect(secretLeaks(`They spoke of ${secret.title.toLowerCase()} in whispers.`, content.codex).map((l) => l.entry.id)).toContain(secret.id)
  })
})

describe('Oria’s linked secret', () => {
  it('points to the control core, resolved from the codex with her part in it', () => {
    const oria = characterById(content, 'oria-senn')!
    const linked = oria.secrets.find((s) => s.id === 'the-case')!
    expect(linked.codex).toBe('faction.aether-grid-corporation.control-core')
    expect(linked.text).toMatch(/^Oria's part: she is fetching the sealed case for the Grid\. The sealed case /)
    expect(linked.text).toMatch(/How Oria feels about it: doesn[’']t want to know .*anyway\.$/)
    expect(knowerOf(oria).holds).toEqual(['faction.aether-grid-corporation.control-core'])
  })

  it('lets her slip about the core while she guards it, and cuts it otherwise', () => {
    const line = 'Oria lets it drop: the control core is in there.'
    expect(secretLeaks(line, content.codex).map((l) => l.entry.id)).toEqual(['faction.aether-grid-corporation.control-core'])
    expect(secretLeaks(line, content.codex, new Set(['faction.aether-grid-corporation.control-core']))).toEqual([])
  })

  it('leaves the reclamation itself held by nobody', () => {
    expect(content.characters.flatMap((c) => knowerOf(c).holds)).not.toContain('faction.aether-grid-corporation.reclamation')
  })
})
