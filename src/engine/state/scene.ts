import { z } from 'zod'
import { IdSchema } from '@engine/core'
import { FeelingSchema, MetersSchema } from '@engine/characters'

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
  kept: z.array(z.string()).optional(),
  /**
   * Reading checks that succeeded this turn (npc design §7, milestone 4b): who saw through to what someone felt, for
   * the reader's end-of-scene memory. Absent when none.
   */
  reads: z.array(z.object({ by: z.string(), target: z.string(), feeling: FeelingSchema })).optional(),
  /**
   * Secrets that came out on screen this turn and who they came out in front of (milestone 4b): a move that used one,
   * said in front of everyone present, or a reading check that saw through someone keeping one, for the reader. Only
   * these can become someone's learned secret at the scene's end.
   */
  exposed: z.array(z.object({ secret: z.string(), to: z.array(z.string()) })).optional(),
  /** Codex entries the conversation brought up this turn and secrets that came out (milestone 4b): what memories can be tagged with. */
  topics: z.array(z.string()).optional(),
  /** Memories brought into the director's briefs this turn as optional detail (milestone 4b), so the summary can name them as revisited. */
  memories: z.array(z.string()).optional(),
  /**
   * Optional brief detail this turn used or left open (director writer §7): carried into the next turn's brief on a
   * follow-up, dropped on a change of topic. Absent when none.
   */
  details: z.array(z.string()).optional()
})
export type Turn = z.infer<typeof TurnSchema>

/**
 * A relationship tag change (relationships §3, milestone 4b: `set_tie`): `from` starts holding `add` toward `to` (a
 * character's id or "player") and/or stops holding `end`, because of something on screen. `word` is how `from` words
 * the new tag, `backWord` how `to` words its counterpart; `reason` becomes the relationship note.
 */
export const TieChangeSchema = z.object({
  from: IdSchema,
  to: z.string(),
  add: z.string().optional(),
  word: z.string().optional(),
  backWord: z.string().optional(),
  end: z.string().optional(),
  reason: z.string().default('')
})
export type TieChange = z.infer<typeof TieChangeSchema>

/** A tie change that happened: the tags each side began and stopped holding (a counterpart, or one dropped at the limit, included). Forces a Core memory for both. */
export const TieEventSchema = z.object({
  from: IdSchema,
  to: z.string(),
  added: z.array(z.string()).default([]),
  ended: z.array(z.string()).default([]),
  /** The word for the tag added, as `from` words it. */
  word: z.string().optional(),
  reason: z.string().default(''),
  /** The turn it happened on. */
  turn: z.string().optional()
})
export type TieEvent = z.infer<typeof TieEventSchema>

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
  /** What each character feels as it stands now (milestone 4b): the card's default mood, then the director's `feels`. */
  moods: z.record(z.string(), FeelingSchema).default({}),
  /** Each character's comfort, 1 (wants out) to 5 (at ease). */
  comfort: z.record(z.string(), z.number().int().min(1).max(5)).default({}),
  /** Each character's sprite expression as it stands now. */
  expressions: z.record(z.string(), z.string()).default({}),
  /** Characters who were here and left; they still witness the scene for summaries. */
  departed: z.array(IdSchema).default([]),
  /** The writer asked to close the scene. */
  ended: z.boolean().default(false),
  /** Meters at the start of the scene, to show what changed at its end. */
  baseline: z.record(z.string(), MetersSchema).default({}),
  /** Facts said on screen this scene, by id (characters' knowledge and secrets, the place's news), so a fact is introduced the first time and anyone present can repeat it after. */
  told: z.array(z.string()).default([]),
  /** Facts the plan brought in that no sheet holds (a price, a count), once said: anyone present can use them. */
  newFacts: z.array(z.object({ id: z.string(), text: z.string(), by: z.string() })).default([]),
  /** How hard each character's aim presses now, as an index into the ruleset's pressure words; moves a step a turn. */
  pressures: z.record(z.string(), z.number().int().nonnegative()).default({}),
  /** Secrets (fact ids) whose tell the writer has already been given this scene: a tell shows once unless someone looks closely. */
  tells: z.array(z.string()).default([]),
  /** Tie changes with the player that wait for the player's answer (an arrangement needs their agreement; relationships §3). */
  pendingTies: z.array(TieChangeSchema).default([]),
  /** The player's answers since the last turn, for the director's next prompt; cleared once a turn has used them. */
  answered: z.array(TieChangeSchema.extend({ accepted: z.boolean() })).default([]),
  /** The strongest intensity each character felt in the scene (the director's `feels`), for the memory over-grading guard. */
  peaks: z.record(z.string(), z.number().int()).default({}),
  /** Tie changes that happened in the scene (relationships §3): each forces a Core memory for both sides at its end. */
  tieEvents: z.array(TieEventSchema).default([])
})
export type Scene = z.infer<typeof SceneSchema>
