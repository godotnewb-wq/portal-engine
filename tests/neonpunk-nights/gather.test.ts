import { describe, expect, it } from 'vitest'
import { gatherScene } from '@engine/scene'
import { createInitialState, startScene } from '@engine/state'
import { barScene, content } from './support'

// The `scene` pipeline's gathering on the real bar scene (Milestone 5 plan, task 1): the pools follow what was just
// said, lore only when it is brought up and only to those who know it, and the job isn't the secret.
describe('gathering in the Sump Lantern', () => {
  const ids = (input: string, who: string) => gatherScene(content, barScene(), input).pools[who]!.map((f) => f.id)

  it('asking about the case brings Oria’s facts about the job, no lore, and no secret in play', () => {
    const g = gatherScene(content, barScene(), "What's in the sealed case, Oria?")
    expect(g.pools['oria-senn']!.filter((f) => f.source === 'card').length).toBeGreaterThan(0)
    expect(Object.values(g.pools).flat().some((f) => f.source === 'lore')).toBe(false)
    // The case is the public job; what it holds is the secret, and nothing said names that (milestone 4c's lesson).
    expect(Object.values(g.options).flatMap((o) => o.secrets)).toEqual([])
  })

  it('naming the Grid’s load shedding brings it to Vex, who knows it, and not to Oria or Brask', () => {
    expect(ids('Is the Grid shedding load down here again?', 'vex')).toContain('lore.faction.aether-grid-corporation.load-shedding')
    expect(ids('Is the Grid shedding load down here again?', 'oria-senn')).not.toContain('lore.faction.aether-grid-corporation.load-shedding')
    expect(ids('Is the Grid shedding load down here again?', 'brask')).not.toContain('lore.faction.aether-grid-corporation.load-shedding')
  })

  it('never offers more than the ruleset’s pool size', () => {
    for (const pool of Object.values(gatherScene(content, barScene(), 'Is the Grid shedding load down here again?').pools)) expect(pool.length).toBeLessThanOrEqual(content.ruleset.scene.factPool)
  })
})

// Milestone 5 plan, task 2 (criterion 8): no run before this milestone had a companion read. The game now names who
// could see through a holder; in the deception scenes that is Vex, as the scenarios expect.
describe('who could see through Oria', () => {
  it('is Vex first, then Brask, when the client comes up', () => {
    const state = startScene(content, createInitialState(content, 1), 'sump-lantern', ['vex', 'brask', 'oria-senn', 'dunmar'])
    const g = gatherScene(content, state, "So, Oria, who's the client, really?")
    expect(g.options['oria-senn']!.secrets.map((s) => s.id)).toEqual(['oria-senn.client-is-grid-corporation'])
    expect(g.readers['oria-senn']!.map((r) => r.who)).toEqual(['vex', 'brask'])
    expect(g.readers['oria-senn']![0]).toMatchObject({ knows: 'client' })
  })

  it('is no one while nothing touches her secrets', () => {
    expect(gatherScene(content, barScene(), 'Evening, all.').readers).toEqual({})
  })
})
