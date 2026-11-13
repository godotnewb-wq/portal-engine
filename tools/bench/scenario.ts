import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { IdSchema } from '@engine/core'
import { MetersSchema } from '@engine/characters'
import type { GameState } from '@engine/state'
import type { Pack } from '@engine/pack'
import { createInitialState, startScene, TurnSchema } from '@engine/state'
import { MINUTES_PER_TURN, RECENT_TURNS, SUMMARY_CHARS, turnText } from '@engine/scene'

export const ExpectedCheckSchema = z.object({ turn: z.number().int().positive(), who: IdSchema, skill: IdSchema })
export type ExpectedCheck = z.infer<typeof ExpectedCheckSchema>

/**
 * A fixed scene for the test bench (director writer §10): who is where, how they feel going in, and the lines
 * the player says. Run against a prompt or model change, the same scenarios show whether characters got better.
 */
export const ScenarioSchema = z.object({
  id: IdSchema,
  title: z.string(),
  /** What the scenario tests, and what a good run looks like. Read by people, not by the game. */
  watchFor: z.string(),
  location: IdSchema,
  cast: z.array(IdSchema).min(1),
  seed: z.number().int().default(1),
  /** Every check rolls this natural number, so "caught" and "uncaught" runs are repeatable. */
  forceNatural: z.number().int().min(1).max(20).optional(),
  /** Starting feelings toward the player, overriding the character files. */
  meters: z.record(IdSchema, MetersSchema).default({}),
  /** Starting moods, overriding the character files. */
  moods: z.record(IdSchema, z.string()).default({}),
  /** Starting comfort (1–5), overriding the default. */
  comfort: z.record(IdSchema, z.number().int().min(1).max(5)).default({}),
  /**
   * Turns already played in the scene, verbatim: a scenario made from a logged turn (`npm run logs -- to-scenario`)
   * opens on the scene as it stood, so the replayed turn sees the same history.
   */
  history: z.array(TurnSchema).default([]),
  turns: z.array(z.string().min(1)).min(1),
  /** A roll the scenario is designed to exercise. Turns are 1-based. */
  expectedCheck: ExpectedCheckSchema.optional(),
  /** Run the end-of-scene summaries too. */
  summaries: z.boolean().default(true)
})
export type Scenario = z.infer<typeof ScenarioSchema>

export function loadScenarios(dir: string): Scenario[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => scenarioFile(join(dir, name)))
}

/** One scenario file, checked. */
export function scenarioFile(path: string): Scenario {
  const parsed = ScenarioSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) throw new Error(`${basename(path)}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return parsed.data
}

/** Problems a scenario has against the content: unknown places or people. */
export function scenarioProblems(content: Pack, scenario: Scenario): string[] {
  const problems: string[] = []
  if (!content.locations.some((l) => l.id === scenario.location)) problems.push(`unknown location "${scenario.location}"`)
  for (const id of [...scenario.cast, ...Object.keys(scenario.meters), ...Object.keys(scenario.moods)]) {
    if (!content.characters.some((c) => c.id === id)) problems.push(`unknown character "${id}"`)
  }
  const expected = scenario.expectedCheck
  if (expected) {
    if (expected.turn > scenario.turns.length) problems.push(`expected check is outside the scripted turns (${expected.turn})`)
    if (expected.who !== 'player' && !scenario.cast.includes(expected.who)) problems.push(`expected check roller "${expected.who}" is not in the cast`)
    if (!content.ruleset.skills.some((skill) => skill.id === expected.skill)) problems.push(`unknown expected check skill "${expected.skill}"`)
  }
  return [...new Set(problems)]
}

/** The game state a scenario opens on. */
export function scenarioState(content: Pack, scenario: Scenario): GameState {
  const fresh = createInitialState(content, scenario.seed)
  const withMeters = { ...fresh, meters: { ...fresh.meters, ...scenario.meters } }
  const state = startScene(content, withMeters, scenario.location, scenario.cast)
  const turns = scenario.history
  // The running summary holds what fell out of the prompts' window, as applyTurn builds it.
  const summary = turns
    .slice(0, Math.max(0, turns.length - RECENT_TURNS))
    .map((t) => turnText(content, state.player.name, t))
    .join('\n\n')
    .slice(-SUMMARY_CHARS)
  return {
    ...state,
    time: state.time + turns.length * MINUTES_PER_TURN,
    scene: { ...state.scene!, turns, summary, moods: { ...state.scene!.moods, ...scenario.moods }, comfort: { ...state.scene!.comfort, ...scenario.comfort } }
  }
}
