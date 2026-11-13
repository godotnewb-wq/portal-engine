import { characterById, type Pack } from '@engine/pack'
import { firstName } from '@engine/core'
import type { GameState } from '@engine/state'
import { presentCast } from './planShape'

/**
 * The child guard (director writer §5, decided 2026-11-06): when a character whose age stage the ruleset counts as a
 * minor is present, the director and the writer get an engine line, which no pack can turn off, saying so and keeping
 * them out of anything romantic or sexual. Empty when no minor is present.
 */
export function childGuard(content: Pack, state: GameState): string {
  const minors = content.ruleset.people.ages.minors
  const here = state.scene ? presentCast(state.scene) : []
  const young = here.map((id) => characterById(content, id)).filter((c) => c?.age !== undefined && minors.includes(c.age))
  if (young.length === 0) return ''
  const list = young.map((c) => `${firstName(c!.name)} (${c!.age})`).join(', ')
  return `# Minors present\n${list} ${young.length === 1 ? 'is a minor' : 'are minors'}. Nothing romantic or sexual involves them or is directed at them.`
}
