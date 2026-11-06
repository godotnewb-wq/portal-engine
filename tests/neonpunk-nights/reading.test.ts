import { describe, expect, it } from 'vitest'
import { barScene, content } from './support'
import { atEnd, awaitingBeat, canAdvance, nameplate, openingBeats, sceneHistory, streamingBeats } from '@app/renderer/src/ui/reading'

describe('reading the scene', () => {
  it('opens with the place and who is here', () => {
    const beats = openingBeats(content, barScene())
    expect(beats).toHaveLength(2)
    expect(beats[1]!.text).toBe('Vex, Brask and Oria are here with you.')
  })

  it('puts each turn’s beats after the opening, marking the line each turn answers', () => {
    const state = barScene()
    state.scene!.turns.push({ player: 'Hi.', beats: [{ kind: 'dialogue', speaker: 'vex', text: 'Hey.' }, { kind: 'narration', text: 'Brask nods.' }], checks: [], speakers: ['vex'], texture: [] })
    const history = sceneHistory(content, state)
    expect(history.map((h) => h.turn)).toEqual([-1, -1, 0, 0])
    expect(history[2]).toMatchObject({ said: 'Hi.' })
    expect(history[3]!.said).toBeUndefined()
  })

  it('shows streamed beats only once their line is finished, without hidden tags', () => {
    const state = barScene()
    expect(streamingBeats(content, state, 'NARRATION: Water ticks.\nOria: "A private')).toEqual([{ kind: 'narration', text: 'Water ticks.' }])
    expect(streamingBeats(content, state, 'Oria: "Darling."\n[Vex: EXPRESSION smirk]\n')).toEqual([{ kind: 'dialogue', speaker: 'oria-senn', text: 'Darling.' }])
  })

  it('names a beat by first name, walk-on name, or not at all for narration', () => {
    const state = barScene()
    expect(nameplate(content, state, { kind: 'dialogue', speaker: 'oria-senn', text: '' })).toBe('Oria')
    expect(nameplate(content, state, { kind: 'dialogue', speaker: 'bartender', text: '' })).toBe('Dunmar')
    expect(nameplate(content, state, { kind: 'narration', text: '' })).toBeUndefined()
  })

  it('waits for streamed beats at the end, and lets the player speak once it is all read', () => {
    expect(awaitingBeat({ index: 2, total: 3, streaming: true })).toBe(true)
    expect(canAdvance({ index: 1, total: 3, streaming: true })).toBe(true)
    expect(atEnd({ index: 2, total: 3, streaming: true })).toBe(false)
    expect(atEnd({ index: 2, total: 3, streaming: false })).toBe(true)
  })
})
