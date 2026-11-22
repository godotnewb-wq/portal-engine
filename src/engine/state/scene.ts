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

/** Where a record came from in a turn: the player's words, or a beat by its 1-based number. */
const AtSchema = z.union([z.literal('player'), z.number().int().positive()])

/**
 * A secret the bookkeeper saw come out (milestone 4c, decided 2026-11-18, user, J–L): `confirmed` by someone who could
 * say it (its holder not keeping it, someone who knew it, or the player who knew it), or `discovered` when the prose
 * showed the fact itself. `by` is a character id, `player`, or `narration`; `to` is everyone present but its holder.
 */
const SecretOutSchema = z.object({ secret: z.string(), by: z.string(), at: AtSchema, words: z.string(), how: z.enum(['confirmed', 'discovered']), to: z.array(z.string()) })
/** A secret that came up without coming out: a guess, a leak (said as known by someone who couldn't know it), or a case left for review. */
const SecretNoteSchema = z.object({ secret: z.string(), by: z.string(), at: AtSchema, words: z.string(), why: z.string().optional() })

/**
 * What a turn did on screen, as the bookkeeper recorded it after the turn was shown (milestone 4c), or as the plan
 * gives it when that call failed (`source: 'plan'`). Only `out` teaches anyone a secret; a leak is the speaker's claim
 * and teaches no one (decided 2026-11-18, user).
 */
export const BookkeepingSchema = z.object({
  source: z.enum(['bookkeeper', 'plan']),
  out: z.array(SecretOutSchema).default([]),
  leaks: z.array(SecretNoteSchema).default([]),
  guesses: z.array(SecretNoteSchema).default([]),
  /** Talk that touched a secret without saying it was true: asking, dodging, denying, hinting. Teaches no one. */
  around: z.array(SecretNoteSchema).default([]),
  /** Part of a secret said as true, not all of it (Milestone 5 plan, Q11): kept and shown, teaching no one. */
  partial: z.array(SecretNoteSchema).default([]),
  /** Secrets the game couldn't settle: the bookkeeper couldn't tell, or a holder said one they were keeping. */
  unresolved: z.array(SecretNoteSchema).default([]),
  /**
   * Facts from the writer's pool that the prose stated (Milestone 5 plan, Q12: the `scene` pipeline has no moves to read
   * them from): they join the scene's `told`, so the player has heard them and they leave the pool. `text` keeps a lore
   * or memory fact's words, which no sheet in the scene holds.
   */
  said: z.array(z.object({ fact: z.string(), text: z.string(), by: z.string(), words: z.string().default(''), unowned: z.boolean().optional() })).default([]),
  /** Concrete details the prose stated as settled that no fact holds; anyone present may repeat them. */
  new: z.array(z.object({ text: z.string(), by: z.string() })).default([]),
  /**
   * What is actually different after the turn; compared with the director's `change` in the logs. The `scene` pipeline's
   * next director reads it, for that turn only (Milestone 5 plan, Q4); `situation`'s doesn't.
   */
  changed: z.string().optional(),
  /** Where each feeling the prose showed seemed to land; logged against the director's `feels`, never applied. */
  moods: z.array(z.object({ id: z.string(), feeling: FeelingSchema })).default([]),
  /**
   * What the prose showed of each check, and whether that kept the roll's result; logged only. Since Milestone 5 task 4
   * the bookkeeper says what a line shows and the game compares it with the roll; `honored` is absent when it was unclear.
   */
  checks: z.array(z.object({ id: z.string(), honored: z.boolean().optional(), shown: z.string().optional(), at: z.number().int().optional(), words: z.string().optional(), note: z.string().optional() })).default([]),
  /** What the bookkeeper said that the game turned down, with why. */
  refused: z.array(z.string()).default([]),
  /** A plan-based record: the bookkeeper failed, timed out or couldn't be read, so its secrets weren't audited. */
  unaudited: z.boolean().optional()
})
export type Bookkeeping = z.infer<typeof BookkeepingSchema>

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
   * The pressures the `scene` pipeline played live this turn (Milestone 5 plan, task 1): who, what kind, and what it
   * was (a goal by its holder's id, a secret by its fact id, a tie by the other person). The next turns' gathering reads
   * them as recently live. Absent when none, and in turns made by `situation`, which keeps secrets in `kept`.
   */
  live: z.array(z.object({ who: z.string(), kind: z.enum(['goal', 'secret', 'tie']), ref: z.string() })).optional(),
  /**
   * Reading checks that succeeded this turn (npc design §7, milestone 4b): who saw through to what someone felt, for
   * the reader's end-of-scene memory. `hiding`: the one read was keeping a secret, so the reader saw that something
   * was hidden, never what (milestone 4c: a read no longer gives the secret away). Absent when none.
   */
  reads: z.array(z.object({ by: z.string(), target: z.string(), feeling: FeelingSchema, hiding: z.boolean().optional() })).optional(),
  /**
   * Secrets that came out on screen this turn and who they came out in front of: everyone present but the holder
   * (milestone 4b). Since milestone 4c they come from the turn's records (`records.out`), the bookkeeper's or, when it
   * failed, the plan's. Only these can become someone's learned secret at the scene's end.
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
  details: z.array(z.string()).optional(),
  /**
   * What the turn did on screen (milestone 4c): the bookkeeper's records, or the plan's until it answers and when it
   * fails. `exposed`, `toldSecrets`, the secrets among `topics` and the turn's said facts all follow them.
   */
  records: BookkeepingSchema.optional(),
  /** Secrets this turn's records added to the scene's `told`, so newer records can replace them (milestone 4c). */
  toldSecrets: z.array(z.string()).optional(),
  /** Facts this turn's records added to the scene's `told` (the `scene` pipeline's said facts), likewise. */
  toldFacts: z.array(z.string()).optional()
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
  reason: z.string().default(''),
  /** The words from the scene that show it, as the witness who reported it quoted them (milestone 4c). */
  line: z.string().optional()
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
  /** The words from the scene that show it (milestone 4c). */
  line: z.string().optional(),
  /** The turn it happened on. */
  turn: z.string().optional()
})
export type TieEvent = z.infer<typeof TieEventSchema>

