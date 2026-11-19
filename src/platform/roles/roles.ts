import type { Settings } from '@llm'
import { complete, profileFor, stream, type CallInfo, type LlmRole, type RoutedReply } from '@llm'
import type { Summarize } from '@engine/relationships'
import { bookkeep, planBookkeeping, type BookkeeperTrace, type TurnLlm } from '@engine/scene'
import type { Pack } from '@engine/pack'
import type { Bookkeeping, GameState } from '@engine/state'
import type { CallMeta, LlmReply, Prompt } from '@engine/core'

/** Gathers what the LLM client reports during a call, to hand to the engine with the reply. */
function collector() {
  const info: CallInfo = {}
  const onInfo = (more: CallInfo) => {
    if (more.usage) info.usage = more.usage
    if (more.jsonRetried) info.jsonRetried = true
  }
  return { info, onInfo }
}

/** The call's metadata for the turn trace: which profile and model answered, never the key or headers. */
function metaOf(settings: Settings, routed: RoutedReply, info: CallInfo): CallMeta {
  const profile = settings[routed.profileId]
  return {
    profile: routed.profileId,
    model: profile.model,
    temperature: profile.temperature,
    ...(info.usage && { usage: info.usage }),
    ...(info.jsonRetried && { jsonRetried: true }),
    ...(routed.declined && { declined: routed.declined })
  }
}

/**
 * The fewest reply tokens a JSON call gets, whatever its profile says. With three speakers a director plan runs to
 * about a thousand tokens, and a profile left at the old default cut a fifth of them off mid-JSON (bench 2026-11-08,
 * `lines`); a thinking model spends part of the limit reasoning before it answers, so it needs room for both
 * (session 2026-11-07_1955_cdd1: plans and summaries cut off at 2000 and 800).
 */
export const DIRECTOR_MIN_TOKENS = 4000
export const SUMMARY_MIN_TOKENS = 2000
export const SCORER_MIN_TOKENS = 3000
export const BOOKKEEPER_MIN_TOKENS = 1500

/** A JSON call through a role's profile, with its metadata. `minTokens` raises the profile's reply limit if it is lower. */
async function judged(settings: Settings, role: LlmRole, prompt: Prompt, minTokens?: number) {
  const { info, onInfo } = collector()
  const maxTokens = minTokens ? Math.max(settings[role].maxTokens, minTokens) : undefined
  const routed = await complete(settings, role, { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], json: true, onInfo, ...(maxTokens && { maxTokens }) })
  return { text: routed.reply, meta: metaOf(settings, routed, info) }
}

/** The scene pipeline's calls through the configured profiles: the director asks for JSON, the writer streams. */
export function turnLlm(settings: Settings): TurnLlm {
  return {
    direct: (prompt) => judged(settings, 'director', prompt, DIRECTOR_MIN_TOKENS),
    async write(prompt, onDelta, onRestart) {
      const { info, onInfo } = collector()
      const routed = await stream(settings, 'writer', { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], onInfo }, onDelta, onRestart)
      return { text: routed.reply, meta: metaOf(settings, routed, info) }
    }
  }
}

/**
 * The bookkeeper's call after each turn (milestone 4c): JSON, through its own profile, else the summary's, else the
 * writer's.
 */
export function bookkeeperLlm(settings: Settings): (prompt: Prompt) => Promise<{ text: string; meta: CallMeta }> {
  return (prompt) => judged(settings, 'bookkeeper', prompt, BOOKKEEPER_MIN_TOKENS)
}

/**
 * How long the next turn, the scene's end or a save waits for a turn's bookkeeper (milestone 4c, decided 2026-11-18,
 * user, decision A): the timeout of the profile that answers it, its own when set (30 seconds by default), else the
 * borrowed profile's own. Past it the call has timed out anyway, so the turn keeps its plan-based records.
 */
export const bookkeeperWaitMs = (settings: Settings): number => settings[profileFor(settings, 'bookkeeper')].timeoutSeconds * 1000

/** The end-of-scene calls (a witness's relationship call and memory call) and consolidation: low temperature, JSON. */
export function summaryLlm(settings: Settings): Summarize {
  return (prompt) => judged(settings, 'summary', prompt, SUMMARY_MIN_TOKENS)
}

/** The AI scorer's call (milestone 2, A5): JSON, after play only. */
export function scorerLlm(settings: Settings): (prompt: Prompt) => Promise<{ text: string; meta: CallMeta }> {
  return (prompt) => judged(settings, 'scorer', prompt, SCORER_MIN_TOKENS)
}

/**
 * Runs a turn's bookkeeper and gives up past `waitMs` from when it started (milestone 4c, decisions A, B and I):
 * then the turn keeps the plan's records, the trace says it was late, and a reply that comes after is discarded. The
 * app starts this as soon as a turn is shown and awaits it before the next turn, the scene's end or a save; the bench
 * awaits it at once, so a slow provider falls back there exactly as in play.
 */
export async function bookkeepWithin(
  content: Pack,
  before: GameState,
  written: Parameters<typeof bookkeep>[2],
  call: (prompt: Prompt) => Promise<LlmReply>,
  waitMs: number,
  now: () => number = Date.now
): Promise<{ records: Bookkeeping; trace: BookkeeperTrace; late: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), waitMs)
  })
  const done = await Promise.race([bookkeep(content, before, written, call, now), late])
  clearTimeout(timer)
  if (done !== 'late') return { ...done, late: false }
  const records = planBookkeeping(content, before, written)
  return { records, trace: { turnId: written.id, at: new Date(now()).toISOString(), calls: [], records, error: `no answer within ${Math.round(waitMs / 1000)} seconds` }, late: true }
}
