import type { Character, Player } from '@engine/characters'
import type { Location } from '@engine/world'
import { rankCap } from '@engine/rules'

/** Everything one game is played with. */
export interface Content {
  characters: Character[]
  locations: Location[]
  player: Player
}

/**
 * Problems that zod can't see because they span files: duplicate ids, relations to someone who doesn't exist,
 * skill ranks above what a level allows. Empty when the content is sound.
 */
export function contentProblems(content: Content): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const seen = (kind: string, id: string) => {
    if (ids.has(id)) problems.push(`${kind} id "${id}" is used twice`)
    ids.add(id)
  }
  for (const c of content.characters) seen('character', c.id)
  for (const l of content.locations) {
    seen('location', l.id)
    for (const w of l.walkOns) seen(`walk-on in ${l.id}`, w.id)
  }
  const characters = new Set(content.characters.map((c) => c.id))
  for (const c of content.characters) {
    for (const r of c.relations) {
      if (!characters.has(r.to)) problems.push(`${c.id} has a relation to unknown character "${r.to}"`)
      if (r.to === c.id) problems.push(`${c.id} has a relation to themself`)
    }
  }
  const stats = [
    ...content.characters.flatMap((c) => (c.stats ? [{ who: c.id, stats: c.stats }] : [])),
    { who: 'player', stats: content.player.stats }
  ]
  for (const { who, stats: block } of stats) {
    for (const [skill, rank] of Object.entries(block.skills)) {
      if ((rank ?? 0) > rankCap(block.level)) problems.push(`${who}'s ${skill} rank ${rank} is above the cap for level ${block.level}`)
    }
  }
  return problems
}

export const characterById = (content: Content, id: string): Character | undefined => content.characters.find((c) => c.id === id)
export const locationById = (content: Content, id: string): Location | undefined => content.locations.find((l) => l.id === id)
