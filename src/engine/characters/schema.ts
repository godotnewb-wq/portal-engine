import { z } from 'zod'
import { IdSchema } from '@engine/core'
import { StatBlockSchema } from '@engine/rules'
import { FactionLevelSchema } from '@engine/world'

/**
 * Persistent NPC tiers (npc design §2): how detailed a character is. Extras are narration only and walk-ons live on a
 * scene card, so neither has a character file. Being in the party is not a tier: a companion is a Major Character
 * currently in the party, kept in the game state (milestone 4a).
 */
export const CHARACTER_TIERS = ['recurring', 'major'] as const
export const CharacterTierSchema = z.enum(CHARACTER_TIERS)
export type CharacterTier = z.infer<typeof CharacterTierSchema>

const id = IdSchema

/** Relationship meters by the ruleset's meter ids (e.g. approval, trust, interest), signed around neutral; checked against it on load. */
export const MetersSchema = z.record(z.string(), z.number())
export type Meters = z.infer<typeof MetersSchema>

/** How a character talks, kept apart so the writer can be given only this beat's speakers (director writer §7). */
export const VoiceCardSchema = z.object({
  /** Sentence length and rhythm, e.g. "clipped; fragments; rarely more than ten words". */
  rhythm: z.string(),
  vocabulary: z.string(),
  slang: z.array(z.string()).default([]),
  /** What they never say, or steer around. */
  avoids: z.array(z.string()).default([]),
  sampleLines: z.array(z.string()).min(1),
  /** How the voice changes: angry, warm toward someone they like, and lying. */
  /** How the voice changes: angry, warm toward someone they like, lying, and (the full card) afraid. */
  shifts: z.object({ angry: z.string(), warm: z.string(), lying: z.string(), afraid: z.string().min(1).optional() })
})
export type VoiceCard = z.infer<typeof VoiceCardSchema>

/**
 * A secret is personal (free text about their own life, which may name factions and places) or linked: a pointer to
 * a codex secret, with their part in it and how they feel about it, so faction canon is written once, in the codex
 * (lore injection.md §7.1). A linked secret's text is filled in from the codex when the pack loads.
 */
export const SecretSchema = z
  .object({
    id,
    text: z.string().min(1).optional(),
    /** Linked: the codex secret it points to, e.g. "faction.ada-guild.ledger". */
    codex: z.string().min(1).optional(),
    /** Linked: their part in it, in words ("moved it for them", "knows of it"). */
    role: z.string().min(1).optional(),
    /** Linked: how they feel about it, what they'd do to keep it. */
    angle: z.string().min(1).optional(),
    /** How they behave when guarding it, so deception reads on the page. */
    tell: z.string(),
    /** When they would let it go: prose the director weighs, alongside the minimums below. */
    revealWhen: z.string().optional(),
    /**
     * Voluntary disclosure (npc design §6, milestone 4a): ladder words per meter that the holder's feelings toward the
     * listener must all meet before they choose to share it. A meter left out asks nothing.
     */
    disclose: z.record(z.string(), z.string().min(1)).optional(),
    /**
     * Personal: the short form the director sees until the secret is expanded (lore injection.md §7.1); without
     * one, the text's first sentence. A linked secret's short form is its codex entry's summary.
     */
    summary: z.string().min(1).optional(),
    /** Personal: words that, said in the scene, put the secret first in line to be shown in full. Linked: the codex entry's. */
    keywords: z.array(z.string().min(1)).optional()
  })
  .refine((s) => (s.codex ? !!s.role && !!s.angle : !!s.text), { message: 'a secret needs its text, or a codex pointer with a role and an angle' })
  .refine((s) => !s.codex || (!s.summary && !s.keywords), { message: 'a linked secret takes its summary and keywords from its codex entry' })
/** After loading every secret has its text: written, or resolved from the codex. */
export type Secret = z.infer<typeof SecretSchema> & { text: string }

/**
 * A schedule entry (npc design §2): a codex location, a time window ("16:00"–"20:00"; a window may cross midnight),
 * which days (left out, every day: "weekdays", "weekends" or day names), and a line in words. Used from milestone 6.
 */
export const HauntSchema = z.object({
  location: z.string().min(1),
  from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time is HH:MM'),
  to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time is HH:MM'),
  days: z.union([z.enum(['weekdays', 'weekends']), z.array(z.string().min(1)).min(1)]).optional(),
  note: z.string().min(1)
})
export type Haunt = z.infer<typeof HauntSchema>

/**
 * The four layers of a person (npc design §4), in the ruleset's words: the axes and attachment stages that matter for
 * them, their values (each one of the ruleset's, with a strength and liked or disliked, and optionally in their own
 * words), and their foundation sensitivities. Never shown to the writer as labels.
 */
