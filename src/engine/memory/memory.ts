// Recall began as selectMemories, adapted from Breedhaven University, src/shared/game/memory.ts (GPL-3.0-only); see
// NOTICE.md. Milestone 4b replaced its ranking with relevance and the Core share.

import type { Character } from '@engine/characters'
import type { Ruleset } from '@engine/rules'
import type { GameState, Memory } from '@engine/state'

/** What a scene is about, for recall (memory §6): the people in it (the player included) and the place. */
export interface RecallContext {
  people: string[]
  place?: string
}

/** The scene's people and place, or nobody and nowhere between scenes. */
export function recallContext(state: GameState): RecallContext {
  const scene = state.scene
  if (!scene) return { people: ['player'] }
  return { people: ['player', ...scene.cast.filter((id) => !scene.departed.includes(id))], place: scene.locationId }
}

/** How much a memory is about this scene: one point per person in it, one for the place. */
export function relevance(m: Memory, context: RecallContext): number {
  return m.about.filter((p) => context.people.includes(p)).length + (context.place && m.place === context.place ? 1 : 0)
}

const recency = (m: Memory) => m.revisited ?? m.at

/**
 * Relevance-based recall (memory §6; decided 2026-11-13): of the memories still in recall, Core ones take at most
 * about the ruleset's `coreShare` of the slots, ranked by relevance, then the most recent and most revisited; the rest
 * go to Normal and Fleeting by relevance, then recency. Slots one side can't fill go to the other.
 */
export function selectMemories(r: Ruleset, memories: Memory[], slots: number, context: RecallContext): Memory[] {
  const pool = memories.filter((m) => m.inRecall)
  const byRelevance = (a: Memory, b: Memory) => relevance(b, context) - relevance(a, context) || recency(b) - recency(a)
  const cores = pool.filter((m) => m.level === 'core').sort((a, b) => byRelevance(a, b) || b.revisits - a.revisits)
  const rest = pool.filter((m) => m.level !== 'core').sort(byRelevance)
  const share = Math.round(slots * r.memory.coreShare)
  const restTake = Math.min(rest.length, slots - Math.min(cores.length, share))
  const coreTake = Math.min(cores.length, slots - restTake)
  return [...cores.slice(0, coreTake), ...rest.slice(0, restTake)]
}

/** A character's memories for a scene, up to the ruleset's budget for their tier (memory §3); party membership doesn't change it. */
export function recall(r: Ruleset, state: GameState, character: Character, context: RecallContext = recallContext(state)): Memory[] {
  return selectMemories(
    r,
    state.memories.filter((m) => m.owner === character.id),
    r.memory.recall[character.tier],
    context
  )
}

/** The next memory id for a character: `<owner>.m<n>`. */
export function memoryId(memories: Memory[], owner: string): string {
  const prefix = `${owner}.m`
  const n = memories.filter((m) => m.id.startsWith(prefix)).map((m) => Number(m.id.slice(prefix.length))).filter(Number.isFinite)
  return `${prefix}${n.length > 0 ? Math.max(...n) + 1 : 1}`
}

const DAY = 24 * 60

/**
 * Fading (memory §6; decided): measured in in-game days since a memory's clock last started. A Normal memory steps down
 * to Fleeting after the ruleset's `fade.normal` days, its clock restarting; a Fleeting one leaves recall after
 * `fade.fleeting`; Core never fades. Nothing leaves the save. Worked out from the days passed, so running it twice on
 * one day changes nothing.
 */
export function fadeMemories(r: Ruleset, memories: Memory[], now: number): Memory[] {
  return memories.map((m) => {
    if (!m.inRecall || m.level === 'core') return m
    let x = m
    if (x.level === 'normal' && now - x.fadeFrom >= r.memory.fade.normal * DAY) x = { ...x, level: 'fleeting', fadeFrom: x.fadeFrom + r.memory.fade.normal * DAY }
    if (x.level === 'fleeting' && now - x.fadeFrom >= r.memory.fade.fleeting * DAY) x = { ...x, inRecall: false }
    return x
  })
}
