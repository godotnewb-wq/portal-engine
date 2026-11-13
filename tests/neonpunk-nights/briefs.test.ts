import { describe, expect, it } from 'vitest'
import { createInitialState, startScene, type GameState, type Turn } from '@engine/state'
import { buildBriefs, buildDirectorPrompt, fullDetails, selectDetails } from '@engine/scene'
import { tokensOf } from '@engine/codex'
import { content } from './support'

/**
 * Milestone 4a acceptance 9: on the same crowded scene, selected briefs against full cards. The selection must cost
 * fewer director tokens, keep the facts needed to answer the player, give a quiet character a relevant opening, and
 * let optional detail go when the topic changes (director writer §7: a question, a short follow-up, a topic change).
 */
const crowded = (): GameState => startScene(content, createInitialState(content, 1), 'sump-lantern', ['vex', 'brask', 'oria-senn', 'dunmar'])
const after = (state: GameState, t: Partial<Turn>): GameState => ({ ...state, scene: { ...state.scene!, turns: [...state.scene!.turns, { id: `t${state.scene!.turns.length + 1}`, player: '', beats: [], checks: [], speakers: [], texture: [], ...t }] } })

describe('selected briefs on a crowded scene', () => {
  const question = 'Oria, who is the client, really?'

  it('cost fewer director tokens than full cards', () => {
    const state = crowded()
    const briefs = buildBriefs(content, state, question)
    const full = fullDetails(content, state).reduce((n, d) => n + d.tokens, 0)
    expect(briefs.trace.used).toBeLessThan(full / 2)
    const prompt = buildDirectorPrompt(content, state, question, undefined, briefs)
    expect(tokensOf(prompt.system)).toBeLessThan(tokensOf(prompt.system) - briefs.trace.used + full)
  })

  it('keep the fact needed to answer the player, and give quiet Vex her reason to speak', () => {
    const chosen = selectDetails(content, crowded(), question).details
    expect(chosen.find((d) => d.id === 'oria-senn.k3')).toMatchObject({ rank: 'answer' })
    // Vex isn't addressed, but she knows Oria has lied to her before.
    expect(chosen.find((d) => d.id === 'vex.k1')).toMatchObject({ rank: 'answer', trigger: expect.stringContaining('named: Oria') })
  })

  it('carry the exchange through a short follow-up and let it go on a change of topic', () => {
    const first = selectDetails(content, crowded(), question).details
    const asked = after(crowded(), { player: question, beats: [{ kind: 'dialogue', speaker: 'oria-senn', text: 'A private collector, darling.' }], speakers: ['oria-senn'], details: first.filter((d) => d.rank === 'answer').map((d) => d.id) })
    const why = selectDetails(content, asked, 'Why?')
    expect(why.details.filter((d) => d.trigger === 'carried').map((d) => d.id)).toContain('vex.k1')
    const changed = selectDetails(content, asked, "Dunmar, what's good to drink tonight?")
    expect(changed.details.map((d) => d.id)).not.toContain('vex.k1')
    expect(changed.trace.dropped).toContain('vex.k1')
  })

  it('stay within the shared budget across everyone present', () => {
    const { trace } = selectDetails(content, crowded(), 'Brask, Vex, what do you make of Pump Station Nine?')
    expect(trace.used).toBeLessThanOrEqual(content.ruleset.briefs.detailTokens)
    expect(new Set(trace.selected.map((d) => d.owner)).size).toBeGreaterThan(1)
  })
})
