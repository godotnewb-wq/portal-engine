import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applySummaries, plainSummary } from '@engine/relationships'
import { createInitialState, stateProblems } from '@engine/state'
import { barScene, content } from './support'
import { latestSave } from '@engine/state'
import { SaveStore } from '@platform/saves'

/** How these saves are marked: the Neonpunk Nights pack as shipped. */
const PACK = { id: content.manifest.id, version: content.manifest.version }
const tempDir = () => join(mkdtempSync(join(tmpdir(), 'npn-saves-')), 'saves')

/** A game with a finished scene behind it: memories, moved meters, a new relation, a learned secret. */
function playedGame() {
  const state = barScene(4)
  state.scene!.turns.push({ id: 't1', player: 'Hi.', beats: [{ kind: 'narration', text: 'The pipe drips.' }], checks: [], speakers: [], texture: [] })
  return applySummaries(content, state, [
    {
      id: 'oria-senn',
      summary: {
        ...plainSummary(content, state, 'oria-senn'),
        memory: 'Oria was caught lying.',
        level: 'core',
        delta: { approval: -4, trust: -8, attraction: 1 },
        learned: ['client-is-grid-corporation'],
        others: [{ with: 'brask', delta: { approval: 1, trust: 0, attraction: 0 }, reason: '' }]
      }
    }
  ]).state
}

describe('SaveStore', () => {
  it('lists nothing when there are no saves', () => {
    expect(new SaveStore(tempDir(), PACK).list()).toEqual([])
  })

  it('round-trips memories, meters, relations and facts (acceptance 8)', () => {
    const store = new SaveStore(tempDir(), PACK)
    const state = playedGame()
    store.save('slot2', state)
    const loaded = store.load('slot2')
    expect(loaded).toEqual(state)
    expect(loaded.memories[0]).toMatchObject({ owner: 'oria-senn', text: 'Oria was caught lying.', level: 'core' })
    expect(loaded.meters['oria-senn']).toEqual({ approval: 41, trust: 17, attraction: 31 })
    expect(loaded.relations.some((r) => r.from === 'oria-senn' && r.to === 'brask')).toBe(true)
    expect(loaded.facts['oria-senn']).toHaveLength(1)
  })

  // Milestone 3.6, task 8: the write is flushed before the rename, and a write cut off before its rename leaves nothing behind.
  it('clears a temporary file an interrupted write left, and keeps the slot’s last save', () => {
    const dir = tempDir()
    const store = new SaveStore(dir, PACK)
    const state = barScene(5)
    store.save('slot1', state)
    writeFileSync(join(dir, 'slot1.json.tmp'), '{"cut off')
    writeFileSync(join(dir, 'auto.json.tmp'), '')
    expect(store.list().map((s) => s.slotId)).toEqual(['slot1'])
    expect(readdirSync(dir).sort()).toEqual(['slot1.json'])
    expect(store.load('slot1')).toEqual(state)
    store.save('slot1', barScene(6))
    expect(readdirSync(dir)).toEqual(['slot1.json'])
  })

  it('round-trips a scene still in progress, dice included, so play resumes mid-scene', () => {
    const store = new SaveStore(tempDir(), PACK)
    const state = barScene(77)
    state.scene!.turns.push({ id: 't1', player: 'Hi.', beats: [{ kind: 'dialogue', speaker: 'vex', text: 'Hey.' }], checks: [], speakers: ['vex'], texture: [] })
    state.scene!.comfort['brask'] = 2
    store.save('auto', state)
    expect(store.load('auto')).toEqual(state)
  })

  it('summarises saves for the slot list, and finds the latest', () => {
    const dir = tempDir()
    const store = new SaveStore(dir, PACK)
    store.save('slot1', playedGame(), new Date('2026-01-01T10:00:00Z'), 'After the bar')
    store.save('auto', barScene(), new Date('2026-01-02T10:00:00Z'))
    expect(store.list()).toEqual([
      { slotId: 'auto', savedAt: '2026-01-02T10:00:00.000Z', unreadable: false, packVersion: '0.1.0', playerName: 'Rook', time: 1200, inScene: true, turns: 0, memories: 0 },
      { slotId: 'slot1', savedAt: '2026-01-01T10:00:00.000Z', unreadable: false, name: 'After the bar', packVersion: '0.1.0', playerName: 'Rook', time: 1200, inScene: false, turns: 0, memories: 1 }
    ])
    expect(latestSave(store.list())?.slotId).toBe('auto')
    expect(readdirSync(dir).sort()).toEqual(['auto.json', 'slot1.json'])
  })

  it('keeps a slot’s name when it is saved over without one, and deletes', () => {
    const store = new SaveStore(tempDir(), PACK)
    store.save('slot1', barScene(), new Date(), 'Mine')
    store.save('slot1', playedGame())
    expect(store.list()[0]).toMatchObject({ name: 'Mine', inScene: false })
    store.delete('slot1')
    expect(store.list()).toEqual([])
    expect(() => store.load('slot1')).toThrow('Slot 1 is empty')
  })

  it('lists a save it cannot read instead of hiding it, and refuses to load it', () => {
    const dir = tempDir()
    const store = new SaveStore(dir, PACK)
    store.save('slot3', barScene())
    writeFileSync(join(dir, 'slot3.json'), '{"version": 0}')
    expect(store.list()).toEqual([expect.objectContaining({ slotId: 'slot3', unreadable: true })])
    expect(() => store.load('slot3')).toThrow('Slot 3 could not be read')
  })
})

describe('saves and packs', () => {
  it('records the pack, and refuses a save made with another pack', () => {
    const dir = tempDir()
    new SaveStore(dir, { id: 'other-pack', version: '1.0.0' }).save('slot1', barScene())
    expect(() => new SaveStore(dir, PACK).load('slot1')).toThrow('Slot 1 belongs to the pack "other-pack"')
  })

  it('loads a save from another version of the same pack, for the caller to check against the content', () => {
    const dir = tempDir()
    new SaveStore(dir, { ...PACK, version: '0.0.9' }).save('slot1', barScene())
    expect(new SaveStore(dir, PACK).list()[0]).toMatchObject({ packVersion: '0.0.9' })
    expect(new SaveStore(dir, PACK).load('slot1')).toEqual(barScene())
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

  it('refuses a game whose meters are not the pack’s', () => {
    const state = barScene()
    state.meters['vex'] = { approval: 1, trust: 1 }
    expect(stateProblems(content, state)).toEqual(["its relationship meters aren't this pack's (approval, attraction, trust)"])
  })
})
