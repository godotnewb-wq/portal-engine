import type { GameState } from '@engine/state'
import type { Pack } from '@engine/pack'
import type { Prompt } from '@engine/core'
import { applySummaries, buildSummaryPrompt, parseSummary, plainSummary, witnesses, type Summary, type WitnessReport } from './summary'

/** Asks the summary model for one witness's summary. */
export type Summarize = (prompt: Prompt) => Promise<string>

export interface SceneEnd {
  state: GameState
  reports: WitnessReport[]
}

/**
 * Ends the scene: one summary per witness, all at once (outside the turn budget). A witness whose call fails gets a
 * plain memory and no change, so one bad reply never loses the others.
 */
export async function endScene(content: Pack, state: GameState, summarize: Summarize): Promise<SceneEnd> {
  if (!state.scene) throw new Error('No scene in progress')
  const summaries = await Promise.all(
    witnesses(state).map(async (id): Promise<{ id: string; summary: Summary; error?: string }> => {
      try {
        const summary = parseSummary(content.ruleset, await summarize(buildSummaryPrompt(content, state, id)))
        return { id, summary: summary.memory ? summary : { ...summary, memory: plainSummary(content, state, id).memory } }
      } catch (error) {
        return { id, summary: plainSummary(content, state, id), error: (error as Error).message }
      }
    })
  )
  return applySummaries(content, state, summaries)
}
