import { z } from 'zod'
import { IdSchema } from '@engine/core'
import { MetersSchema } from '@engine/characters'
import { PlayerSchema } from '@engine/characters'
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
/** `note`: the authored line of history between them, if any (relationships §3). */
export const RelationSchema = z.object({ from: IdSchema, to: IdSchema, note: z.string().optional(), meters: MetersSchema })
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
  /** Major Characters in the player's party (companions), separate from their tier (npc design §2). */
  party: z.array(IdSchema),
  memories: z.array(MemorySchema).default([]),
  /** Facts the player has learned, per character. */
  facts: z.record(IdSchema, z.array(z.string())).default({}),
  scene: SceneSchema.nullable().default(null)
})
export type GameState = z.infer<typeof GameStateSchema>
