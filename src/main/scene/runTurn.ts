import type { SceneEvent } from '../../shared/ipc'
import type { Beat, GameState } from '../../shared/model'
import { parseReply, type ParsedReply } from '../../shared/game/beats'
import type { Content } from '../../shared/game/content'
import { buildDirectorPrompt, type Prompt } from '../../shared/game/directorPrompt'
import { checkReply, salvage, type Problem } from '../../shared/game/outputChecks'
import { fallbackPlan, parsePlan, validatePlan, type BeatPlan } from '../../shared/game/plan'
import { resolvePlan } from '../../shared/game/resolve'
import { applyTurn } from '../../shared/game/turn'
import { buildRewritePrompt, buildWriterPrompt, sceneSpeakers } from '../../shared/game/writerPrompt'

/** The LLM calls a turn may make. `write` streams; it is used for the scene writer and its one rewrite. */
export interface TurnLlm {
  direct(prompt: Prompt): Promise<string>
  write(prompt: Prompt, onDelta: (text: string) => void, onRestart: () => void): Promise<string>
}

/**
 * What the renderer is told as the turn goes, so beats can show while the writer streams. A `restart` means what was
 * streamed so far is being replaced: by another profile, or by the rewrite.
 */
export type TurnEvent = SceneEvent

export interface TurnOutcome {
  state: GameState
  beats: Beat[]
  plan: BeatPlan
  /** How many LLM calls the turn made: 2 normally, 3 with a rewrite. Never more. */
  calls: number
  corrections: string[]
  /** Problems found in the first draft, which the rewrite was asked to fix. */
  problems: Problem[]
  /** Problems still in the rewrite, which the game salvaged around. */
  remaining: Problem[]
  /** The director's reply could not be read and the game planned the turn itself. */
  fallback: boolean
}

/**
 * One player turn (narrator-scene-engine §3): director → game resolves mechanics → streamed writer → code checks →
 * one targeted rewrite if a check fails. At most three calls; anything still wrong after the rewrite is salvaged by
 * code rather than costing a fourth.
 */
export async function runTurn(content: Content, state: GameState, input: string, llm: TurnLlm, emit: (event: TurnEvent) => void = () => {}): Promise<TurnOutcome> {
  if (!state.scene) throw new Error('No scene in progress')
  if (state.scene.ended) throw new Error('The scene has ended')
  let calls = 0

  // Call 1: the director.
  calls++
  const directed = parsePlan(await llm.direct(buildDirectorPrompt(content, state, input)))
  const validated = directed ? validatePlan(content, state, directed) : { plan: fallbackPlan(content, state, input), corrections: ['director reply unreadable: game planned the turn'] }
  const { plan, dice } = resolvePlan(content, state, validated.plan)
  emit({ type: 'planned', speakers: plan.speakers.map((s) => s.id), checks: plan.checks.flatMap((c) => (c.line ? [c.line] : [])), corrections: validated.corrections, fallback: !directed })

  // Call 2: the writer, streamed.
  const speakers = sceneSpeakers(content, state)
  const writerPrompt = buildWriterPrompt(content, state, plan, input)
  const onDelta = (text: string) => emit({ type: 'delta', text })
  const onRestart = () => emit({ type: 'restart', reason: 'fallback-profile' })
  calls++
  const draft = await llm.write(writerPrompt, onDelta, onRestart)
  let parsed: ParsedReply = parseReply(draft, speakers)
  const problems = checkReply(parsed, plan, speakers, input)
  let remaining: Problem[] = []
  let beats = parsed.beats

  // Call 3, only if a check failed: one rewrite told exactly what to fix.
  if (problems.length > 0) {
    emit({ type: 'restart', reason: 'rewrite', problems: problems.map((p) => p.fix) })
    calls++
    const rewrite = await llm.write(buildRewritePrompt(writerPrompt, draft, problems.map((p) => p.fix)), onDelta, onRestart)
    parsed = parseReply(rewrite, speakers)
    remaining = checkReply(parsed, plan, speakers, input)
    beats = remaining.length > 0 ? salvage(parsed.beats, remaining) : parsed.beats
  }

  const next = applyTurn(content, state, { input, plan, beats, tags: parsed.tags, dice })
  return { state: next, beats, plan, calls, corrections: validated.corrections, problems, remaining, fallback: !directed }
}
