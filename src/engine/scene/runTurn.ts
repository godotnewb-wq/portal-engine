import type { Beat, GameState } from '@engine/state'
import { parseReply, type ParsedReply } from './beats'
import type { Pack } from '@engine/pack'
import { buildBriefs, buildDirectorPrompt } from './director'
import { carryDetails } from './brief'
import { traced, TracedError, type CallTrace, type LlmReply, type Prompt } from '@engine/core'
import { checkReply, droppedBeats, loreProblems, salvaged, withoutSpeech, type Problem } from './checks'
import { fallbackPlan, parsePlan, settlePlan, validatePlan } from './plan'
import type { BeatPlan } from './planShape'
import { resolvePlan, type ResolveOptions } from './resolve'
import { castSnapshot, checkTraces, planItems, shownTraces, type BeatTrace, type TurnTrace } from './trace'
import { activeSecrets } from './secrets'
import { acceptTags, applyTurn, showDepartures } from './turn'
import { buildRewritePrompt, buildWriterPrompt, sceneSpeakers } from './writer'
import { recentlyUsed, repeatProblems, usageOf } from './repeats'
import { loreTrace, turnLore } from './lore'
import type { LoreBudgetOverrides } from '@engine/rules'
import { DEFAULT_PIPELINE, isPipeline, type Pipeline } from './pipeline'
import { gatherScene } from './gather'
import { buildSceneDirectorPrompt } from './sceneDirector'
import { liveRecords, parseScenePlan, sceneFallback, sceneView, validateScenePlan } from './scenePlan'
import { buildSceneWriterPrompt, ownedProblems } from './sceneWriter'
import { presentCast } from './planShape'

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

/** The scene writer's repeats of recently used slang and gestures are sent back from this many (Q10; *tune*). */
export const SCENE_REPEAT_REWRITE = 3

export interface TurnOptions extends ResolveOptions {
  /** The turn's id; by default the scene's id and the turn's number. The app passes one unique across sessions. */
  turnId?: string
  /** The log session recording this turn, kept on the turn so flags made after a reload can name it. */
  log?: string
  /** The clock, in milliseconds; injected so tests can fix timings. */
  now?: () => number
  /** Lore budgets the player set in Settings, over the pack's; left out, the pack's apply (milestone 3, task 10). */
  loreBudgets?: LoreBudgetOverrides
  /** Which pipeline makes the turn (Milestone 5 plan, task 0b); `situation` when unset. */
  pipeline?: Pipeline
}

