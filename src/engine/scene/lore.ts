import { directorStage, loreLayers, writerStage, type LayerEntry, type LoreLayers, type Stage } from '@engine/codex'
import { firstName } from '@engine/core'
import { characterById, locationById, type Pack } from '@engine/pack'
import type { GameState } from '@engine/state'
import { RECENT_TURNS, turnText } from './director'
import { presentCast } from './plan'

/** The lore one turn's prompts carry (claude/lore-injection.md §5), worked out once and shared by both calls. */
export interface TurnLore {
  stage: Stage
  writerStage: Stage
  layers: LoreLayers
}

/** What the turn's lore was, for the trace: entry ids per layer and their rough size. */
export interface LoreTrace {
  stage: string[]
  scene: LayerEntry[]
  triggered: LayerEntry[]
  tokens: { stage: number; writerStage: number; scene: number; triggered: number }
}

export function turnLore(content: Pack, state: GameState, input: string): TurnLore {
  const scene = state.scene!
  const location = locationById(content, scene.locationId)
  const present = presentCast(scene).flatMap((id) => {
    const c = characterById(content, id)
    return c ? [{ id: c.id, name: c.name, species: c.species, ...(c.faction && { faction: c.faction }) }] : []
  })
  const people = [...content.characters.map((c) => c.name), state.player.name, ...(location?.walkOns.flatMap((w) => (w.name ? [w.name] : [])) ?? [])]
  const ignore = [...new Set([...people, ...people.map(firstName)])]
  const texts = [input, ...scene.turns.slice(-RECENT_TURNS).map((t) => turnText(content, state.player.name, t)), scene.summary]
  return {
    stage: directorStage(content.primer, content.codex, content.setting),
    writerStage: writerStage(content.tone, content.codex),
    layers: loreLayers(
      content.codex,
      content.setting,
      { ...(location && { location: { id: location.id, ...(location.parent && { parent: location.parent }) } }), present, texts, ignore },
      { sceneTokens: content.ruleset.codex.sceneTokens, triggeredTokens: content.ruleset.codex.triggeredTokens }
    )
  }
}

export const loreTrace = (lore: TurnLore): LoreTrace => ({
  stage: lore.stage.ids,
  scene: lore.layers.scene.entries,
  triggered: lore.layers.triggered.entries,
  tokens: { stage: lore.stage.tokens, writerStage: lore.writerStage.tokens, scene: lore.layers.scene.tokens, triggered: lore.layers.triggered.tokens }
})
