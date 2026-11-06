import { ATTRIBUTES, type StatBlock } from '@engine/rules'
import { type Character } from '@engine/characters'
import { type GameState } from '@engine/state'
import { assistFrom, describeCheck, rollCheck, type Edge } from '@engine/rules'
import { characterById, type Content } from '@engine/pack'
import { dice, type Dice } from '@engine/core'
import type { BeatPlan } from './plan'

/**
 * A recurring NPC without a stat block rolls as an average adult of their level until tier templates exist
 * (core-rules §8): every attribute 10, no trained skills.
 */
export function statsOf(character: Character): StatBlock {
  return character.stats ?? { level: 1, attributes: Object.fromEntries(ATTRIBUTES.map((a) => [a, 10])) as StatBlock['attributes'], skills: {} }
}

/** How much the helper trusts the one they're helping: the player through their meters, anyone else through relations. */
function trustToward(state: GameState, helper: string, who: string): number {
  if (who === 'player') return state.meters[helper]?.trust ?? 0
  return state.relations.find((r) => r.from === helper && r.to === who)?.meters.trust ?? 0
}

export interface ResolveOptions {
  /**
   * Every d20 shows this number, and the dice don't move on. For the test bench only, so a scenario can be run with a
   * check that must succeed or must fail.
   */
  forceNatural?: number
}

/**
 * Rolls every check in the plan with the game's dice and writes the results in, so the writer is told what happened
 * rather than deciding it. Returns the plan and the dice's new state.
 */
export function resolvePlan(content: Content, state: GameState, plan: BeatPlan, options: ResolveOptions = {}): { plan: BeatPlan; dice: number } {
  const forced = options.forceNatural
  const rng: Dice = forced !== undefined ? { roll: () => forced, state: state.dice } : dice(state.dice)
  const checks = plan.checks.map((check) => {
    const roller = check.who === 'player' ? undefined : characterById(content, check.who)
    const stats = check.who === 'player' ? state.player.stats : statsOf(roller!)
    const edges: Edge[] = check.edge ? [check.edge] : []
    let bonus = 0
    if (check.assist) {
      const helper = characterById(content, check.assist)!
      const help = assistFrom({ stats: statsOf(helper), trust: trustToward(state, helper.id, check.who) }, check.skill)
      bonus += help.bonus
      edges.push(help.edge)
    }
    const result = rollCheck(stats, { skill: check.skill, difficulty: check.difficulty, edges, bonus }, rng)
    const name = check.who === 'player' ? state.player.name : roller!.name.split(' ')[0]!
    return { ...check, result, line: describeCheck(name, result) }
  })
  return { plan: { ...plan, checks }, dice: rng.state }
}
