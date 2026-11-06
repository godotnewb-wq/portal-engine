import { DIFFICULTY_DC, MAX_SKILL_RANK, SKILL_ATTRIBUTE, type Attribute, type Difficulty, type Skill, type StatBlock } from './schema'
import type { Dice } from '@engine/core'

/** Modifier for an attribute score: (score − 10) / 2, rounded down. */
export const modifier = (score: number): number => Math.floor((score - 10) / 2)

export const rankOf = (stats: StatBlock, skill: Skill): number => stats.skills[skill] ?? 0

/** The highest skill rank allowed at a character level (core rules §3, tune). */
export function rankCap(level: number): number {
  if (level <= 2) return 2
  if (level <= 4) return 3
  if (level <= 6) return 4
  return MAX_SKILL_RANK
}

export type Degree = 'strong' | 'success' | 'cost' | 'failure'
const LADDER: Degree[] = ['failure', 'cost', 'success', 'strong']

/** Beat by 5+ strong; meet it success; miss by 1–4 success at a cost; miss by 5+ failure (core rules §1). */
export function degreeOf(total: number, dc: number): Degree {
  const margin = total - dc
  if (margin >= 5) return 'strong'
  if (margin >= 0) return 'success'
  if (margin >= -4) return 'cost'
  return 'failure'
}

const step = (degree: Degree, by: number): Degree => LADDER[Math.min(LADDER.length - 1, Math.max(0, LADDER.indexOf(degree) + by))]!

export const isSuccess = (degree: Degree): boolean => degree === 'strong' || degree === 'success' || degree === 'cost'

/** How much a helper's trust gives a check (core rules §1, tune). */
export const ASSIST_TRUST = { bonus: 40, advantage: 70 } as const

export type Edge = 'advantage' | 'disadvantage' | 'none'

/** What a companion's help adds: nothing without the skill or enough trust, +2 at medium trust, advantage at high. */
export function assistFrom(helper: { stats: StatBlock; trust: number }, skill: Skill): { bonus: number; edge: Edge } {
  if (rankOf(helper.stats, skill) < 1 || helper.trust < ASSIST_TRUST.bonus) return { bonus: 0, edge: 'none' }
  if (helper.trust < ASSIST_TRUST.advantage) return { bonus: 2, edge: 'none' }
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
  skill: Skill
  difficulty: Difficulty
  /** Defaults to the skill's usual attribute. */
  attribute?: Attribute
  edges?: Edge[]
  bonus?: number
}

export interface CheckResult {
  skill: Skill
  attribute: Attribute
  difficulty: Difficulty
  dc: number
  /** Every d20 rolled; with an edge there are two. */
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

/** Rolls a story check: d20 + attribute modifier + skill rank (+ bonuses) vs. the difficulty's DC. */
export function rollCheck(stats: StatBlock, request: CheckRequest, rng: Dice): CheckResult {
  const attribute = request.attribute ?? SKILL_ATTRIBUTE[request.skill]
  const edge = combineEdges(request.edges ?? [])
  const rolls = edge === 'none' ? [rng.roll(20)] : [rng.roll(20), rng.roll(20)]
  const natural = edge === 'advantage' ? Math.max(...rolls) : edge === 'disadvantage' ? Math.min(...rolls) : rolls[0]!
  const mod = modifier(stats.attributes[attribute])
  const rank = rankOf(stats, request.skill)
  const bonus = request.bonus ?? 0
  const total = natural + mod + rank + bonus
  const dc = DIFFICULTY_DC[request.difficulty]
  const critical = natural === 20 ? 'hit' : natural === 1 ? 'miss' : null
  const degree = step(degreeOf(total, dc), critical === 'hit' ? 1 : critical === 'miss' ? -1 : 0)
  return { skill: request.skill, attribute, difficulty: request.difficulty, dc, rolls, natural, edge, modifier: mod, rank, bonus, total, degree, critical }
}

const DEGREE_LABEL: Record<Degree, string> = { strong: 'strong success', success: 'success', cost: 'success at a cost', failure: 'failure' }

/** How a check reads on screen, e.g. "Vex — Empathy 17 vs 15: success". */
export function describeCheck(who: string, result: CheckResult): string {
  const skill = result.skill[0]!.toUpperCase() + result.skill.slice(1)
  const crit = result.critical === 'hit' ? ' (natural 20)' : result.critical === 'miss' ? ' (natural 1)' : ''
  return `${who} — ${skill} ${result.total} vs ${result.dc}: ${DEGREE_LABEL[result.degree]}${crit}`
}
