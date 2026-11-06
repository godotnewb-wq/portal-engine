import { assistFrom, averageStats, describeCheck, rollCheck, type Edge, type Ruleset, type StatBlock } from '@engine/rules'
import { type Character } from '@engine/characters'
import { type GameState } from '@engine/state'
import { characterById, type Pack } from '@engine/pack'
import { dice, type Dice } from '@engine/core'
import type { BeatPlan, PlannedCheck } from './plan'

/**
 * Someone without a stat block (a recurring NPC, until tier templates exist) rolls as an average adult: every
 * attribute at the ruleset's average, no trained skills.
 */
export function statsOf(r: Ruleset, character: Character): StatBlock {
  return character.stats ?? averageStats(r)
}

/**
 * The helper's assist meter (the ruleset says which, e.g. trust) toward the one they're helping: the player through
 * the helper's meters, anyone else through their relation.
 */
function assistMeter(r: Ruleset, state: GameState, helper: string, who: string): number {
  const meter = r.assists.meter
  if (who === 'player') return state.meters[helper]?.[meter] ?? 0
  return state.relations.find((x) => x.from === helper && x.to === who)?.meters[meter] ?? 0
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
    let bonus = 0
    let assisted: PlannedCheck['assisted']
    if (check.assist) {
      const helper = characterById(content, check.assist)!
      const meter = assistMeter(r, state, helper.id, check.who)
      const help = assistFrom(r, { stats: statsOf(r, helper), meter }, check.skill)
      bonus += help.bonus
      edges.push(help.edge)
      assisted = { by: helper.id, bonus: help.bonus, edge: help.edge, meter }
    }
    const result = rollCheck(r, stats, { skill: check.skill, difficulty: check.difficulty, edges, bonus }, rng)
    const name = check.who === 'player' ? state.player.name : roller!.name.split(' ')[0]!
    return { ...check, result, line: describeCheck(r, name, result), ...(assisted && { assisted }) }
  })
  return { plan: { ...plan, checks }, dice: rng.state }
}
