import { z } from 'zod'
import { StatBlockSchema } from '@engine/rules'

/** The player character. Milestone 1 uses a fixed test character; character creation comes later. */
export const PlayerSchema = z.object({
  name: z.string(),
  species: z.string(),
  pronouns: z.string(),
  /** Drawable traits and the one-line look the narration can draw on. */
  appearance: z.string(),
  background: z.string(),
  stats: StatBlockSchema
})
export type Player = z.infer<typeof PlayerSchema>
