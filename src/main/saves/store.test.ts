import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applySummaries, plainSummary } from '../../shared/game/summary'
import { createInitialState, stateProblems } from '../../shared/game/state'
import { barScene, content } from '../../shared/game/testScene'
import { latestSave } from '../../shared/saves'
import { SaveStore } from './store'

const tempDir = () => join(mkdtempSync(join(tmpdir(), 'npn-saves-')), 'saves')

/** A game with a finished scene behind it: memories, moved meters, a new relation, a learned secret. */
function playedGame() {
  const state = barScene(4)
  state.scene!.turns.push({ player: 'Hi.', beats: [{ kind: 'narration', text: 'The pipe drips.' }], checks: [], speakers: [], texture: [] })
  return applySummaries(content, state, [
    {
      id: 'oria-senn',
      summary: {
        ...plainSummary(content, state, 'oria-senn'),
        memory: 'Oria was caught lying.',
        level: 'core',
        delta: { approval: -4, trust: -8, attraction: 1 },
        learned: ['client-is-consortium'],
        others: [{ with: 'brask', delta: { approval: 1, trust: 0, attraction: 0 }, reason: '' }]
      }
    }
  ]).state
}

describe('SaveStore', () => {
  it('lists nothing when there are no saves', () => {
    expect(new SaveStore(tempDir()).list()).toEqual([])
  })

  it('round-trips memories, meters, relations and facts (acceptance 8)', () => {
    const store = new SaveStore(tempDir())
    const state = playedGame()
    store.save('slot2', state)
    const loaded = store.load('slot2')
    expect(loaded).toEqual(state)
    expect(loaded.memories[0]).toMatchObject({ owner: 'oria-senn', text: 'Oria was caught lying.', level: 'core' })
    expect(loaded.meters['oria-senn']).toEqual({ approval: 41, trust: 17, attraction: 31 })
    expect(loaded.relations.some((r) => r.from === 'oria-senn' && r.to === 'brask')).toBe(true)
    expect(loaded.facts['oria-senn']).toHaveLength(1)
  })

  it('round-trips a scene still in progress, dice included, so play resumes mid-scene', () => {
    const store = new SaveStore(tempDir())
    const state = barScene(77)
    state.scene!.turns.push({ player: 'Hi.', beats: [{ kind: 'dialogue', speaker: 'vex', text: 'Hey.' }], checks: [], speakers: ['vex'], texture: [] })
    state.scene!.comfort['brask'] = 2
    store.save('auto', state)
    expect(store.load('auto')).toEqual(state)
  })

  it('summarises saves for the slot list, and finds the latest', () => {
    const dir = tempDir()
    const store = new SaveStore(dir)
    store.save('slot1', playedGame(), new Date('2026-01-01T10:00:00Z'), 'After the bar')
    store.save('auto', barScene(), new Date('2026-01-02T10:00:00Z'))
    expect(store.list()).toEqual([
      { slotId: 'auto', savedAt: '2026-01-02T10:00:00.000Z', unreadable: false, playerName: 'Rook', time: 1200, inScene: true, turns: 0, memories: 0 },
      { slotId: 'slot1', savedAt: '2026-01-01T10:00:00.000Z', unreadable: false, name: 'After the bar', playerName: 'Rook', time: 1200, inScene: false, turns: 0, memories: 1 }
    ])
    expect(latestSave(store.list())?.slotId).toBe('auto')
    expect(readdirSync(dir).sort()).toEqual(['auto.json', 'slot1.json'])
  })

  it('keeps a slot’s name when it is saved over without one, and deletes', () => {
    const store = new SaveStore(tempDir())
    store.save('slot1', barScene(), new Date(), 'Mine')
    store.save('slot1', playedGame())
    expect(store.list()[0]).toMatchObject({ name: 'Mine', inScene: false })
    store.delete('slot1')
    expect(store.list()).toEqual([])
    expect(() => store.load('slot1')).toThrow('Slot 1 is empty')
  })

  it('lists a save it cannot read instead of hiding it, and refuses to load it', () => {
    const dir = tempDir()
    const store = new SaveStore(dir)
    store.save('slot3', barScene())
    writeFileSync(join(dir, 'slot3.json'), '{"version": 0}')
    expect(store.list()).toEqual([expect.objectContaining({ slotId: 'slot3', unreadable: true })])
    expect(() => store.load('slot3')).toThrow('Slot 3 could not be read')
  })
})

describe('stateProblems', () => {
  it('accepts a game that fits the content', () => {
    expect(stateProblems(content, playedGame())).toEqual([])
    expect(stateProblems(content, createInitialState(content, 1))).toEqual([])
  })

  it('names what a save refers to that the content no longer has', () => {
    const state = barScene()
    state.meters['ghost'] = { approval: 1, trust: 1, attraction: 1 }
    state.scene!.walkOns.push('bouncer')
    expect(stateProblems(content, state)).toEqual(['meters names unknown character "ghost"', 'the scene has unknown walk-on "bouncer"'])
  })
})
