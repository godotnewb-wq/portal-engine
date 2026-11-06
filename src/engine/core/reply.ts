import type { Prompt } from './prompt'

/**
 * What the platform knows about one LLM call and the engine can't see: which profile and model answered, its
 * settings, the tokens it used, and how the request had to be bent to get an answer. It goes into the turn trace as
 * it is; nothing in the game depends on it.
 */
export interface CallMeta {
  profile?: string
  model?: string
  temperature?: number
  /** Tokens, when the provider reports them. */
  usage?: { input?: number; output?: number }
  /** The endpoint turned down `response_format`, so the call was sent again without it. */
  jsonRetried?: boolean
  /** The first profile declined, and this is why; another profile wrote the reply. */
  declined?: string
}

/** A reply as the engine's LLM callers return it: the text, or the text with what the platform knows about the call. */
export type LlmReply = string | { text: string; meta?: CallMeta }

export const replyText = (reply: LlmReply): string => (typeof reply === 'string' ? reply : reply.text)
export const replyMeta = (reply: LlmReply): CallMeta | undefined => (typeof reply === 'string' ? undefined : reply.meta)

/** What each LLM call is for. `scorer` calls are made by the review tools, never during play. */
export type CallRole = 'director' | 'writer' | 'rewrite' | 'summary' | 'scorer'

/** One LLM call as the logs keep it: the full prompt, the raw reply, timing, and what the platform reported. */
export interface CallTrace {
  id: string
  role: CallRole
  /** The turn or scene the call belongs to. */
  turnId?: string
  sceneId?: string
  prompt: Prompt
  reply: string
  /** Milliseconds since the epoch. */
  startedAt: number
  ms: number
  /** Until the first streamed text arrived (streamed calls only). */
  firstTextMs?: number
  /** The streamed reply was thrown away and written again by another profile, after a refusal. */
  restarted?: boolean
  meta?: CallMeta
  error?: string
}

/** Hooks a streamed call uses to mark its first text and a restart on another profile. */
export interface CallHooks {
  first(): void
  restart(): void
}

/**
 * Runs one LLM call and records it in `calls`, failed or not. A failed call is recorded with its error and the error
 * is thrown on, so the caller still decides what a failure means.
 */
export async function traced(
  calls: CallTrace[],
  call: Pick<CallTrace, 'id' | 'role' | 'turnId' | 'sceneId'>,
  prompt: Prompt,
  now: () => number,
  run: (hooks: CallHooks) => Promise<LlmReply>
): Promise<string> {
  const startedAt = now()
  let firstTextMs: number | undefined
  let restarted = false
  const hooks: CallHooks = {
    first: () => {
      firstTextMs ??= now() - startedAt
    },
    restart: () => {
      restarted = true
      firstTextMs = undefined
    }
  }
  const timing = () => ({ startedAt, ms: now() - startedAt, ...(firstTextMs !== undefined && { firstTextMs }), ...(restarted && { restarted }) })
  try {
    const reply = await run(hooks)
    const meta = replyMeta(reply)
    calls.push({ ...call, prompt, reply: replyText(reply), ...timing(), ...(meta && { meta }) })
    return replyText(reply)
  } catch (error) {
    calls.push({ ...call, prompt, reply: '', ...timing(), error: (error as Error).message })
    throw error
  }
}

/** An error that carries the calls made before it, so a failed turn or scene end can still be logged. */
export class TracedError extends Error {
  constructor(
    message: string,
    readonly calls: CallTrace[]
  ) {
    super(message)
  }
}
