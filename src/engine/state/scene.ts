import { z } from 'zod'
import { IdSchema } from '@engine/core'
import { MetersSchema } from '@engine/characters'

/** One click of the VN text box: a line of narration, or one character's line (director writer §2). */
export const BeatSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('narration'), text: z.string() }),
  z.object({ kind: z.literal('dialogue'), speaker: z.string(), text: z.string() })
])
export type Beat = z.infer<typeof BeatSchema>

/** A check as rolled by the game, kept with the turn so the player can see it and the summary can use it. */
export const RolledCheckSchema = z.object({
  id: z.string(),
  who: z.string(),
  skill: z.string(),
  difficulty: z.string(),
  stakes: z.string(),
  natural: z.number().int(),
  total: z.number().int(),
  dc: z.number().int(),
  degree: z.enum(['strong', 'success', 'cost', 'failure']),
  line: z.string()
})
export type RolledCheck = z.infer<typeof RolledCheckSchema>

export const TurnSchema = z.object({
  /** Unique within its scene's game, so a turn read back after loading a save can still be flagged in the logs. */
  id: z.string().min(1),
  /** The log session that recorded this turn, when it was logged: flags on it name that session. */
  log: z.string().optional(),
  player: z.string(),
  beats: z.array(BeatSchema),
  checks: z.array(RolledCheckSchema).default([]),
  /** Who had a speaking slot, for rotating focus. */
  speakers: z.array(z.string()).default([]),
  /** Location details the director used, so the next turns pick fresh ones. */
  texture: z.array(z.string()).default([]),
  /**
   * The secrets validly kept this turn, by fact id (`<character>.<secret>`): first in line to be shown in full next
   * turn. Absent when nobody kept one.
   */
  kept: z.array(z.string()).optional()
})
export type Turn = z.infer<typeof TurnSchema>

/** A scene in progress. Prompts are rebuilt from this every turn, never from a growing chat log. */
export const SceneSchema = z.object({
  /** Names the scene in logs; turn ids start from it. */
  id: z.string().min(1),
  locationId: IdSchema,
  /** Persistent characters present. */
  cast: z.array(IdSchema),
  /** Walk-ons present, by scene card id. */
  walkOns: z.array(IdSchema).default([]),
  turns: z.array(TurnSchema).default([]),
  /** Running summary of what came before the last few turns. */
  summary: z.string().default(''),
  /** Each character's mood as it stands now. */
  moods: z.record(z.string(), z.string()).default({}),
  /** Each character's comfort, 1 (wants out) to 5 (at ease). */
  comfort: z.record(z.string(), z.number().int().min(1).max(5)).default({}),
  /** Each character's sprite expression as it stands now. */
  expressions: z.record(z.string(), z.string()).default({}),
  /** Characters who were here and left; they still witness the scene for summaries. */
  departed: z.array(IdSchema).default([]),
  /** The writer asked to close the scene. */
  ended: z.boolean().default(false),
  nsfw: z.boolean().default(false),
  /** Meters at the start of the scene, to show what changed at its end. */
  baseline: z.record(z.string(), MetersSchema).default({}),
  /** Facts said on screen this scene, by id (characters' knowledge and secrets, the place's news), so a fact is introduced the first time and anyone present can repeat it after. */
  told: z.array(z.string()).default([]),
  /** Facts the plan brought in that no sheet holds (a price, a count), once said: anyone present can use them. */
  newFacts: z.array(z.object({ id: z.string(), text: z.string(), by: z.string() })).default([]),
  /** How hard each character's aim presses now, as an index into the ruleset's pressure words; moves a step a turn. */
  pressures: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** Secrets (fact ids) whose tell the writer has already been given this scene: a tell shows once unless someone looks closely. */
  tells: z.array(z.string()).default([])
})
export type Scene = z.infer<typeof SceneSchema>
