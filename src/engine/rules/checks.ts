import type { Dice } from '@engine/core'
import type { Ruleset } from './ruleset'
import { difficultyDc, skillById } from './ruleset'
import type { StatBlock } from './schema'

/** An attribute's modifier, as the ruleset defines it (e.g. (score − 10) / 2, rounded down). */
export const modifier = (r: Ruleset, score: number): number => Math.floor((score - r.attributes.modifier.base) / r.attributes.modifier.divisor)

export const rankOf = (stats: StatBlock, skill: string): number => stats.skills[skill] ?? 0

/** The highest skill rank allowed at a character level. */
export function rankCap(r: Ruleset, level: number): number {
  const step = r.ranks.capByLevel.find((s) => level <= s.upTo) ?? r.ranks.capByLevel.at(-1)!
  return Math.min(step.cap, r.ranks.max)
}

export type Degree = 'strong' | 'success' | 'cost' | 'failure'
const LADDER: Degree[] = ['failure', 'cost', 'success', 'strong']

/** Beat it by the strong margin: strong; meet it: success; miss by up to the cost margin: success at a cost; else failure. */
export function degreeOf(r: Ruleset, total: number, target: number): Degree {
  const margin = total - target
  if (margin >= r.degrees.strongMargin) return 'strong'
  if (margin >= 0) return 'success'
  if (margin >= -r.degrees.costMargin) return 'cost'
  return 'failure'
}

const step = (degree: Degree, by: number): Degree => LADDER[Math.min(LADDER.length - 1, Math.max(0, LADDER.indexOf(degree) + by))]!

export const isSuccess = (degree: Degree): boolean => degree === 'strong' || degree === 'success' || degree === 'cost'

export type Edge = 'advantage' | 'disadvantage' | 'none'

/**
 * What a helper adds to a check: nothing without the skill or enough of the assist meter, a bonus from the first
 * threshold, advantage from the second.
 */
export function assistFrom(r: Ruleset, helper: { stats: StatBlock; meter: number }, skill: string): { bonus: number; edge: Edge } {
  const a = r.assists
  if (rankOf(helper.stats, skill) < a.minRank || helper.meter < a.bonusFrom) return { bonus: 0, edge: 'none' }
  if (helper.meter < a.advantageFrom) return { bonus: a.bonus, edge: 'none' }
  return { bonus: 0, edge: 'advantage' }
}

/** Advantages never stack, and an advantage and a disadvantage cancel out. */
export function combineEdges(edges: Edge[]): Edge {
  const up = edges.includes('advantage')
  const down = edges.includes('disadvantage')
  if (up === down) return 'none'
  return up ? 'advantage' : 'disadvantage'
}

export interface CheckRequest {
  skill: string
  difficulty: string
  /** Defaults to the skill's usual attribute. */
  attribute?: string
  edges?: Edge[]
  bonus?: number
}

export interface CheckResult {
  skill: string
  attribute: string
  difficulty: string
  dc: number
  /** Every die rolled; with an edge there are two. */
  rolls: number[]
  /** The die that counted. */
  natural: number
  edge: Edge
  modifier: number
  rank: number
  bonus: number
  total: number
  degree: Degree
  critical: 'hit' | 'miss' | null
}

/** The size of the die the resolution strategy rolls. */
const DIE: Record<Ruleset['resolution'], number> = { 'd20-vs-dc': 20 }

/** Rolls a story check: die + attribute modifier + skill rank (+ bonuses) vs. the difficulty's target (`d20-vs-dc`). */
export function rollCheck(r: Ruleset, stats: StatBlock, request: CheckRequest, rng: Dice): CheckResult {
  const skill = skillById(r, request.skill)
  if (!skill) throw new Error(`Unknown skill "${request.skill}"`)
  const dc = difficultyDc(r, request.difficulty)
  if (dc === undefined) throw new Error(`Unknown difficulty "${request.difficulty}"`)
  const attribute = request.attribute ?? skill.attribute
  const edge = combineEdges(request.edges ?? [])
  const sides = DIE[r.resolution]
  const rolls = edge === 'none' ? [rng.roll(sides)] : [rng.roll(sides), rng.roll(sides)]
  const natural = edge === 'advantage' ? Math.max(...rolls) : edge === 'disadvantage' ? Math.min(...rolls) : rolls[0]!
  const mod = modifier(r, stats.attributes[attribute] ?? r.attributes.average)
  const rank = rankOf(stats, request.skill)
  const bonus = request.bonus ?? 0
  const total = natural + mod + rank + bonus
  const critical = natural === r.criticals.hit ? 'hit' : natural === r.criticals.miss ? 'miss' : null
  const degree = step(degreeOf(r, total, dc), critical === 'hit' ? 1 : critical === 'miss' ? -1 : 0)
  return { skill: request.skill, attribute, difficulty: request.difficulty, dc, rolls, natural, edge, modifier: mod, rank, bonus, total, degree, critical }
}

const DEGREE_LABEL: Record<Degree, string> = { strong: 'strong success', success: 'success', cost: 'success at a cost', failure: 'failure' }

/** How a check reads on screen, e.g. "Ada — Search 17 vs 15: success", using the skill's name from the ruleset. */
export function describeCheck(r: Ruleset, who: string, result: CheckResult): string {
  const skill = skillById(r, result.skill)?.name ?? result.skill
  const crit = result.critical === 'hit' ? ` (natural ${result.natural})` : result.critical === 'miss' ? ` (natural ${result.natural})` : ''
  return `${who} — ${skill} ${result.total} vs ${result.dc}: ${DEGREE_LABEL[result.degree]}${crit}`
}

/** A stat block for someone the pack gives none yet: every attribute average, no trained skills. */
export function averageStats(r: Ruleset): StatBlock {
  return { level: r.levels.min, attributes: Object.fromEntries(r.attributes.list.map((a) => [a.id, r.attributes.average])), skills: {} }
}
