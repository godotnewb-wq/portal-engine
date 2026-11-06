import type { Beat, GameState } from '@engine/state'
import { finishedPart, parseReply } from '@engine/scene'
import { characterById, locationById, type Pack } from '@engine/pack'
import { firstName } from '@engine/core'
import { sceneSpeakers } from '@engine/scene'

/** A beat as the text box shows it: whose it is, which turn it belongs to, and that turn's check lines. */
export interface ShownBeat {
  beat: Beat
  /** -1 for the scene's opening, before the player has said anything. */
  turn: number
  /** The player's line this beat answers, shown on the first beat of a turn when reading back. */
  said?: string
  /** 1-based within its turn (or the opening), and how many beats that turn has; unknown while it streams. */
  n: number
  of?: number
}

/** The scene's opening narration: where you are and who is with you. Not stored; it is the same every time. */
export function openingBeats(content: Pack, state: GameState): Beat[] {
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
export function sceneHistory(content: Pack, state: GameState): ShownBeat[] {
  const scene = state.scene!
  const opening = openingBeats(content, state)
  return [
    ...opening.map((beat, i) => ({ beat, turn: -1, n: i + 1, of: opening.length })),
    ...scene.turns.flatMap((t, turn) => t.beats.map((beat, i) => ({ beat, turn, n: i + 1, of: t.beats.length, ...(i === 0 && { said: t.player }) })))
  ]
}

/**
 * The per-turn beat counter (milestone 2, A3): "beat 3 of 5" within the turn on screen, which says more than a count
 * across the whole scene. While a turn streams its total isn't known yet.
 */
export function beatCounter(shown: ShownBeat): string {
  if (shown.turn < 0) return `opening ${shown.n} of ${shown.of}`
  return `turn ${shown.turn + 1} · beat ${shown.n} of ${shown.of ?? '…'}`
}

/** The beats of a reply still streaming in: only the lines that have finished. */
export function streamingBeats(content: Pack, state: GameState, streamed: string): Beat[] {
  return parseReply(finishedPart(streamed), sceneSpeakers(content, state)).beats
}

/** The name on a beat's nameplate: a character's first name, a walk-on's name, or nothing for narration. */
export function nameplate(content: Pack, state: GameState, beat: Beat): string | undefined {
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
