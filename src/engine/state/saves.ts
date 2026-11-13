// Adapted from Breedhaven University, src/shared/saves.ts (GPL-3.0-only). See NOTICE.md.

import { z } from 'zod'
import { GameStateSchema } from './schema'

/**
 * Bump when the save format changes; older saves are then refused with a clear message (no backwards compatibility
 * before release). 4: signed meters, Interest for Attraction, relation notes for derived labels; 5: the `major` tier and a
 * separate party list (both milestone 4a).
 */
export const SAVE_VERSION = 5

/** The game's own slot: written after every turn and every scene's end, never by hand. */
export const AUTO_SLOT_ID = 'auto'
export const MANUAL_SLOTS = 8
export const MANUAL_SLOT_IDS: readonly string[] = Array.from({ length: MANUAL_SLOTS }, (_, i) => `slot${i + 1}`)
export const SLOT_IDS: readonly string[] = [AUTO_SLOT_ID, ...MANUAL_SLOT_IDS]
export const SlotIdSchema = z.string().refine((id) => SLOT_IDS.includes(id), 'No such save slot')
export type SlotId = string

export const SAVE_NAME_CHARS = 40
/** A name the player gives a save: trimmed and capped. Empty for none. */
export const SaveNameSchema = z.string().transform((name) => name.trim().slice(0, SAVE_NAME_CHARS))

/**
 * Which pack a save was played with. An object, so it can later list the pack overlays a playthrough used
 * (architecture §12).
 */
export const SavePackSchema = z.object({ id: z.string(), version: z.string() })
export type SavePack = z.infer<typeof SavePackSchema>

/** Everything needed to resume, including a scene still in progress (it lives in the state). */
export const SaveFileSchema = z.object({
  version: z.literal(SAVE_VERSION),
  pack: SavePackSchema,
  /** Real-world time of the save, ISO 8601. */
  savedAt: z.string(),
  /** What the player called it. Left out, it goes by its slot. */
  name: z.string().optional(),
  state: GameStateSchema
})
export type SaveFile = z.infer<typeof SaveFileSchema>

export const SaveRequestSchema = z.object({
  slotId: SlotIdSchema,
  state: GameStateSchema,
  /** Left out, a save written over another keeps the other's name. */
  name: SaveNameSchema.optional()
})
export type SaveRequest = z.input<typeof SaveRequestSchema>

/** What the slot list shows. Unreadable saves are listed so they aren't overwritten unknowingly. */
export type SaveSummary = { slotId: SlotId; savedAt: string } & (
  | { unreadable: false; name?: string; packVersion: string; playerName: string; time: number; inScene: boolean; turns: number; memories: number }
  | { unreadable: true; /** Made with an earlier save format: refused, not damaged. */ outdated?: true }
)

export function slotLabel(slotId: SlotId): string {
  return slotId === AUTO_SLOT_ID ? 'Autosave' : `Slot ${slotId.slice(4)}`
}

/** The save to continue from: the most recently written readable one. */
export function latestSave(saves: SaveSummary[]): SaveSummary | undefined {
  return saves.filter((s) => !s.unreadable).sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
}
