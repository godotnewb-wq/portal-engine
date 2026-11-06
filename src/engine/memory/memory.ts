// selectMemories adapted from Breedhaven University, src/shared/game/memory.ts (GPL-3.0-only). See NOTICE.md.

import type { Character } from '@engine/characters'
import type { GameState, Memory } from '@engine/state'

const LEVELS = ['core', 'normal', 'fleeting'] as const

/** How many memories a character brings to a scene, by tier (quests-relationships-npcs §5, tune). */
export const RECALL = { recurring: 4, companion: 8 } as const

/** A character's memories worth bringing to a scene: core first, then the most recent. */
export function selectMemories(memories: Memory[], limit: number): Memory[] {
  const rank = (memory: Memory) => LEVELS.indexOf(memory.level)
  return memories
    .map((memory, order) => ({ memory, order }))
    .sort((a, b) => rank(a.memory) - rank(b.memory) || b.memory.at - a.memory.at || b.order - a.order)
    .slice(0, limit)
    .map(({ memory }) => memory)
}

export function recall(state: GameState, character: Character): Memory[] {
  return selectMemories(
    state.memories.filter((m) => m.owner === character.id),
    RECALL[character.tier]
  )
}
