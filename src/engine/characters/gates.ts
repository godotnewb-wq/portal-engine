import { rungIndex, type GatedAction, type Ruleset } from '@engine/rules'
import type { Character, Meters } from './schema'

/**
 * Gate profiles (npc design §6): what a character needs to feel toward someone before they'll act for them. A
 * requirement is worked out in a fixed order: the base word (the card's, else the ruleset's default for the action),
 * link shifts from their layers, the motive shift (the largest single one, down to that motive's floor), the card's
 * fixed words, and blockers last. "Never" is never shifted. The words come from the ruleset's ladder; the game keeps
 * the numbers and prompts get only words.
 */

/** One meter's requirement: its ladder word, and the meter value it needs (none for "no requirement"). */
export interface Requirement {
  word: string
  min?: number
  blocked: boolean
}

/** Actions a motive can shift (npc design §6): joining, the assist gate, and party tolerance. */
const MOTIVE_ACTIONS: readonly GatedAction[] = ['recruit', 'assist', 'warning', 'leave']

/** Whether the card has the layer entry a link names. */
function hasEntry(c: Character, link: Ruleset['people']['links'][number]): boolean {
  const L = c.layers
  if (!L) return false
  if (link.axis) return L.axes[link.axis] === link.stage || L.attachment[link.axis] === link.stage
  return L.values.some((v) => v.value === link.value && v.strength === link.strength)
}

/** The rung, by position on the ladder, a character needs on one meter for one action, before blockers. */
export function requirementRung(r: Ruleset, c: Character, action: GatedAction, meter: string): number {
  const p = r.people
  const top = p.ladder.length - 1
  const fixed = c.gates[action]?.fixed?.[meter]
  if (fixed !== undefined) return rungIndex(p, fixed)
  const baseWord = c.gates[action]?.base?.[meter] ?? p.gates[action]?.[meter]
  let rung = baseWord === undefined ? 0 : rungIndex(p, baseWord)
  if (rung === top) return top

  // Links shift the base up or down, staying off "never": only an outright word can block.
  const shift = p.links.filter((l) => l.action === action && l.meter === meter && hasEntry(c, l)).reduce((n, l) => n + l.shift, 0)
  rung = Math.max(0, Math.min(top - 1, rung + shift))

  // Motives step down by their strength, never below their floor and never raising a requirement already below it;
  // the largest shift wins, and shifts don't add up.
  if (MOTIVE_ACTIONS.includes(action)) {
    let best = rung
    for (const m of c.motives) {
      const type = p.motives.types.find((t) => t.id === m.type)
      const floorWord = type?.floors?.[meter]
      if (!type || floorWord === undefined || (action === 'assist' && !type.shiftsAssist)) continue
      const steps = p.motives.strengths.find((s) => s.word === m.strength)?.steps ?? 0
      best = Math.min(best, Math.max(rung - steps, Math.min(rung, rungIndex(p, floorWord))))
    }
    rung = best
  }
  return rung
}

/** One meter's requirement in words and numbers, blockers included. */
export function requirement(r: Ruleset, c: Character, action: GatedAction, meter: string): Requirement {
  if (c.blockers.some((b) => b.action === action)) return { word: r.people.ladder.at(-1)!.word, blocked: true }
  const rung = r.people.ladder[requirementRung(r, c, action, meter)]!
  return { word: rung.word, ...(rung.min !== undefined && { min: rung.min }), blocked: rung.blocked }
}

/** Whether a meter value meets a requirement. */
export const meets = (req: Requirement, value: number): boolean => !req.blocked && (req.min === undefined || value >= req.min)

/** The meters an action's gate looks at: those its default or the card name, so an action with none is open. */
function gatedMeters(r: Ruleset, c: Character, action: GatedAction): string[] {
  const named = new Set([...Object.keys(r.people.gates[action] ?? {}), ...Object.keys(c.gates[action]?.base ?? {}), ...Object.keys(c.gates[action]?.fixed ?? {})])
  return r.meters.list.map((m) => m.id).filter((m) => named.has(m))
}

/** Whether a character's feelings toward someone meet their gate for an action (blockers close it outright). */
export function gateMet(r: Ruleset, c: Character, action: GatedAction, toward: Meters): boolean {
  if (c.blockers.some((b) => b.action === action)) return false
  return gatedMeters(r, c, action).every((m) => meets(requirement(r, c, action, m), toward[m] ?? r.meters.neutral))
}

/**
 * Whether ladder words per meter are all met (voluntary disclosure, npc design §6): every meter named must pass, and a
 * meter left out asks nothing. The authored words are used as they are: no links, motives or blockers.
 */
export function wordsMet(r: Ruleset, words: Record<string, string>, toward: Meters): boolean {
  return Object.entries(words).every(([meter, w]) => {
    const rung = r.people.ladder[rungIndex(r.people, w)]
    if (!rung) return false
    return meets({ word: rung.word, ...(rung.min !== undefined && { min: rung.min }), blocked: rung.blocked }, toward[meter] ?? r.meters.neutral)
  })
}
