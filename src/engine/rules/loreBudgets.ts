import { z } from 'zod'
import type { Ruleset } from './ruleset'

/**
 * The lore budgets a player may override in Settings (claude/milestone-3-plan.md, task 10): the scene-scoped and
 * triggered layers' token budgets and the lore lines a turn. One set for every pack; a field left out uses the pack's
 * ruleset. The stage isn't here: it's built once per session and only reported.
 */
export const LORE_BUDGET_FIELDS = ['sceneTokens', 'triggeredTokens', 'loreLines'] as const
export type LoreBudgetField = (typeof LORE_BUDGET_FIELDS)[number]

/** What Settings accepts. 0 turns a layer off, or gives the director no lore lines, for comparing with and without. */
export const LORE_BUDGET_BOUNDS: Record<LoreBudgetField, { min: number; max: number }> = {
  sceneTokens: { min: 0, max: 4000 },
  triggeredTokens: { min: 0, max: 4000 },
  loreLines: { min: 0, max: 5 }
}

export const LoreBudgetOverridesSchema = z.object({
  sceneTokens: z.number().optional(),
  triggeredTokens: z.number().optional(),
  loreLines: z.number().optional()
})
export type LoreBudgetOverrides = z.infer<typeof LoreBudgetOverridesSchema>

/** The budgets a turn runs with, and which of them came from Settings rather than the pack. */
export interface LoreBudgets {
  sceneTokens: number
  triggeredTokens: number
  loreLines: number
  /** The fields Settings overrode; empty when the pack's defaults apply. */
  set: LoreBudgetField[]
}

/**
 * Cleans what was saved or typed: anything that isn't a number is dropped (the pack's value applies), and a number
 * outside the bounds is rounded and brought inside them, with a warning saying so.
 */
export function cleanLoreBudgets(raw: unknown): { overrides: LoreBudgetOverrides; warnings: string[] } {
  const overrides: LoreBudgetOverrides = {}
  const warnings: string[] = []
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  for (const field of LORE_BUDGET_FIELDS) {
    const value = source[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const { min, max } = LORE_BUDGET_BOUNDS[field]
    const kept = Math.min(max, Math.max(min, Math.round(value)))
    if (kept !== value) warnings.push(`lore budget ${field} ${value} is outside ${min}–${max}; using ${kept}`)
    overrides[field] = kept
  }
  return { overrides, warnings }
}

/** The budgets in effect: each overridden field from Settings, the rest from the pack's ruleset. */
export function loreBudgets(ruleset: Ruleset, overrides: LoreBudgetOverrides = {}): LoreBudgets {
  const { overrides: clean } = cleanLoreBudgets(overrides)
  const set = LORE_BUDGET_FIELDS.filter((f) => clean[f] !== undefined)
  return {
    sceneTokens: clean.sceneTokens ?? ruleset.codex.sceneTokens,
    triggeredTokens: clean.triggeredTokens ?? ruleset.codex.triggeredTokens,
    loreLines: clean.loreLines ?? ruleset.codex.loreLines,
    set
  }
}
