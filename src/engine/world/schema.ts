import { z } from 'zod'
import { IdSchema } from '@engine/characters'

/** The city's tiers, top to bottom (lore: Spire City). */
export const CITY_TIERS = ['crown', 'high-turns', 'middle-turns', 'low-turns', 'deepwell'] as const
export const CityTierSchema = z.enum(CITY_TIERS)

/** A walk-on: one line of each, voiced by the narrator, never given a speaking slot (quests-relationships-npcs §5). */
export const SceneCardSchema = z.object({
  id: IdSchema,
  label: z.string(),
  name: z.string().optional(),
  species: z.string(),
  look: z.string(),
  manner: z.string(),
  role: z.string()
})
export type SceneCard = z.infer<typeof SceneCardSchema>

/**
 * Specific details the director picks 2–3 of per beat, so description is rooted in Spire City and not generic
 * fantasy (narrator-scene-engine §8).
 */
export const TextureCardSchema = z.object({
  sights: z.array(z.string()).min(1),
  sounds: z.array(z.string()).min(1),
  smells: z.array(z.string()).min(1),
  slang: z.array(z.string()).default([]),
  /** What's going on here lately; the world turn will write these later. */
  current: z.array(z.string()).default([])
})
export type TextureCard = z.infer<typeof TextureCardSchema>

export const LocationSchema = z.object({
  id: IdSchema,
  name: z.string(),
  tier: CityTierSchema,
  district: z.string(),
  description: z.string(),
  texture: TextureCardSchema,
  walkOns: z.array(SceneCardSchema).default([]),
  /** Extras: the crowd, as one phrase each. */
  extras: z.array(z.string()).default([]),
  background: z.string().optional()
})
export type Location = z.infer<typeof LocationSchema>
