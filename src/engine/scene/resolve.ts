import { assistBonus, averageStats, describeCheck, rankOf, rollCheck, type Edge, type Ruleset, type StatBlock } from '@engine/rules'
import { gateMet, wordsMet, type Character, type Meters } from '@engine/characters'
import { type GameState } from '@engine/state'
import { characterById, type Pack } from '@engine/pack'
import { dice, type Dice } from '@engine/core'
import { presentCast, type BeatPlan } from './planShape'

/**
 * Someone without a stat block (a recurring NPC, until tier templates exist) rolls as an average adult: every
 * attribute at the ruleset's average, no trained skills.
 */
export function statsOf(r: Ruleset, character: Character): StatBlock {
  return character.stats ?? averageStats(r)
}

/** How a character feels toward someone: the player through their meters, anyone else through their relation (a stranger: the ruleset's start). */
export function feelingsToward(r: Ruleset, state: GameState, from: string, to: string): Meters {
  if (to === 'player') return state.meters[from] ?? r.relations.start
  return state.relations.find((x) => x.from === from && x.to === to)?.meters ?? r.relations.start
}

/**
 * Voluntary disclosure (npc design §6): whether a holder would choose to share one of their secrets with a listener,
 * by the secret's own minimums against the holder's feelings toward them. A secret with no minimums asks nothing (its
 * `revealWhen` prose still guides the director). Discovery, and hearing it from someone else, never go through this.
 */
export function wouldDisclose(content: Pack, state: GameState, holder: string, secretId: string, listener: string): boolean {
  const c = characterById(content, holder)
  const secret = c?.secrets.find((s) => s.id === secretId)
  if (!secret?.disclose) return true
  return wordsMet(content.ruleset, secret.disclose, feelingsToward(content.ruleset, state, holder, listener))
}

/** The party members present who would back someone up: their assist gate toward them is met (core rules §1). Skill aside. */
export function willingHelpers(content: Pack, state: GameState, who: string): string[] {
  const r = content.ruleset
  // Only the player and companions are helped; only companions help.
  if (who !== 'player' && !state.party.includes(who)) return []
  const here = state.scene ? presentCast(state.scene) : []
  return state.party.filter((id) => id !== who && here.includes(id)).filter((id) => {
    const c = characterById(content, id)
    return !!c && gateMet(r, c, 'assist', feelingsToward(r, state, id, who))
  })
}

/**
 * Who helps with a check (core rules §1): willing companions present with at least the ruleset's rank in the skill.
 * Worked out when the check resolves, with no LLM; a companion whose gate isn't met adds nothing and never hinders.
 */
export function helpersFor(content: Pack, state: GameState, who: string, skill: string): string[] {
  const r = content.ruleset
  return willingHelpers(content, state, who).filter((id) => rankOf(statsOf(r, characterById(content, id)!), skill) >= r.assists.minRank)
}

export interface ResolveOptions {
  /**
   * Every die shows this number, and the dice don't move on. For the test bench only, so a scenario can be run with a
   * check that must succeed or must fail.
   */
  forceNatural?: number
}

/**
 * Rolls every check in the plan with the game's dice and writes the results in, so the writer is told what happened
 * rather than deciding it. Returns the plan and the dice's new state.
 */
export function resolvePlan(content: Pack, state: GameState, plan: BeatPlan, options: ResolveOptions = {}): { plan: BeatPlan; dice: number } {
  const forced = options.forceNatural
  const rng: Dice = forced !== undefined ? { roll: () => forced, state: state.dice } : dice(state.dice)
  const checks = plan.checks.map((check) => {
    const roller = check.who === 'player' ? undefined : characterById(content, check.who)
    const r = content.ruleset
    const stats = check.who === 'player' ? state.player.stats : statsOf(r, roller!)
    const edges: Edge[] = check.edge ? [check.edge] : []
    const helpers = helpersFor(content, state, check.who, check.skill)
    const bonus = assistBonus(r, helpers.length)
    const result = rollCheck(r, stats, { skill: check.skill, difficulty: check.difficulty, edges, bonus }, rng)
    const name = check.who === 'player' ? state.player.name : roller!.name.split(' ')[0]!
    // The chip names the helpers ("+3: Ada, Ben").
    const helped = helpers.length > 0 ? ` (+${bonus}: ${helpers.map((id) => characterById(content, id)!.name.split(' ')[0]).join(', ')})` : ''
    return { ...check, result, line: describeCheck(r, name, result) + helped, ...(helpers.length > 0 && { helpers }) }
  })
  return { plan: { ...plan, checks }, dice: rng.state }
}
