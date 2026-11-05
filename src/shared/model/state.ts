import { z } from 'zod'
import { IdSchema, MetersSchema } from './character'
import { PlayerSchema } from './player'
import { SceneSchema } from './scene'

/** How long a memory is kept in mind (Breedhaven's Core / Normal / Fleeting). */
export const MemoryLevelSchema = z.enum(['core', 'normal', 'fleeting'])

export const MemorySchema = z.object({
  /** Whose memory it is. */
  owner: IdSchema,
  text: z.string(),
  level: MemoryLevelSchema,
  /** Game time it was formed, in minutes since the start. */
  at: z.number().int(),
  /** Others it involves. */
  about: z.array(z.string()).default([])
})
export type Memory = z.infer<typeof MemorySchema>

/** One direction of a relationship between two characters (A's feelings for B need not match B's for A). */
export const RelationSchema = z.object({ from: IdSchema, to: IdSchema, label: z.string(), meters: MetersSchema })
export type Relation = z.infer<typeof RelationSchema>

export const GameStateSchema = z.object({
  player: PlayerSchema,
  /** Minutes since the start of the game. */
  time: z.number().int().min(0),
  /** The dice's state, so rolls carry on exactly after a reload. */
  dice: z.number().int(),
  /** Each character's meters toward the player. */
  meters: z.record(IdSchema, MetersSchema),
  relations: z.array(RelationSchema).default([]),
  memories: z.array(MemorySchema).default([]),
  /** Facts the player has learned, per character. */
  facts: z.record(IdSchema, z.array(z.string())).default({}),
  scene: SceneSchema.nullable().default(null)
})
export type GameState = z.infer<typeof GameStateSchema>

export const SAVE_VERSION = 1
export const SaveFileSchema = z.object({
  version: z.literal(SAVE_VERSION),
  savedAt: z.string(),
  name: z.string().optional(),
  state: GameStateSchema
})
export type SaveFile = z.infer<typeof SaveFileSchema>
