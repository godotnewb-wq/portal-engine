import { directorStage, loreLayers, triggeredEntries, writerStage, type LayerEntry, type LoreLayers, type Stage } from '@engine/codex'
import { firstName } from '@engine/core'
import { characterById, knowerOf, locationById, type Pack } from '@engine/pack'
import { loreBudgets, type LoreBudgetOverrides, type LoreBudgets } from '@engine/rules'
import type { GameState } from '@engine/state'
import { RECENT_TURNS } from './director'
import { presentCast } from './planShape'
import { secretDisplay, type SecretShown } from './secrets'

/** The lore one turn's prompts carry (lore injection.md §5), worked out once and shared by both calls. */
export interface TurnLore {
  stage: Stage
  writerStage: Stage
  layers: LoreLayers
  /** The budgets this turn ran with: the pack's, with any the player set in Settings. */
  budgets: LoreBudgets
  /** How each held secret shows on the director's situation sheet: a cue or in full (lore injection.md §7.1). */
  secrets: SecretShown[]
}

/** What the turn's lore was, for the trace: entry ids per layer and their rough size. */
export interface LoreTrace {
  stage: string[]
  scene: LayerEntry[]
  triggered: LayerEntry[]
  /** Official stance lines the director was given; absent in logs from before the knowledge filter. */
  stances?: string[]
  tokens: { stage: number; writerStage: number; scene: number; triggered: number }
  /** The budgets in effect and which came from Settings; absent in logs from before they could be set. */
  budgets?: LoreBudgets
  /** Budget decisions, absent from older logs. */
  budgetCuts?: Record<'scene' | 'triggered', { shortened: string[]; dropped: string[] }>
  /** How each held secret showed on the director's sheet; absent from logs before milestone 3.5. */
  secrets?: SecretShown[]
}

export function turnLore(content: Pack, state: GameState, input: string, overrides: LoreBudgetOverrides = {}): TurnLore {
  const scene = state.scene!
  const location = locationById(content, scene.locationId)
  const present = presentCast(scene).flatMap((id) => {
    const c = characterById(content, id)
    return c ? [knowerOf(c)] : []
  })
  const people = [...content.characters.map((c) => c.name), state.player.name, ...(location?.walkOns.flatMap((w) => (w.name ? [w.name] : [])) ?? [])]
  const ignore = [...new Set([...people, ...people.map(firstName)])]
  const recent = scene.turns.slice(-RECENT_TURNS)
  // What the player typed matches in any case; what the model wrote is stricter about capitalized names (codex layers).
  const texts = [input, ...recent.map((t) => t.player)]
  const written = [...recent.flatMap((t) => t.beats.map((b) => b.text)), scene.summary]
  const budgets = loreBudgets(content.ruleset, overrides)
  const layers = loreLayers(
    content.codex,
    content.setting,
    { ...(location && { location: { id: location.id, ...(location.parent && { parent: location.parent }) } }), present, texts, written, ignore },
    { sceneTokens: budgets.sceneTokens, triggeredTokens: budgets.triggeredTokens, stanceWords: content.vocabulary.stanceWords }
  )
  return {
    budgets,
    stage: directorStage(content.primer, content.codex, content.setting),
    writerStage: writerStage(content.tone, content.codex),
    layers,
    // Secrets read the same scan as the triggered layer, so a keyword or a name just said counts the same way.
    secrets: secretDisplay(content, state, { texts: [...texts, ...written], mentioned: new Set(triggeredEntries(content.codex, texts, ignore, written).map((e) => e.id)) })
  }
}

export const loreTrace = (lore: TurnLore): LoreTrace => ({
  stage: lore.stage.ids,
  scene: lore.layers.scene.entries,
  triggered: lore.layers.triggered.entries,
  stances: lore.layers.stances,
  tokens: { stage: lore.stage.tokens, writerStage: lore.writerStage.tokens, scene: lore.layers.scene.tokens, triggered: lore.layers.triggered.tokens },
  budgets: lore.budgets,
  budgetCuts: {
    scene: { shortened: lore.layers.scene.shortened, dropped: lore.layers.scene.dropped },
    triggered: { shortened: lore.layers.triggered.shortened, dropped: lore.layers.triggered.dropped }
  },
  secrets: lore.secrets
})
