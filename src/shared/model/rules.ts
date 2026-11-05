import { z } from 'zod'

/** The six attributes (core rules §2). */
export const ATTRIBUTES = ['might', 'agility', 'vigor', 'intellect', 'insight', 'presence'] as const
export type Attribute = (typeof ATTRIBUTES)[number]
export const AttributeSchema = z.enum(ATTRIBUTES)

/**
 * The 19 skills and the attribute each one usually rolls with (core rules §3). Skills are defined by goal, not
 * method: magic, tech and innate means are flavor. Melee's attack attribute varies; for story checks it is Might.
 */
export const SKILL_ATTRIBUTE = {
  athletics: 'might',
  melee: 'might',
  acrobatics: 'agility',
  stealth: 'agility',
  finesse: 'agility',
  marksmanship: 'agility',
  endurance: 'vigor',
  arcanotech: 'intellect',
  engineering: 'intellect',
  infiltration: 'intellect',
  investigation: 'intellect',
  medicine: 'intellect',
  perception: 'insight',
  empathy: 'insight',
  streetwise: 'insight',
  persuasion: 'presence',
  deception: 'presence',
  intimidation: 'presence',
  performance: 'presence'
} as const satisfies Record<string, Attribute>
export type Skill = keyof typeof SKILL_ATTRIBUTE
export const SKILLS = Object.keys(SKILL_ATTRIBUTE) as Skill[]
export const SkillSchema = z.enum(SKILLS as [Skill, ...Skill[]])

export const MAX_SKILL_RANK = 5
export const MIN_ATTRIBUTE = 8
export const MAX_ATTRIBUTE = 20

/** The words the director may use for a check's difficulty, and the DC each one means (core rules §1). */
export const DIFFICULTY_DC = {
  trivial: 5,
  easy: 10,
  moderate: 15,
  hard: 20,
  'very hard': 25,
  legendary: 30
} as const
export type Difficulty = keyof typeof DIFFICULTY_DC
export const DIFFICULTIES = Object.keys(DIFFICULTY_DC) as Difficulty[]
export const DifficultySchema = z.enum(DIFFICULTIES as [Difficulty, ...Difficulty[]])

export const AttributesSchema = z.object(
  Object.fromEntries(ATTRIBUTES.map((a) => [a, z.number().int().min(1).max(MAX_ATTRIBUTE)])) as Record<Attribute, z.ZodNumber>
)
export type Attributes = z.infer<typeof AttributesSchema>

/** Skill ranks; a skill left out is rank 0. */
export const SkillRanksSchema = z.partialRecord(SkillSchema, z.number().int().min(0).max(MAX_SKILL_RANK)).default({})
export type SkillRanks = z.infer<typeof SkillRanksSchema>

/** Everything a check needs to know about the one rolling: player and companions use the same block. */
export const StatBlockSchema = z.object({
  level: z.number().int().min(1).max(10).default(1),
  attributes: AttributesSchema,
  skills: SkillRanksSchema
})
export type StatBlock = z.infer<typeof StatBlockSchema>
