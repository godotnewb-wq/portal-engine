import type { GameState, TieChange } from '@engine/state'
import type { Pack } from '@engine/pack'
import { traced, TracedError, type CallTrace, type LlmReply, type Prompt } from '@engine/core'
import { applySummaries, buildMemoryPrompt, noChange, parseSummary, plainSummary, witnesses, type Summary, type WitnessReport } from './summary'

/** Asks the summary model: a witness's relationship call or memory call, or a consolidation. */
export type Summarize = (prompt: Prompt) => Promise<LlmReply>

/** What the end of a scene did, for the logs: each witness's call, what was read from it, and what changed. */
export interface SceneEndTrace {
  sceneId: string
  at: string
  witnesses: { id: string; callId: string; summary: Summary; error?: string; report?: WitnessReport }[]
  /** The player's answers to relationship changes waiting on them (milestone 4b), asked before the memory calls. */
  answered?: { change: TieChange; accepted: boolean }[]
  calls: CallTrace[]
}

export interface SceneEnd {
  state: GameState
  reports: WitnessReport[]
  trace: SceneEndTrace
}

/**
 * A witness's two end-of-scene calls as one summary (milestone 4c): the memories, revisits and learned secrets from the
 * memory call's reply, and the meters and feelings from the relationship call the scene kept (`judged`). A witness with
 * no relationship answers, because the call failed or was never made, changes no meters and carries nothing.
 */
function summaryOf(content: Pack, state: GameState, id: string, memory: Summary): Summary {
  const r = content.ruleset
  const judged = state.scene!.judged?.[id]
  const delta = (d: Record<string, number> | undefined) => ({ ...noChange(r), ...d })
  return {
    memories: memory.memories,
    revisited: memory.revisited,
    ...(memory.heard && { heard: memory.heard }),
    reason: judged?.reason ?? '',
    delta: delta(judged?.delta),
    others: (judged?.others ?? []).map((o) => ({ ...o, delta: delta(o.delta) })),
    ...(judged?.feels && { feels: judged.feels }),
    toward: judged?.toward ?? [],
    resolved: judged?.resolved ?? []
  }
}

/**
 * Closes the scene, after the relationship calls (`judgeScene`) and the player's answers: one memory call per witness,
 * all at once (outside the turn budget), then everything is applied together. A witness whose memory call fails gets a
 * plain memory; one whose relationship call failed changes no meters. One bad reply never loses the others.
 */
export async function endScene(content: Pack, state: GameState, summarize: Summarize, now: () => number = Date.now): Promise<SceneEnd> {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const at = new Date(now()).toISOString()
  const calls: CallTrace[] = []
  // A relationship call that failed is reported with the witness, as a failed memory call is.
  const failed = (id: string) => (scene.judged?.[id]?.error ? `relationship call: ${scene.judged[id]!.error}` : undefined)
  try {
    const summaries = await Promise.all(
      witnesses(state).map(async (id): Promise<{ id: string; summary: Summary; error?: string }> => {
        const prompt = buildMemoryPrompt(content, state, id)
        try {
          const reply = await traced(calls, { id: `${scene.id}:memory:${id}`, role: 'memory', sceneId: scene.id }, prompt, now, () => summarize(prompt))
          const memory = parseSummary(content.ruleset, reply)
          return { id, summary: summaryOf(content, state, id, memory.memories.length > 0 ? memory : { ...memory, memories: plainSummary(content, state, id).memories }), ...(failed(id) && { error: failed(id) }) }
        } catch (error) {
          return { id, summary: summaryOf(content, state, id, plainSummary(content, state, id)), error: (error as Error).message }
        }
      })
    )
    const { state: next, reports } = applySummaries(content, state, summaries)
    const trace: SceneEndTrace = {
      sceneId: scene.id,
      at,
      witnesses: summaries.map((s) => {
        const report = reports.find((r) => r.id === s.id)
        return { id: s.id, callId: `${scene.id}:memory:${s.id}`, summary: s.summary, ...(s.error && { error: s.error }), ...(report && { report }) }
      }),
      ...(scene.answered.length > 0 && { answered: scene.answered.map(({ accepted, ...change }) => ({ change, accepted })) }),
      // Parallel calls finish in any order; the log reads better in witness order.
      calls: witnesses(state).flatMap((id) => calls.filter((c) => c.id === `${scene.id}:memory:${id}`))
    }
    return { state: next, reports, trace }
  } catch (error) {
    throw new TracedError((error as Error).message, calls)
  }
}
