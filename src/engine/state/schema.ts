import { z } from 'zod'
import { IdSchema } from '@engine/core'
import { MetersSchema, TieTagSchema } from '@engine/characters'
import { PlayerSchema } from '@engine/characters'
import { SceneSchema } from './scene'

/** How long a memory is kept in mind (Breedhaven's Core / Normal / Fleeting). */
export const MemoryLevelSchema = z.enum(['core', 'normal', 'fleeting'])

/**
 * A memory in the Memory Bank (memory §2–7, milestone 4b): the save's per-character memories, kept apart from the codex.
 * Storage is free: fading takes a memory out of recall (`inRecall`), never out of the save.
 */
export const MemorySchema = z.object({
  /** Unique in the save: `<owner>.m<n>`. */
  id: z.string(),
  /** Whose memory it is. */
  owner: IdSchema,
  text: z.string(),
  level: MemoryLevelSchema,
  /** Why it is Core: the summary's reason, or the event that forced it. */
  reason: z.string().optional(),
  /** The scene it was made in, and where. */
  scene: z.string().optional(),
  place: z.string().optional(),
  /** Game time it was formed, in minutes since the start. */
  at: z.number().int(),
  /** When a scene last came back to it, and how often scenes have. */
  revisited: z.number().int().optional(),
  revisits: z.number().int().min(0).default(0),
  /** When its fading clock last started: made, revisited, or stepped down a level. */
  fadeFrom: z.number().int(),
  /** Who was there, by id ("player" for the player): the people in the scene. Recall ranks by it. */
  about: z.array(z.string()).default([]),
  /**
   * Who it is actually about (milestone 4b, 5c follow-up): the people the summary names, and anyone the scene changed
   * something with. Being there isn't enough, so the player, who is in every scene, is here only when the memory is
   * about them. Consolidation groups by it.
   */
  focus: z.array(z.string()).default([]),
  /** Whether it is still brought to scenes; a faded memory stays in the save and can come back when revisited. */
  inRecall: z.boolean().default(true),
  /**
   * For a memory of learning someone else's secret (milestone 4b): the secret, by fact id (`<holder>.<secret>`), and,
   * when it is linked to the codex, the codex entry. The pointer grants the knowledge while the memory is in the save,
   * in recall or not.
   */
  secret: z.string().optional(),
  codex: z.string().optional(),
  /** What it is about besides people and place (memory §7): ids of codex entries and secrets that came up in its scene, chosen by the summary. */
  topics: z.array(z.string()).default([]),
  /** A consolidated memory (memory §7): the memories it merged, and the learned secrets they carried, which it keeps. */
  from: z.array(z.string()).optional(),
  inherited: z.array(z.object({ secret: z.string(), codex: z.string().optional() })).optional(),
  /** An original that was merged: the consolidated memory that stands for it in recall. */
  mergedInto: z.string().optional()
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
  /**
   * When each held secret was last active, by fact id, and how (milestone 4b: dormancy): kept, shown in full, or its
   * keywords or subject brought up. The director's sheet shows the most recently active.
   */
  secretActivity: z.record(z.string(), z.object({ at: z.number().int(), how: z.enum(['kept', 'full', 'keyword', 'context']) })).default({}),
  /** When each character last shared a scene with the player, in game time (milestone 4b: noticing absence). */
  lastSeen: z.record(IdSchema, z.number().int()).default({}),
  /** Facts the player has learned, per character. */
  facts: z.record(IdSchema, z.array(z.string())).default({}),
  scene: SceneSchema.nullable().default(null)
})
export type GameState = z.infer<typeof GameStateSchema>