export const LayersSchema = z.object({
  axes: z.record(z.string(), z.string()).default({}),
  attachment: z.record(z.string(), z.string()).default({}),
  values: z.array(z.object({ value: z.string(), strength: z.string(), stance: z.enum(['likes', 'dislikes']), personal: z.string().min(1).optional() })).default([]),
  foundations: z.record(z.string(), z.string()).default({})
})
export type Layers = z.infer<typeof LayersSchema>

/**
 * How feelings show on them (npc design §7): masking per emotion family where it differs from their Composure's
 * default, one display line per family (how it looks when it does show), and optional lines for shades that look
 * different from their family.
 */
export const ExpressionSchema = z.object({
  masking: z.record(z.string(), z.string()).default({}),
  display: z.record(z.string(), z.string().min(1)).default({}),
  shades: z.record(z.string(), z.string().min(1)).default({})
})

/** A gate profile's own words for one action (npc design §6): a base in place of the ruleset's, and requirements fixed outright. */
export const GateSchema = z.object({ base: z.record(z.string(), z.string()).optional(), fixed: z.record(z.string(), z.string()).optional() })

/** A tie to the player that isn't about feelings (npc design §6): its type, strength, what makes it valid, and why, as they see it. */
export const MotiveSchema = z.object({ type: z.string(), strength: z.string(), evidence: z.string().min(1), reason: z.string().min(1) })
export type Motive = z.infer<typeof MotiveSchema>

/**
 * A relationship tag one character holds toward another (relationships §3): a tag from the ruleset's list, the word it
 * reads as on this card ("stepbrother" for a sibling tag), and whether it is private (a secret lover, a hidden
 * informant), which keeps it from the writer unless the director keeps it like a secret.
 */
export const TieTagSchema = z.object({ tag: id, word: z.string().min(1).optional(), private: z.boolean().optional() })
export type TieTag = z.infer<typeof TieTagSchema>

/**
 * How a character starts out toward someone else in the cast: what they are to each other (up to the ruleset's limit
 * of tags; none means acquaintances), how they feel (meters), and one line of specific history between them (the
 * relationship note).
 */
export const RelationSeedSchema = z.object({
  to: id,
  tags: z.array(TieTagSchema).default([]),
  note: z.string().min(1),
  meters: MetersSchema
})

/** What the player is to them, if anything (tags and a note); their feelings toward the player are `meters`. The player holds no tags. */
export const PlayerTieSchema = z.object({ tags: z.array(TieTagSchema).default([]), note: z.string().min(1) })

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
    /**
     * How they are with others, in prose: with strangers and with people they know, what they notice, what they'd talk
     * about anyway, small habits. The writer's main picture of the person, so goals and secrets don't stand in for one
     * (scene system redesign.md §7; the short form of milestone 4's portrait).
     */
    portrait: z.string(),
    agenda: z.object({ longTerm: z.array(z.string()).min(1), current: z.string() }),
    /** At least one internal tension. */
    contradictions: z.array(z.string()).min(1),
    voice: VoiceCardSchema,
    /** The mood they walk in with; it persists across turns once play starts. */
    mood: z.string(),
    /** Age stage, from the ruleset (npc design §3); drives portrayal and the child guard. */
    age: z.string().optional(),
    /** Where they can be found, and when (npc design §2). */
    haunts: z.array(HauntSchema).default([]),
    /** How they behave when lying or hiding something (npc design §3). */
    tells: z.array(z.string().min(1)).default([]),
    layers: LayersSchema.optional(),
    expression: ExpressionSchema.optional(),
    /** Their own gate words per action, and what blocks an action outright regardless of feelings. */
    gates: z.record(z.string(), GateSchema).default({}),
    blockers: z.array(z.object({ action: z.string(), reason: z.string().min(1) })).default([]),
    motives: z.array(MotiveSchema).default([]),
    /** How easily they change, and per-field growth locks (npc design §8); used from milestone 9. */
    malleability: z.string().optional(),
    fieldLocks: z.record(z.string(), z.string()).default({}),
    /** What they know that could matter: about the city, the player, the others. */
    knowledge: z.array(z.string()).default([]),
    secrets: z.array(SecretSchema).default([]),
    /** How they start out toward the player. */
    meters: MetersSchema,
    relations: z.array(RelationSeedSchema).default([]),
    playerTie: PlayerTieSchema.optional(),
    /** A full stat block. Party members need one; others get one from a tier template when first needed. */
    stats: StatBlockSchema.optional(),
    /** Placeholder sprite path relative to the content folder, until art generation exists. */
    sprite: z.string().optional()
  })
/** A character file as written; linked secrets have no text yet. */
export type CharacterFile = z.infer<typeof CharacterSchema>
/** A loaded character: every secret has its text. */
export type Character = Omit<CharacterFile, 'secrets'> & { secrets: Secret[] }
