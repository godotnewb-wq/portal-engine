import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { IdSchema, MetersSchema } from '@engine/characters'
import type { GameState } from '@engine/state'
import type { Content } from '@engine/pack'
import { createInitialState, startScene } from '@engine/state'

/**
 * A fixed scene for the test bench (narrator-scene-engine §10): who is where, how they feel going in, and the lines
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
  turns: z.array(z.string().min(1)).min(1),
  /** Run the end-of-scene summaries too. */
  summaries: z.boolean().default(true)
})
export type Scenario = z.infer<typeof ScenarioSchema>

export function loadScenarios(dir: string): Scenario[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const parsed = ScenarioSchema.safeParse(JSON.parse(readFileSync(join(dir, name), 'utf8')))
      if (!parsed.success) throw new Error(`${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
      return parsed.data
    })
}

/** Problems a scenario has against the content: unknown places or people. */
export function scenarioProblems(content: Content, scenario: Scenario): string[] {
  const problems: string[] = []
  if (!content.locations.some((l) => l.id === scenario.location)) problems.push(`unknown location "${scenario.location}"`)
  for (const id of [...scenario.cast, ...Object.keys(scenario.meters), ...Object.keys(scenario.moods)]) {
    if (!content.characters.some((c) => c.id === id)) problems.push(`unknown character "${id}"`)
  }
  return [...new Set(problems)]
}

/** The game state a scenario opens on. */
export function scenarioState(content: Content, scenario: Scenario): GameState {
  const fresh = createInitialState(content, scenario.seed)
  const withMeters = { ...fresh, meters: { ...fresh.meters, ...scenario.meters } }
  const state = startScene(content, withMeters, scenario.location, scenario.cast)
  return { ...state, scene: { ...state.scene!, moods: { ...state.scene!.moods, ...scenario.moods } } }
}
