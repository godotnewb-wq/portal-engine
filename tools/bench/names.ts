import { characterById, locationById, type Pack } from '@engine/pack'
import { firstName } from '@engine/core'

/** A display name for an id in a scenario's place: a character's first name, a walk-on's name, or the id. */
export function nameIn(content: Pack, location: string, id: string): string {
  const c = characterById(content, id)
  if (c) return firstName(c.name)
  const w = locationById(content, location)?.walkOns.find((x) => x.id === id)
  return w?.name ?? w?.label ?? id
}
