import { z } from 'zod'
import { IdSchema } from '@engine/core'
import { MetersSchema, TieTagSchema } from '@engine/characters'
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

/**
 * A feeling a character carries out of a scene (npc design §7, milestone 4b): general aftermath ("grieving his
 * brother"), or, with `toward`, a feeling toward a person (a character's id, or "player") that sits on top of the
 * relationship without changing it. `intensity` is as it stood on `fadedOn`, the in-game day of its last fading step
 * (`days.ts`); it loses a point every `aftermath.fadeDays` and ends at 0. `since`: game time it began.
 */
export const AftermathSchema = z.object({
  owner: IdSchema,
  toward: z.string().optional(),
  shade: z.string(),
  family: z.string(),
  intensity: z.number().int().min(1).max(5),
  reason: z.string().default(''),
  since: z.number().int(),
  scene: z.string(),
  fadedOn: z.number().int()
})
export type Aftermath = z.infer<typeof AftermathSchema>

/** A feeling toward someone that ended (faded, resolved in a scene, or replaced), kept to count repeats (npc design §7). */
export const EndedFeelingSchema = z.object({ owner: IdSchema, toward: z.string(), family: z.string(), at: z.number().int(), how: z.enum(['faded', 'resolved', 'replaced']) })
export type EndedFeeling = z.infer<typeof EndedFeelingSchema>

/** One direction of a relationship between two characters (A's feelings for B need not match B's for A). */
/** `tags`: what they are to each other; `note`: the line of history between them, if any (relationships §3). */
export const RelationSchema = z.object({ from: IdSchema, to: IdSchema, tags: z.array(TieTagSchema).default([]), note: z.string().optional(), meters: MetersSchema })
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
  /** What the player is to each character who holds tags toward them, with the note (relationships §3). */
  playerTies: z.record(IdSchema, z.object({ tags: z.array(TieTagSchema), note: z.string().optional() })).default({}),
  /** Major Characters in the player's party (companions), separate from their tier (npc design §2). */
  party: z.array(IdSchema),
  memories: z.array(MemorySchema).default([]),
  /** Aftermath and feelings toward a person that are still active (milestone 4b). */
  aftermath: z.array(AftermathSchema).default([]),
  /** Feelings toward a person that ended, for the repeat rule; trimmed to the ruleset's `aftermath.historyDays`. */
  endedFeelings: z.array(EndedFeelingSchema).default([]),
  /** When each character last shared a scene with the player, in game time (milestone 4b: noticing absence). */
  lastSeen: z.record(IdSchema, z.number().int()).default({}),
  /** Facts the player has learned, per character. */
  facts: z.record(IdSchema, z.array(z.string())).default({}),
  scene: SceneSchema.nullable().default(null)
})
export type GameState = z.infer<typeof GameStateSchema>
