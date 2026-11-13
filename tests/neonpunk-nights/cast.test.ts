import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { createInitialState, startScene } from '@engine/state'
import { buildBriefs, buildWriterPrompt, speakerTies, type BeatPlan } from '@engine/scene'
import { nature } from '@engine/characters'
import { loadScenarios } from '../../tools/bench/scenario'
import { content, PACK_DIR } from './support'

/**
 * Milestone 4a task 8, in code: the sibling pair's asymmetry reaches both prompts the way the cards set it, and no two
 * of the cast read alike in what the director and the writer are given. The bench judges the prose (acceptance 7).
 */
const siblings = loadScenarios(join(PACK_DIR, 'bench')).find((s) => s.id === 'siblings-on-the-car')!
const onTheCar = () => startScene(content, createInitialState(content, siblings.seed), siblings.location, siblings.cast)
const speaking = (ids: string[]) => ({ speakers: ids.map((id) => ({ id, intent: 'answer', mood: 'as before' })), exchange: [], reactions: [], checks: [], walk_ons: [], texture: [], avoid: [], leaves: [], end_scene: false }) as unknown as BeatPlan

describe('the Dace siblings see each other differently', () => {
  it('in the cards: Tam counts Ilse a rival, she doesn’t count him one, and their feelings point opposite ways', () => {
    const state = onTheCar()
    const tie = (from: string, to: string) => state.relations.find((r) => r.from === from && r.to === to)!
    expect(tie('tam-dace', 'ilse-dace').tags.map((t) => t.tag)).toContain('rival')
    expect(tie('ilse-dace', 'tam-dace').tags.map((t) => t.tag)).not.toContain('rival')
    expect(tie('ilse-dace', 'tam-dace').meters['approval']).toBeLessThan(0)
    expect(tie('tam-dace', 'ilse-dace').meters['approval']).toBeGreaterThan(0)
  })

  it('in the director’s briefs: each sees their own side, in tags and bands', () => {
    const { sheets } = buildBriefs(content, onTheCar(), siblings.turns[0]!)
    expect(sheets['tam-dace']).toMatch(/Toward others here: .*Ilse: older sister, rival · approval: /)
    expect(sheets['ilse-dace']).toMatch(/Toward others here: .*Tam: younger brother · approval: /)
    expect(sheets['ilse-dace']).not.toMatch(/Tam: [^;]*rival/)
  })

  it('in the writer’s brief: each speaker’s own tags and history toward the other, no bands', () => {
    const ties = speakerTies(content, onTheCar(), speaking(['tam-dace', 'ilse-dace']))
    expect(ties.find((l) => l.startsWith('- Tam → Ilse:'))).toMatch(/^- Tam → Ilse: older sister, rival; /)
    expect(ties.find((l) => l.startsWith('- Ilse → Tam:'))).toMatch(/^- Ilse → Tam: younger brother; /)
    const user = buildWriterPrompt(content, onTheCar(), speaking(['tam-dace', 'ilse-dace']), siblings.turns[0]!).user
    for (const m of content.ruleset.meters.list) expect(user).not.toContain(`${m.id}:`)
  })
})

describe('no two of the cast read alike', () => {
  const cast = content.characters
  const distinct = (what: string, of: (c: (typeof cast)[number]) => string) => {
    const seen = new Map<string, string>()
    for (const c of cast) {
      const v = of(c)
      expect(seen.get(v), `${c.id} has the same ${what} as ${seen.get(v)}`).toBeUndefined()
      seen.set(v, c.id)
    }
  }

  it('every portrait cue, role, voice rhythm and sample line is the character’s own', () => {
    distinct('portrait', (c) => c.portrait.trim().split(/(?<=[.!?])\s/)[0]!)
    distinct('role', (c) => c.role)
    distinct('rhythm', (c) => c.voice.rhythm)
    for (const line of new Set(cast.flatMap((c) => c.voice.sampleLines))) expect(cast.filter((c) => c.voice.sampleLines.includes(line)).length, line).toBe(1)
  })

  it('characters sharing a nature line still differ in everything else the director gets', () => {
    const byNature = new Map<string, string[]>()
    for (const c of cast) byNature.set(nature(content.ruleset, c), [...(byNature.get(nature(content.ruleset, c)) ?? []), c.id])
    for (const ids of byNature.values()) {
      if (ids.length < 2) continue
      const [a, b] = ids.map((id) => cast.find((c) => c.id === id)!)
      expect(a!.agenda.current).not.toBe(b!.agenda.current)
      expect(a!.voice.shifts.lying).not.toBe(b!.voice.shifts.lying)
    }
  })
})
