import type { GameState } from '@engine/state'
import type { Pack } from '@engine/pack'
import { traced, TracedError, type CallTrace, type LlmReply, type Prompt } from '@engine/core'
import { applySummaries, buildSummaryPrompt, parseSummary, plainSummary, witnesses, type Summary, type WitnessReport } from './summary'

/** Asks the summary model for one witness's summary. */
export type Summarize = (prompt: Prompt) => Promise<LlmReply>

/** What the end of a scene did, for the logs: each witness's call, what was read from it, and what changed. */
export interface SceneEndTrace {
  sceneId: string
  at: string
  witnesses: { id: string; callId: string; summary: Summary; error?: string; report?: WitnessReport }[]
  calls: CallTrace[]
}

export interface SceneEnd {
  state: GameState
  reports: WitnessReport[]
  trace: SceneEndTrace
}

/**
 * Ends the scene: one summary per witness, all at once (outside the turn budget). A witness whose call fails gets a
 * plain memory and no change, so one bad reply never loses the others.
 */
export async function endScene(content: Pack, state: GameState, summarize: Summarize, now: () => number = Date.now): Promise<SceneEnd> {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const at = new Date(now()).toISOString()
  const calls: CallTrace[] = []
  try {
    const summaries = await Promise.all(
      witnesses(state).map(async (id): Promise<{ id: string; summary: Summary; error?: string }> => {
        const prompt = buildSummaryPrompt(content, state, id)
        try {
          const reply = await traced(calls, { id: `${scene.id}:summary:${id}`, role: 'summary', sceneId: scene.id }, prompt, now, () => summarize(prompt))
          const summary = parseSummary(content.ruleset, reply)
          return { id, summary: summary.memory ? summary : { ...summary, memory: plainSummary(content, state, id).memory } }
        } catch (error) {
          return { id, summary: plainSummary(content, state, id), error: (error as Error).message }
        }
      })
    )
    const { state: next, reports } = applySummaries(content, state, summaries)
    const trace: SceneEndTrace = {
      sceneId: scene.id,
      at,
      witnesses: summaries.map((s) => {
        const report = reports.find((r) => r.id === s.id)
        return { id: s.id, callId: `${scene.id}:summary:${s.id}`, summary: s.summary, ...(s.error && { error: s.error }), ...(report && { report }) }
      }),
      // Parallel calls finish in any order; the log reads better in witness order.
      calls: witnesses(state).flatMap((id) => calls.filter((c) => c.id === `${scene.id}:summary:${id}`))
    }
    return { state: next, reports, trace }
  } catch (error) {
    throw new TracedError((error as Error).message, calls)
  }
}
