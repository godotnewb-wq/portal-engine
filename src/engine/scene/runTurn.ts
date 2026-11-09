import type { Beat, GameState } from '@engine/state'
import { parseReply, type ParsedReply } from './beats'
import type { Pack } from '@engine/pack'
import { buildDirectorPrompt } from './director'
import { traced, TracedError, type CallTrace, type LlmReply, type Prompt } from '@engine/core'
import { checkReply, droppedBeats, salvaged, withoutSpeech, type Problem } from './checks'
import { fallbackPlan, parsePlan, validatePlan, type BeatPlan } from './plan'
import { resolvePlan, type ResolveOptions } from './resolve'
import { castSnapshot, checkTraces, planItems, type BeatTrace, type TurnTrace } from './trace'
import { applyTurn } from './turn'
import { buildRewritePrompt, buildWriterPrompt, sceneSpeakers } from './writer'
import { buildDirector2Prompt } from './director2'
import { parsePlan2, settlePlan2, validatePlan2 } from './plan2'
import { recentlyUsed, repeatProblems, usageOf } from './repeats'
import { buildWriter2Prompt } from './writer2'
import { loreTrace, turnLore } from './lore'

/**
 * The LLM calls a turn may make. `write` streams; it is used for the scene writer and its one rewrite. Either may
 * return the text alone, or the text with what the platform knows about the call (profile, model, tokens), which
 * goes into the turn trace.
 */
export interface TurnLlm {
  direct(prompt: Prompt): Promise<LlmReply>
  write(prompt: Prompt, onDelta: (text: string) => void, onRestart: () => void): Promise<LlmReply>
}

/**
 * What the renderer is told as the turn goes, so beats can show while the writer streams. A `restart` means what was
 * streamed so far is being replaced: by another profile, or by the rewrite.
 */
export type TurnEvent =
  | { type: 'planned'; speakers: string[]; checks: string[]; corrections: string[]; fallback: boolean }
  | { type: 'delta'; text: string }
  | { type: 'restart'; reason: 'fallback-profile' | 'rewrite'; problems?: string[] }

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
  /** Everything the turn did, for the logs. */
  trace: TurnTrace
}

export interface TurnOptions extends ResolveOptions {
  /** The turn's id; by default the scene's id and the turn's number. The app passes one unique across sessions. */
  turnId?: string
  /** The log session recording this turn, kept on the turn so flags made after a reload can name it. */
  log?: string
  /** The clock, in milliseconds; injected so tests can fix timings. */
  now?: () => number
  /**
   * Which director and writer run: `situation` (the default since 2026-11-07: the director plans moves and facts, the
   * writer writes the conversation; director-writer review, option B) or `lines` (the director plans each line's point;
   * kept so the bench can compare the two).
   */
  pipeline?: Pipeline
}

export type Pipeline = 'situation' | 'lines'
export const PIPELINES: Pipeline[] = ['situation', 'lines']

/**
 * One player turn (narrator-scene-engine §3): director → game resolves mechanics → streamed writer → code checks →
 * one targeted rewrite if a check fails. At most three calls; anything still wrong after the rewrite is salvaged by
 * code rather than costing a fourth. A failed call throws a `TracedError` carrying the calls made so far.
 */
