// selectMemories adapted from Breedhaven University, src/shared/game/memory.ts (GPL-3.0-only). See NOTICE.md.

import type { Character } from '@engine/characters'
import type { Ruleset } from '@engine/rules'
import type { GameState, Memory } from '@engine/state'

const LEVELS = ['core', 'normal', 'fleeting'] as const


/** A character's memories worth bringing to a scene: core first, then the most recent. */
export function selectMemories(memories: Memory[], limit: number): Memory[] {
  const rank = (memory: Memory) => LEVELS.indexOf(memory.level)
  return memories
    .map((memory, order) => ({ memory, order }))
    .sort((a, b) => rank(a.memory) - rank(b.memory) || b.memory.at - a.memory.at || b.order - a.order)
    .slice(0, limit)
    .map(({ memory }) => memory)
}

/** A character's memories for a scene, up to the ruleset's budget for their tier (memory §3); party membership doesn't change it. */
export function recall(r: Ruleset, state: GameState, character: Character): Memory[] {
  return selectMemories(
    state.memories.filter((m) => m.owner === character.id),
    r.memory.recall[character.tier]
  )
}
