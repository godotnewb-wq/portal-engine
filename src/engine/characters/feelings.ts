import { z } from 'zod'
import type { Ruleset } from '@engine/rules'
import type { Character, FeelingWords } from './schema'

/**
 * Felt emotion (npc design §7, milestone 4b): what a character actually feels, as the game keeps it. The director names
 * a shade (and its family when the shade has several) with an intensity; the game files it under its family, which
 * carries masking, display lines and, later, fading. `text`: words to show with it (a card's default mood).
 * `atypical`: the intensity is outside the shade's typical range; kept, and logged so ranges and prompts can be tuned.
 */
export const FeelingSchema = z.object({
  shade: z.string(),
  family: z.string(),
  intensity: z.number().int().min(1).max(5),
  reason: z.string().optional(),
  text: z.string().optional(),
  atypical: z.boolean().optional()
})
export type Feeling = z.infer<typeof FeelingSchema>

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * A feeling as written, checked against the ruleset's shades: only listed shades, a family the shade is listed under
 * (named when it has more than one; npc design §7), an intensity of 1–5. The intensity wins over the shade's typical
 * range: an intensity outside it is kept and marked `atypical`, never rewritten. A problem says why it was refused.
 */
export function readFeeling(r: Ruleset, raw: { shade?: unknown; family?: unknown; intensity?: unknown; reason?: unknown }): { feeling: Feeling } | { problem: string } {
  const written = typeof raw.shade === 'string' ? raw.shade : ''
  const pool = r.people.emotions
  const shade = pool.shades.find((s) => normalize(s.word) === normalize(written))
  if (!shade) return { problem: written.trim() ? `"${written.trim()}" isn't a shade` : 'no shade' }
  const named = typeof raw.family === 'string' && raw.family.trim() ? normalize(raw.family) : undefined
  const family = named !== undefined ? shade.families.find((f) => normalize(f) === named || normalize(pool.families.find((x) => x.id === f)?.name ?? '') === named) : shade.families.length === 1 ? shade.families[0] : undefined
  if (!family) return { problem: named !== undefined ? `"${shade.word}" isn't listed under "${String(raw.family).trim()}"` : `"${shade.word}" needs its family: ${shade.families.join(' or ')}` }
  const intensity = typeof raw.intensity === 'number' ? raw.intensity : typeof raw.intensity === 'string' ? Number(raw.intensity.trim()) : NaN
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) return { problem: `"${shade.word}" needs an intensity from 1 to 5` }
  const [lo, hi] = shade.intensity
  const reason = typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : undefined
  return { feeling: { shade: shade.word, family, intensity, ...(reason && { reason }), ...((intensity < lo || intensity > hi) && { atypical: true }) } }
}

/** A card's default mood as a feeling. The card check has already held it to the ruleset; one that fails reads as nothing felt. */
export function defaultFeeling(r: Ruleset, c: Pick<Character, 'mood'>): Feeling | undefined {
  const read = readFeeling(r, c.mood)
  return 'feeling' in read ? { ...read.feeling, text: c.mood.text } : undefined
}

/** A shade with its family named when the shade has more than one ("regret (shame)"), as prompts write it. */
export function shadeWords(r: Ruleset, f: Pick<Feeling, 'shade' | 'family'>): string {
  const many = (r.people.emotions.shades.find((s) => s.word === f.shade)?.families.length ?? 1) > 1
  return many ? `${f.shade} (${f.family})` : f.shade
}

/** A feeling in words for the director and summaries: "worry, 3 of 5: the shipment is late", or "uneasy; felt as worry, 2 of 5" with the card's words. */
export function feelingWords(r: Ruleset, f: Feeling | undefined): string {
  if (!f) return 'nothing in particular'
  const core = `${shadeWords(r, f)}, ${f.intensity} of 5`
  if (f.text) return `${f.text}; felt as ${core}`
  return f.reason ? `${core}: ${f.reason}` : core
}

/** A feeling as a short label without the ruleset, for logs and read-outs: "worry 3/5 (the shipment is late)". */
export function feelingLabel(f: Feeling | undefined): string {
  if (!f) return ''
  return `${f.text ? `${f.text}; ` : ''}${f.shade} ${f.intensity}/5${f.reason ? ` (${f.reason})` : ''}`
}

/** Whether a written feeling is one of the ruleset's, for checking cards and scenarios. */
export function feelingProblem(r: Ruleset, f: FeelingWords): string | undefined {
  const read = readFeeling(r, f)
  return 'problem' in read ? read.problem : undefined
}
