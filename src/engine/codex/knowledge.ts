import { factionChain, levelRank, parentLevel, type FactionLevel, type Setting } from '@engine/world'
import type { CodexEntry, Selector } from './schema'

/** Who someone is, as far as the knowledge filter cares (claude/lore-injection.md §7). Any field may be blank. */
export interface Knower {
  id: string
  name: string
  species: string
  faction?: string
  level?: FactionLevel
  occupation?: string
  /** Codex secrets their own secrets point to. */
  holds: string[]
}

/**
 * Their standing in each faction up their sub-group chain: their own level in their own faction, one step lower in
 * each parent, never above trusted. No level means no standing anywhere.
 */
export function standings(setting: Setting, k: Pick<Knower, 'faction' | 'level'>): Map<string, FactionLevel> {
  const out = new Map<string, FactionLevel>()
  if (!k.faction || !k.level) return out
  let level: FactionLevel | undefined = k.level
  for (const f of factionChain(setting, k.faction)) {
    if (!level) break
    out.set(f.id, level)
    level = parentLevel(level)
  }
  return out
}

/** Whether someone fits a selector. A tier selector fits no one yet: characters don't record where they live. */
export function fits(setting: Setting, s: Selector, k: Knower): boolean {
  switch (s.by) {
    case 'faction': {
      const level = standings(setting, k).get(s.faction)
      return level !== undefined && levelRank(level) >= levelRank(s.level)
    }
    case 'occupation':
      return !!k.occupation && k.occupation.toLowerCase() === s.occupation
    case 'species':
      return k.species === s.species
    case 'character':
      return k.id === s.character
    case 'tier':
      return false
  }
}

/** Whether someone knows an entry: everyone knows common ones; circles by `circle` or `also`; secrets only by holding them. */
export function knows(setting: Setting, e: CodexEntry, k: Knower): boolean {
  if (e.knowledge === 'common') return true
  if (e.knowledge === 'secret') return k.holds.includes(e.id)
  return [...(e.circle ? [e.circle] : []), ...e.also].some((s) => fits(setting, s, k))
}

/** Whether someone may hold a secret (its `known-by`), whether or not they do. */
export const mayHold = (setting: Setting, e: CodexEntry, k: Knower) => e.knownBy.some((s) => fits(setting, s, k))
