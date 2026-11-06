import { describe, expect, it } from 'vitest'
import { GameStateSchema, type GameState } from '@engine/state'
import { buildDirectorPrompt } from '@engine/scene'
import { selectMemories } from '@engine/memory'
import { applySummaries, bandOf, buildSummaryPrompt, parseSummary, plainSummary, transcript, witnesses } from '@engine/relationships'
import { barScene, content } from './support'

/** The bar scene after the worked example's turn, with Brask having left. */
function playedScene(): GameState {
  const state = barScene(2)
  const scene = state.scene!
  scene.turns.push({
    id: 't1',
    player: 'So, Oria, who is the client, really?',
    beats: [
      { kind: 'dialogue', speaker: 'oria-senn', text: 'A private collector, darling.' },
      { kind: 'dialogue', speaker: 'vex', text: "'Darling.' She only says that when she's lying." }
    ],
    checks: [{ id: 'v', who: 'vex', skill: 'empathy', difficulty: 'moderate', stakes: 'notices Oria lying', natural: 14, total: 17, dc: 15, degree: 'success', line: 'Vex — Empathy 17 vs 15: success' }],
    speakers: ['oria-senn', 'vex'],
    texture: []
  })
  scene.departed.push('brask')
  return state
}

describe('summary prompt', () => {
  it('covers everyone who saw the scene, including those who left', () => {
    expect(witnesses(playedScene()).sort()).toEqual(['brask', 'oria-senn', 'vex'])
  })

  it('reads the scene with names and rolls', () => {
    const text = transcript(content, playedScene())
    expect(text).toMatch(/^Rook: So, Oria/)
    expect(text).toMatch(/\(Vex — Empathy 17 vs 15: success\)/)
    expect(text).toMatch(/Oria: A private collector/)
  })

  it('asks one witness for their memory, meters, secrets learned and feelings toward the others', () => {
    const { system, user } = buildSummaryPrompt(content, playedScene(), 'oria-senn')
    expect(system).toMatch(/"much less", "less", "a little less", "unchanged"/)
    expect(system).toMatch(/Vex \[vex\]/)
    expect(user).toMatch(/Secret \[client-is-grid-corporation\]/)
    expect(user).toMatch(/approval 45, trust 25, attraction 30/)
    expect(buildSummaryPrompt(content, playedScene(), 'brask').user).toMatch(/left before the scene was over/)
  })
})

describe('parseSummary', () => {
  it('maps the words to numbers through the config table', () => {
    const s = parseSummary(content.ruleset, JSON.stringify({
      memory: 'Oria lied and Vex caught her.',
      level: 'Core',
      reason: 'Rook pressed her in public.',
      approval: 'a little less',
      trust: 'much_less',
      attraction: 'more',
      learned: ['client-is-grid-corporation'],
      others: [{ with: 'vex', approval: 'less', trust: 'unchanged', attraction: 'sideways', reason: 'She exposed me.' }]
    }))
    expect(s).toMatchObject({ level: 'core', delta: { approval: -1, trust: -8, attraction: 4 }, learned: ['client-is-grid-corporation'] })
    expect(s.others).toEqual([{ with: 'vex', delta: { approval: -4, trust: 0, attraction: 0 }, reason: 'She exposed me.' }])
  })

  it('takes a reply that is not JSON as the memory alone, changing nothing', () => {
    expect(parseSummary(content.ruleset, 'Vex watched Oria squirm.')).toMatchObject({ memory: 'Vex watched Oria squirm.', delta: { approval: 0, trust: 0, attraction: 0 } })
  })
})

describe('applySummaries', () => {
  it('stores memories, moves meters, records real secrets, updates relations and clears the scene', () => {
    const state = playedScene()
    const { state: next, reports } = applySummaries(content, state, [
      {
        id: 'oria-senn',
        summary: {
          memory: 'Oria lied and was caught.',
          level: 'normal',
          reason: 'Pressed in public.',
          delta: { approval: -4, trust: -1, attraction: 1 },
          learned: ['client-is-grid-corporation', 'made-up-secret'],
          others: [{ with: 'Vex', delta: { approval: -8, trust: -4, attraction: 0 }, reason: 'She exposed me.' }]
        }
      },
      { id: 'brask', summary: plainSummary(content, state, 'brask'), error: 'timeout' }
    ])
    expect(next.scene).toBeNull()
    expect(next.meters['oria-senn']).toEqual({ approval: 41, trust: 24, attraction: 31 })
    expect(next.facts['oria-senn']).toEqual([content.characters.find((c) => c.id === 'oria-senn')!.secrets[0]!.text])
    expect(next.memories.map((m) => m.owner)).toEqual(['oria-senn', 'brask'])
    expect(next.memories[0]!.about).toEqual(expect.arrayContaining(['player', 'vex', 'brask']))
    // Oria → Vex was approval 40: down to 32, still above the rivals line, so the seeded label stays.
    const toVex = next.relations.find((r) => r.from === 'oria-senn' && r.to === 'vex')!
    expect(toVex.meters).toEqual({ approval: 32, trust: 26, attraction: 15 })
    expect(toVex.label).toBe('useful acquaintance')
    expect(reports.find((r) => r.id === 'brask')).toMatchObject({ error: 'timeout', level: 'fleeting' })
    expect(GameStateSchema.parse(next)).toEqual(next)
  })

  it('creates a relation between witnesses who had none, and relabels one that changes band', () => {
    const state = playedScene()
    const { state: next } = applySummaries(content, state, [
      { id: 'brask', summary: { ...plainSummary(content, state, 'brask'), others: [{ with: 'oria-senn', delta: { approval: -8, trust: -8, attraction: 0 }, reason: '' }] } }
    ])
    const r = next.relations.find((x) => x.from === 'brask' && x.to === 'oria-senn')!
    expect(r.meters).toEqual({ approval: 42, trust: 32, attraction: 10 })
    expect(r.label).toBe('acquaintances')
    expect(bandOf(content.ruleset, { approval: 10, trust: 10, attraction: 0 })).toBe('enemies')
  })

  it('clamps meters to 0–100', () => {
    const state = playedScene()
    state.meters['vex'] = { approval: 98, trust: 2, attraction: 50 }
    const { state: next } = applySummaries(content, state, [{ id: 'vex', summary: { ...plainSummary(content, state, 'vex'), delta: { approval: 8, trust: -8, attraction: 0 } } }])
    expect(next.meters['vex']).toEqual({ approval: 100, trust: 0, attraction: 50 })
  })
})

describe('memories in later scenes', () => {
  it('ranks core first, then the most recent', () => {
    const m = (text: string, level: 'core' | 'normal' | 'fleeting', at: number) => ({ owner: 'vex', text, level, at, about: [] })
    expect(selectMemories([m('a', 'normal', 1), m('b', 'core', 0), m('c', 'normal', 5), m('d', 'fleeting', 9)], 3).map((x) => x.text)).toEqual(['b', 'c', 'a'])
  })

  it('reach the director, with the secrets the player already knows', () => {
    const state = playedScene()
    const { state: after } = applySummaries(content, state, [{ id: 'oria-senn', summary: { ...plainSummary(content, state, 'oria-senn'), memory: 'Oria was caught lying.', learned: ['client-is-grid-corporation'] } }])
    const again = { ...after, scene: barScene(3).scene }
    const { system } = buildDirectorPrompt(content, again, 'Hello again.')
    expect(system).toMatch(/Remembers: \(fleeting\) Oria was caught lying\./)
    expect(system).toMatch(/The player already knows: The 'private client' is the Aether Grid Corporation/)
  })
})