export async function runTurn(
  content: Pack,
  state: GameState,
  input: string,
  llm: TurnLlm,
  emit: (event: TurnEvent) => void = () => {},
  options: TurnOptions = {}
): Promise<TurnOutcome> {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  if (scene.ended) throw new Error('The scene has ended')
  const now = options.now ?? Date.now
  const started = now()
  const turnId = options.turnId ?? `${scene.id}-${scene.turns.length + 1}`
  const calls: CallTrace[] = []
  const call = (role: CallTrace['role'], prompt: Prompt, run: Parameters<typeof traced>[4]) =>
    traced(calls, { id: `${turnId}:${role}`, role, turnId, sceneId: scene.id }, prompt, now, run)

  try {
    // Call 1: the director.
    const situation = (options.pipeline ?? 'situation') === 'situation'
    const lore = turnLore(content, state, input)
    const directorPrompt = situation ? buildDirector2Prompt(content, state, input, lore) : buildDirectorPrompt(content, state, input)
    const directorReply = await call('director', directorPrompt, () => llm.direct(directorPrompt))
    const directed = situation ? parsePlan2(directorReply) : parsePlan(directorReply)
    const validated = directed
      ? situation
        ? validatePlan2(content, state, directed as NonNullable<ReturnType<typeof parsePlan2>>, input, lore)
        : validatePlan(content, state, directed as NonNullable<ReturnType<typeof parsePlan>>)
      : { plan: fallbackPlan(content, state, input), corrections: [] }
    const resolved = resolvePlan(content, state, validated.plan, options)
    const dice = resolved.dice
    const plan = situation ? settlePlan2(content, state, resolved.plan) : resolved.plan
    emit({ type: 'planned', speakers: plan.speakers.map((s) => s.id), checks: plan.checks.flatMap((c) => (c.line ? [c.line] : [])), corrections: validated.corrections, fallback: !directed })

    // Call 2: the writer, streamed.
    const speakers = sceneSpeakers(content, state)
    const writerPrompt = situation ? buildWriter2Prompt(content, state, plan, input) : buildWriterPrompt(content, state, plan, input)
    const stream = (role: 'writer' | 'rewrite', prompt: Prompt) =>
      call(role, prompt, (hooks) =>
        llm.write(
          prompt,
          (text) => {
            hooks.first()
            emit({ type: 'delta', text })
          },
          () => {
            hooks.restart()
            emit({ type: 'restart', reason: 'fallback-profile' })
          }
        )
      )
    const draft = await stream('writer', writerPrompt)
    let parsed: ParsedReply = parseReply(draft, speakers)
    // The repetition tracker runs for the situation pipeline only, so the older one stays a fixed baseline.
    const recent = situation ? recentlyUsed(content, scene) : {}
    const check = (reply: ParsedReply) => [...checkReply(reply, plan, speakers, input, content.phrases), ...repeatProblems(content, reply, recent)]
    const problems = check(parsed)
    let remaining: Problem[] = []
    let kept = parsed.beats.map((_, i) => i)

    // Call 3, only if a check failed: one rewrite told exactly what to fix.
    if (problems.length > 0) {
      emit({ type: 'restart', reason: 'rewrite', problems: problems.map((p) => p.fix) })
      const rewrite = await stream('rewrite', buildRewritePrompt(writerPrompt, draft, problems.map((p) => p.fix)))
      parsed = parseReply(rewrite, speakers)
      remaining = check(parsed)
      kept = remaining.length > 0 ? salvaged(parsed.beats.length, remaining) : parsed.beats.map((_, i) => i)
      const spoken = new Set(remaining.filter((p) => p.kind === 'speech-in-narration').map((p) => p.beat! - 1))
      if (spoken.size > 0) {
        parsed = { ...parsed, beats: parsed.beats.map((b, i) => (spoken.has(i) ? { ...b, text: withoutSpeech(b.text) } : b)) }
        kept = kept.filter((i) => /\p{L}/u.test(parsed.beats[i]!.text))
      }
    }
    const beats = kept.map((i) => parsed.beats[i]!)

    const next = applyTurn(content, state, { id: turnId, ...(options.log && { log: options.log }), input, plan, beats, tags: parsed.tags, dice })
    const rewritten = problems.length > 0
    const salvage = rewritten && remaining.length > 0
    const dropped = salvage ? droppedBeats(remaining).filter((n) => n <= parsed.beats.length) : []
    const beatTraces: BeatTrace[] = kept.map((i, n) => ({
      index: n + 1,
      beat: parsed.beats[i]!,
      source: rewritten ? 'rewrite' : 'draft',
      line: parsed.lines[i]!,
      salvaged: salvage,
      plan: planItems(content, plan, parsed.beats[i]!, parsed.beats.slice(0, i))
    }))
    const directorCall = calls.find((c) => c.role === 'director')!
    const usage = calls.flatMap((c) => (c.meta?.usage ? [c.meta.usage] : []))
    const trace: TurnTrace = {
      turnId,
      sceneId: scene.id,
      turn: scene.turns.length + 1,
      at: new Date(started).toISOString(),
      input,
      cast: { before: castSnapshot(state), after: castSnapshot(next) },
      director: { callId: directorCall.id, read: !directed ? 'unreadable' : directorCall.meta?.jsonRetried ? 'json-retried' : 'json', plan, corrections: validated.corrections, pipeline: situation ? 'situation' : 'lines' },
      dice: { before: state.dice, after: dice },
      checks: checkTraces(plan),
      // The lines pipeline carries the stage only, so its trace says so: no scene or triggered lore reached it.
      lore: situation ? loreTrace(lore) : { ...loreTrace(lore), scene: [], triggered: [], stances: [], tokens: { ...loreTrace(lore).tokens, scene: 0, triggered: 0 } },
      writer: { callId: `${turnId}:writer`, ...(parsed.reshaped.length > 0 && { reshaped: parsed.reshaped }) },
      findings: problems,
      ...(rewritten && {
        rewrite: {
          callId: `${turnId}:rewrite`,
          remaining,
          ...(salvage && { salvage: { dropped, cut: parsed.beats.length - kept.length - dropped.length } })
        }
      }),
      beats: beatTraces,
      usage: usageOf(content, beats),
      tags: { parsed: parsed.tags, dropped: parsed.droppedTags },
      cost: {
        calls: calls.length,
        ms: now() - started,
        ...(usage.length > 0 && { tokens: { input: usage.reduce((n, u) => n + (u.input ?? 0), 0), output: usage.reduce((n, u) => n + (u.output ?? 0), 0) } })
      },
      calls
    }
    return { state: next, beats, plan, calls: calls.length, corrections: validated.corrections, problems, remaining, fallback: !directed, trace }
  } catch (error) {
    if (error instanceof TracedError) throw error
    throw new TracedError((error as Error).message, calls)
  }
}