/**
 * One player turn (director writer §3): director → game resolves mechanics → streamed writer → code checks →
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
  // Checked here too, since the choice can come from outside the type system (a flag, a settings file).
  const pipeline = options.pipeline ?? DEFAULT_PIPELINE
  if (!isPipeline(pipeline)) throw new Error(`Unknown pipeline "${pipeline as string}"`)
  const calls: CallTrace[] = []
  const call = (role: CallTrace['role'], prompt: Prompt, run: Parameters<typeof traced>[4]) =>
    traced(calls, { id: `${turnId}:${role}`, role, turnId, sceneId: scene.id }, prompt, now, run)

  try {
    // Call 1: the director.
    const lore = turnLore(content, state, input, options.loreBudgets)
    const briefs = buildBriefs(content, state, input, lore)
    // The two pipelines differ in the director and the writer; everything between and after reads the same plan shape
    // (the scene plan through its view, Milestone 5 task 3).
    const scenePipeline = pipeline === 'scene'
    let directed: boolean
    let validated: { plan: BeatPlan; corrections: string[] }
    if (scenePipeline) {
      const gathered = gatherScene(content, state, input, lore, briefs)
      const directorPrompt = buildSceneDirectorPrompt(content, state, input, lore, briefs, gathered)
      const raw = parseScenePlan(await call('director', directorPrompt, () => llm.direct(directorPrompt)))
      const checked = raw ? validateScenePlan(content, state, raw, gathered, input) : { plan: sceneFallback(state, gathered), corrections: [] }
      directed = !!raw
      validated = { plan: sceneView(checked.plan), corrections: checked.corrections }
    } else {
      const directorPrompt = buildDirectorPrompt(content, state, input, lore, briefs)
      const raw = parsePlan(await call('director', directorPrompt, () => llm.direct(directorPrompt)))
      directed = !!raw
      validated = raw ? validatePlan(content, state, raw, input, lore) : { plan: fallbackPlan(content, state, input), corrections: [] }
    }
    const resolved = resolvePlan(content, state, validated.plan, options)
    const dice = resolved.dice
    const settled = settlePlan(content, state, resolved.plan)
    // The scene plan rides along; it takes the rolled checks and the reads the view settled.
    const plan: BeatPlan = settled.scene ? { ...settled, scene: { ...settled.scene, checks: settled.checks, ...(settled.reads && { reads: settled.reads }) } } : settled
    emit({ type: 'planned', speakers: plan.speakers.map((s) => s.id), checks: plan.checks.flatMap((c) => (c.line ? [c.line] : [])), corrections: validated.corrections, fallback: !directed })

    // Call 2: the writer, streamed.
    const speakers = sceneSpeakers(content, state)
    const writerPrompt = scenePipeline ? buildSceneWriterPrompt(content, state, plan, input) : buildWriterPrompt(content, state, plan, input)
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
    let parsed: ParsedReply = parseReply(draft, speakers, { script: scenePipeline })
    const recent = recentlyUsed(content, scene)
    // The scene writer: anyone present may speak, length is in words, repeats are sent back from the third (Q10), and someone saying what only
    // another knows is a problem (redesign §6.4).
    const check = (reply: ParsedReply) =>
      scenePipeline
        ? [...checkReply(reply, plan, speakers, input, content.phrases, { alsoSpeaking: presentCast(scene) }), ...repeatProblems(content, reply, recent, SCENE_REPEAT_REWRITE), ...loreProblems(content, state, reply), ...ownedProblems(content, state, reply)]
        : [...checkReply(reply, plan, speakers, input, content.phrases), ...repeatProblems(content, reply, recent), ...loreProblems(content, state, reply)]
    const problems = check(parsed)
    let remaining: Problem[] = []
    let kept = parsed.beats.map((_, i) => i)

    // Call 3, only if a check failed: one rewrite told exactly what to fix.
    if (problems.length > 0) {
      emit({ type: 'restart', reason: 'rewrite', problems: problems.map((p) => p.fix) })
      const rewrite = await stream('rewrite', buildRewritePrompt(writerPrompt, draft, problems.map((p) => p.fix)))
      parsed = parseReply(rewrite, speakers, { script: scenePipeline })
      remaining = check(parsed)
      kept = remaining.length > 0 ? salvaged(parsed.beats.length, remaining, !scenePipeline) : parsed.beats.map((_, i) => i)
      const spoken = new Set(remaining.filter((p) => p.kind === 'speech-in-narration').map((p) => p.beat! - 1))
      if (spoken.size > 0) {
        parsed = { ...parsed, beats: parsed.beats.map((b, i) => (spoken.has(i) ? { ...b, text: withoutSpeech(b.text) } : b)) }
        kept = kept.filter((i) => /\p{L}/u.test(parsed.beats[i]!.text))
      }
    }
    const accepted = acceptTags(content, plan, parsed.tags, parsed.beats, kept.map((i) => parsed.beats[i]!))
    const departures = showDepartures(content, plan, kept.map((i) => parsed.beats[i]!))
    const beats = departures.beats

    const next = applyTurn(content, state, { id: turnId, ...(options.log && { log: options.log }), input, plan, beats, tags: accepted.tags, dice, details: carryDetails(briefs.details, plan), memories: briefs.details.filter((d) => d.kind === 'memory').map((d) => d.id), secrets: activeSecrets(lore.secrets), topics: lore.layers.triggered.entries.map((e) => e.id), ...(plan.scene && { live: liveRecords(plan.scene) }) })
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
    for (const { id, beat } of departures.added) beatTraces.push({ index: beatTraces.length + 1, beat, source: 'game', line: 0, salvaged: false, plan: [`leaves:${id}`] })
    const directorCall = calls.find((c) => c.role === 'director')!
    const usage = calls.flatMap((c) => (c.meta?.usage ? [c.meta.usage] : []))
    const trace: TurnTrace = {
      turnId,
      sceneId: scene.id,
      turn: scene.turns.length + 1,
      at: new Date(started).toISOString(),
      input,
      cast: { before: castSnapshot(state), after: castSnapshot(next) },
      director: { callId: directorCall.id, read: !directed ? 'unreadable' : directorCall.meta?.jsonRetried ? 'json-retried' : 'json', plan, corrections: validated.corrections, pipeline },
      dice: { before: state.dice, after: dice },
      checks: checkTraces(plan),
      lore: loreTrace(lore),
      brief: briefs.trace,
      // Always set, even empty, so a log without it is known to be older than milestone 4d.
      shown: shownTraces(content, state, plan),
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
      tags: { parsed: parsed.tags, dropped: [...parsed.droppedTags, ...accepted.rejected] },
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
