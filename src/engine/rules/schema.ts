import { z } from 'zod'

/**
 * Everything a check needs to know about the one rolling: player and companions use the same block. Attribute and skill
 * ids are the ruleset's; `validatePack` checks them against it, since the schema can't know them before a pack loads.
 */
export const StatBlockSchema = z.object({
  level: z.number().int().min(1).default(1),
  /** Every attribute the ruleset defines, by id. */
  attributes: z.record(z.string(), z.number().int()),
  /** Skill ranks by skill id; a skill left out is rank 0. */
  skills: z.record(z.string(), z.number().int().min(0)).default({})
})
export type StatBlock = z.infer<typeof StatBlockSchema>

/** A skill id from the loaded ruleset. */
export type Skill = string
/** An attribute id from the loaded ruleset. */
export type Attribute = string
/** A difficulty word from the loaded ruleset. */
export type Difficulty = string