/** A feeling as an end-of-scene call wrote it, before it is checked against the ruleset. */
const WrittenFeelingSchema = z.object({ who: z.string().optional(), shade: z.unknown().optional(), family: z.unknown().optional(), intensity: z.unknown().optional(), reason: z.unknown().optional() })

/**
 * What a witness's relationship call said (milestone 4c): how their meters moved, in numbers the ruleset gave the
 * words, and the feelings they leave with. Kept on the scene between that call and the memory call, across the
 * player's answers. `error`: the call failed, and nothing changes for them.
 */
export const JudgmentSchema = z.object({
  reason: z.string().default(''),
  delta: z.record(z.string(), z.number()).default({}),
  others: z.array(z.object({ with: z.string(), delta: z.record(z.string(), z.number()), reason: z.string().default('') })).default([]),
  feels: WrittenFeelingSchema.optional(),
  toward: z.array(WrittenFeelingSchema).default([]),
  resolved: z.array(z.string()).default([]),
  error: z.string().optional()
})
export type Judgment = z.infer<typeof JudgmentSchema>

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
  /**
   * Details said on screen that no sheet holds (a price, a count): anyone present can use them. Since milestone 4c
   * they come from each turn's records (`turn`: the one that said it, so newer records can replace them).
   */
  newFacts: z.array(z.object({ id: z.string(), text: z.string(), by: z.string(), turn: z.string().optional() })).default([]),
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
  tieEvents: z.array(TieEventSchema).default([]),
  /**
   * Each witness's relationship call, once the scene's end has asked them (milestone 4c). Absent until then; the
   * memory calls read it, and the meters move when the scene closes.
   */
  judged: z.record(z.string(), JudgmentSchema).optional()
})
export type Scene = z.infer<typeof SceneSchema>
