import { z } from 'zod'
import { IdSchema } from '@engine/core'
import { StatBlockSchema } from '@engine/rules'
import { FactionLevelSchema } from '@engine/world'

/**
 * Persistent NPC tiers (quests-relationships-npcs §5). Extras are narration only and walk-ons live on a scene card,
 * so neither has a character file.
 */
export const CHARACTER_TIERS = ['recurring', 'companion'] as const
export const CharacterTierSchema = z.enum(CHARACTER_TIERS)
export type CharacterTier = z.infer<typeof CharacterTierSchema>

const id = IdSchema

/** Relationship meters by the ruleset's meter ids (e.g. approval, trust, attraction); checked against it on load. */
export const MetersSchema = z.record(z.string(), z.number())
export type Meters = z.infer<typeof MetersSchema>

/** How a character talks, kept apart so the writer can be given only this beat's speakers (narrator-scene-engine §7). */
export const VoiceCardSchema = z.object({
  /** Sentence length and rhythm, e.g. "clipped; fragments; rarely more than ten words". */
  rhythm: z.string(),
  vocabulary: z.string(),
  slang: z.array(z.string()).default([]),
  /** What they never say, or steer around. */
  avoids: z.array(z.string()).default([]),
  sampleLines: z.array(z.string()).min(1),
  /** How the voice changes: angry, warm toward someone they like, and lying. */
  shifts: z.object({ angry: z.string(), warm: z.string(), lying: z.string() })
})
export type VoiceCard = z.infer<typeof VoiceCardSchema>

export const SecretSchema = z.object({
  id,
  text: z.string(),
  /** How they behave when guarding it, so deception reads on the page. */
  tell: z.string(),
  /** When they would let it go (free text for the director, until reveal conditions are built). */
  revealWhen: z.string().optional()
})
export type Secret = z.infer<typeof SecretSchema>

export const ValueSchema = z.object({ value: z.string(), stance: z.enum(['likes', 'dislikes']) })

/** How a character starts out toward someone else in the cast. */
export const RelationSeedSchema = z.object({
  to: id,
  label: z.string(),
  meters: MetersSchema
})

export const CharacterSchema = z
  .object({
    id,
    name: z.string(),
    tier: CharacterTierSchema,
    species: z.string(),
    pronouns: z.string(),
    /** Drawable traits only (art prompts). */
    appearance: z.string(),
    /** Who they are in the city: work, haunt, faction ties. */
    role: z.string(),
    faction: z.string().optional(),
    /** Their standing in that faction, on the engine's four levels; this is what decides what insiders know. */
    level: FactionLevelSchema.optional(),
    /** The title they go by there ("handler", "deacon"): flavor only, never read by rules. */
    rank: z.string().min(1).optional(),
    /** Their trade, lower case ("courier", "nurse"); entries can open to people by occupation. */
    occupation: z.string().min(1).optional(),
    /** Specific details, never an archetype label. */
    personality: z.string(),
    /**
     * How they are with others, in prose: with strangers and with people they know, what they notice, what they'd talk
     * about anyway, small habits. The writer's main picture of the person, so goals and secrets don't stand in for one
     * (claude/scene-system-redesign.md §7; the short form of milestone 4's portrait).
     */
    portrait: z.string(),
    agenda: z.object({ longTerm: z.array(z.string()).min(1), current: z.string() }),
    /** At least one internal tension. */
    contradictions: z.array(z.string()).min(1),
    voice: VoiceCardSchema,
    /** The mood they walk in with; it persists across turns once play starts. */
    mood: z.string(),
    /** What they know that could matter: about the city, the player, the others. */
    knowledge: z.array(z.string()).default([]),
    values: z.array(ValueSchema).default([]),
    secrets: z.array(SecretSchema).default([]),
    /** How they start out toward the player. */
    meters: MetersSchema,
    relations: z.array(RelationSeedSchema).default([]),
    /** Companions carry a full stat block; recurring NPCs get one from a tier template when first needed. */
    stats: StatBlockSchema.optional(),
    /** Placeholder sprite path relative to the content folder, until art generation exists. */
    sprite: z.string().optional()
  })
  .refine((c) => c.tier !== 'companion' || c.stats !== undefined, { message: 'companions need a stat block', path: ['stats'] })
export type Character = z.infer<typeof CharacterSchema>
