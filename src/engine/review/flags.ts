import { z } from 'zod'

/** How a beat or turn read to the person playing (milestone 2, A3). */
export const RATINGS = ['good', 'meh', 'bad'] as const
export type Rating = (typeof RATINGS)[number]

/**
 * Why, from a fixed list matching the rubric. The list is the engine's: packs don't add reasons, and it names no
 * world, so flags from any game can be counted the same way.
 */
export const FLAG_REASONS = [
  'voice',
  'acted for the player',
  'wrong speaker',
  'ignored the check',
  'generic',
  'stated emotion',
  'repetition',
  'too long',
  'off tone',
  'great line',
  'great detail'
] as const
export type FlagReason = (typeof FLAG_REASONS)[number]

export const FlagSchema = z.object({
  rating: z.enum(RATINGS),
  reasons: z.array(z.enum(FLAG_REASONS)).default([]),
  note: z.string().default('')
})
export type Flag = z.infer<typeof FlagSchema>

/**
 * One line of a session's `flags.jsonl`. A flag on a turn read back after loading a save goes into the current
 * session's file but names the session that recorded the turn (`turnSession`). `flag: null` clears an earlier flag.
 */
export const FlagRecordSchema = z.object({
  /** The session the flag was made in. */
  session: z.string(),
  /** The session that recorded the turn. */
  turnSession: z.string(),
  turnId: z.string(),
  /** 1-based beat in the turn; absent for a flag on the whole turn. */
  beat: z.number().int().min(1).optional(),
  speaker: z.string().optional(),
  /** A copy of the beat's text, so a flag reads on its own. */
  text: z.string().optional(),
  flag: FlagSchema.nullable(),
  at: z.string()
})
export type FlagRecord = z.infer<typeof FlagRecordSchema>

/** What a flag is on: a beat, or a whole turn. */
export const flagKey = (r: Pick<FlagRecord, 'turnSession' | 'turnId' | 'beat'>): string => `${r.turnSession}/${r.turnId}/${r.beat ?? 'turn'}`

/** The flags as they stand: a newer record on the same beat or turn replaces the older; a clear removes it. */
export function currentFlags(records: FlagRecord[]): Map<string, FlagRecord & { flag: Flag }> {
  const sorted = [...records].sort((a, b) => a.at.localeCompare(b.at))
  const current = new Map<string, FlagRecord & { flag: Flag }>()
  for (const r of sorted) {
    if (r.flag) current.set(flagKey(r), r as FlagRecord & { flag: Flag })
    else current.delete(flagKey(r))
  }
  return current
}
