import type { Beat, GameState } from '@engine/state'
import { finishedPart, parseReply } from '@engine/scene'
import { characterById, locationById, type Content } from '@engine/pack'
import { firstName } from '@engine/core'
import { sceneSpeakers } from '@engine/scene'

/** A beat as the text box shows it: whose it is, which turn it belongs to, and that turn's check lines. */
export interface ShownBeat {
  beat: Beat
  /** -1 for the scene's opening, before the player has said anything. */
  turn: number
  /** The player's line this beat answers, shown on the first beat of a turn when reading back. */
  said?: string
}

/** The scene's opening narration: where you are and who is with you. Not stored; it is the same every time. */
export function openingBeats(content: Content, state: GameState): Beat[] {
  const scene = state.scene!
  const location = locationById(content, scene.locationId)!
  const names = scene.cast.map((id) => firstName(characterById(content, id)?.name ?? id))
  const company = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  return [
    { kind: 'narration', text: location.description },
    ...(company ? [{ kind: 'narration' as const, text: `${company} ${names.length > 1 ? 'are' : 'is'} here with you.` }] : [])
  ]
}

/** Every beat of the scene so far, in order: the opening, then each turn's. */
export function sceneHistory(content: Content, state: GameState): ShownBeat[] {
  const scene = state.scene!
  return [
    ...openingBeats(content, state).map((beat) => ({ beat, turn: -1 })),
    ...scene.turns.flatMap((t, turn) => t.beats.map((beat, i) => ({ beat, turn, ...(i === 0 && { said: t.player }) })))
  ]
}

/** The beats of a reply still streaming in: only the lines that have finished. */
export function streamingBeats(content: Content, state: GameState, streamed: string): Beat[] {
  return parseReply(finishedPart(streamed), sceneSpeakers(content, state)).beats
}

/** The name on a beat's nameplate: a character's first name, a walk-on's name, or nothing for narration. */
export function nameplate(content: Content, state: GameState, beat: Beat): string | undefined {
  if (beat.kind === 'narration') return undefined
  const character = characterById(content, beat.speaker)
  if (character) return firstName(character.name)
  const walkOn = locationById(content, state.scene!.locationId)?.walkOns.find((w) => w.id === beat.speaker)
  if (walkOn) return walkOn.name ?? walkOn.label
  return beat.speaker
}

/**
 * Where reading stands. `index` is the beat on screen within `total` beats; while a reply streams, more may arrive.
 * The player may type once they have read to the end and nothing is pending.
 */
export interface Reading {
  index: number
  total: number
  streaming: boolean
}

export const canAdvance = (r: Reading): boolean => r.index < r.total - 1
export const canGoBack = (r: Reading): boolean => r.index > 0
/** Waiting for the next beat to stream in. */
export const awaitingBeat = (r: Reading): boolean => r.streaming && r.index >= r.total - 1
export const atEnd = (r: Reading): boolean => !r.streaming && r.index >= r.total - 1
