// Adapted from Breedhaven University, src/main/ai/router.ts (GPL-3.0-only). See NOTICE.md.
// Changes: routes by role (director / writer / summary), and covers streamed replies too.

import { looksLikeRefusal } from './refusal'
import { isConfigured, profileFor, type LlmProfileId, type LlmRole, type Settings } from './settings'
import { chatCompletion, RefusalError, streamCompletion, type CompletionInput } from './openai'

export const NOT_CONFIGURED = 'No LLM is set up yet. Add an endpoint and model in Settings.'

export interface RoutedReply {
  reply: string
  /** Which profile produced the reply. */
  profileId: LlmProfileId
}

// What a model thought to itself before answering is not the answer: a refusal is looked for in what comes after it.
const THINKING = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi

export const stripThinking = (reply: string): string => reply.replace(THINKING, '').replace(/^[\s\S]*<\/think(?:ing)?>/i, '').trim()

type Attempt = { reply: string } | { declined: string }

async function attempt(run: () => Promise<string>): Promise<Attempt> {
  try {
    const reply = await run()
    const said = stripThinking(reply)
    return looksLikeRefusal(said) ? { declined: `it answered "${said.slice(0, 120)}"` } : { reply }
  } catch (error) {
    if (error instanceof RefusalError) return { declined: error.message }
    throw error
  }
}

/** Tries the role's profile, then the NSFW profile if the first declined. */
async function routed(settings: Settings, role: LlmRole, nsfw: boolean, run: (id: LlmProfileId) => Promise<string>): Promise<RoutedReply> {
  const first = profileFor(settings, role, nsfw)
  if (!isConfigured(settings[first])) throw new Error(NOT_CONFIGURED)
  const tried = await attempt(() => run(first))
  if ('reply' in tried) return { reply: tried.reply, profileId: first }
  if (first === 'nsfw' || !isConfigured(settings.nsfw)) throw new Error(`The LLM declined to write this (${tried.declined}).`)
  const second = await attempt(() => run('nsfw'))
  if ('declined' in second) throw new Error(`Both LLMs declined: ${tried.declined}; ${second.declined}.`)
  return { reply: second.reply, profileId: 'nsfw' }
}

export function complete(
  settings: Settings,
  role: LlmRole,
  nsfw: boolean,
  input: CompletionInput,
  impl: typeof chatCompletion = chatCompletion
): Promise<RoutedReply> {
  return routed(settings, role, nsfw, (id) => impl(settings[id], input))
}

/**
 * Streams through the role's profile. If it declines, the NSFW profile writes the reply; `onRestart` lets the
 * caller clear what was already shown before the second reply streams in.
 */
export function stream(
  settings: Settings,
  role: LlmRole,
  nsfw: boolean,
  input: Omit<CompletionInput, 'tools'>,
  onDelta: (text: string) => void,
  onRestart: () => void,
  impl: typeof streamCompletion = streamCompletion
): Promise<RoutedReply> {
  let started = false
  return routed(settings, role, nsfw, (id) => {
    if (started) onRestart()
    started = true
    return impl(settings[id], input, onDelta)
  })
}
