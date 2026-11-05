// Adapted from Breedhaven University, src/main/ai/openai.ts (GPL-3.0-only). See NOTICE.md.
// Changes: messages are plain English rather than i18n keys; `streamCompletion` added for the scene writer.

import type { LlmProfile, ReasoningStyle } from '../../shared/settings'
import { inTurn } from './queue'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CompletionInput {
  system: string
  messages: ChatMessage[]
  /** Overrides the profile's temperature for this call. */
  temperature?: number
  /** Overrides the profile's max reply tokens for this call. */
  maxTokens?: number
  /** Gives up on a request after this long, instead of after the profile's timeout. */
  timeoutMs?: number
  /** Asks for a JSON object back, on endpoints that support `response_format`. */
  json?: boolean
  /** Things the model may do before it answers. */
  tools?: LlmTool[]
  /** Stops the call when the player gives up on it. It then fails with this signal's reason. */
  signal?: AbortSignal
}

/** A function the model can call mid-reply. Its result goes back to the model, which then answers. */
export interface LlmTool {
  name: string
  description: string
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>
  run(args: Record<string, unknown>): string | Promise<string>
}

// How many times in one reply the model may call tools before it must answer in words.
const MAX_TOOL_ROUNDS = 2
const LIST_TIMEOUT_MS = 15_000

const endpoint = (baseUrl: string, path: string): string => `${baseUrl.trim().replace(/\/+$/, '')}${path}`

function unreachable(url: string, error: unknown): Error {
  const cause = (error as { cause?: Error }).cause
  return new Error(`Could not reach ${url}: ${cause?.message ?? (error as Error).message}`)
}

/** Asks an OpenAI-compatible endpoint which models it offers, via `GET /models`. */
export async function listModels(
  connection: Pick<LlmProfile, 'baseUrl' | 'apiKey'>,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  const url = endpoint(connection.baseUrl, '/models')
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {},
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS)
    })
  } catch (error) {
    throw unreachable(url, error)
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200)
    throw new Error(`Listing models failed: ${response.status} ${response.statusText} ${body}`.trim())
  }

  // OpenAI answers { data: [{ id }] }; some servers answer { models: [...] } or a bare list.
  const body = (await response.json()) as unknown
  const list = Array.isArray(body)
    ? body
    : ((body as { data?: unknown; models?: unknown }).data ?? (body as { models?: unknown }).models)
  if (!Array.isArray(list)) throw new Error('The endpoint did not return a list of models.')
  const ids = list
    .map((m) => (typeof m === 'string' ? m : (m as { id?: unknown; name?: unknown }).id ?? (m as { name?: unknown }).name))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

// How an endpoint says it will not write what was asked. Each provider has its own way, so each is looked for by name.
const REFUSAL_STATUSES = [403, 451]
// ...unless what it says is that the key, the account or the region is the trouble, which no other LLM's being asked would mend.
const NOT_A_REFUSAL = /api[ _-]?key|unauthori[sz]ed|authenticat|permission|not allowed to access|quota|billing|credit|balance|region|country|rate[ _-]?limit/i
const REFUSAL_CODES =
  /moderation|content[ _-]?(?:policy|filter|management)|policy[ _-]?violation|responsibleai|data_inspection_failed|sensitive|safety|unsafe|flagged|prohibited|blocklist|\b1301\b|敏感|不安全/i
const REFUSAL_FINISHES = ['content_filter', 'sensitive', 'safety', 'prohibited_content', 'blocklist', 'refusal', 'recitation', 'spii']

/** Whether a failed request was the endpoint declining what was asked, as against something wrong with the request or account. */
export function isRefusalResponse(status: number, body: string): boolean {
  if (status < 400 || status >= 500) return false
  if (REFUSAL_CODES.test(body)) return true
  return REFUSAL_STATUSES.includes(status) && !NOT_A_REFUSAL.test(body)
}

/** The endpoint declined to produce the reply: a content filter, moderation block or refusal. */
export class RefusalError extends Error {
  constructor(detail: string) {
    super(`The LLM declined: ${detail}`)
    this.name = 'RefusalError'
  }
}

/** Which way of asking for less or more thinking an endpoint takes, going by its address when the profile does not say. */
export function reasoningStyleOf(profile: Pick<LlmProfile, 'baseUrl' | 'reasoningStyle'>): Exclude<ReasoningStyle, 'auto'> {
  if (profile.reasoningStyle !== 'auto') return profile.reasoningStyle
  let host = ''
  try {
    host = new URL(profile.baseUrl.trim()).hostname
  } catch {
    // An address that does not read is asked the common way.
  }
  if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) return 'openrouter'
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(host) || host.endsWith('.local')) return 'template'
  return 'effort'
}

/** The profile's power-user settings, as the fields of a request. Whatever is left at its default is not sent. */
export function extraParameters(profile: LlmProfile): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  const samplers = { top_p: profile.topP, min_p: profile.minP, top_k: profile.topK, repetition_penalty: profile.repetitionPenalty, frequency_penalty: profile.frequencyPenalty, presence_penalty: profile.presencePenalty }
  for (const [name, value] of Object.entries(samplers)) if (value !== undefined) extra[name] = value
  if (profile.reasoning !== 'default') {
    const off = profile.reasoning === 'off'
    const style = reasoningStyleOf(profile)
    if (style === 'openrouter') extra['reasoning'] = off ? { enabled: false } : { effort: profile.reasoning }
    else if (style === 'template') extra['chat_template_kwargs'] = { enable_thinking: !off }
    else extra['reasoning_effort'] = off ? 'none' : profile.reasoning
  }
  const list = (text: string) => text.split(',').map((one) => one.trim()).filter((one) => one.length > 0)
  const order = list(profile.providerOrder)
  const ignore = list(profile.providerIgnore)
  if (order.length > 0 || ignore.length > 0 || !profile.allowFallbacks) {
    extra['provider'] = { ...(order.length > 0 && { order }), ...(ignore.length > 0 && { ignore }), ...(!profile.allowFallbacks && { allow_fallbacks: false }) }
  }
  return extra
}

function requestBody(profile: LlmProfile, input: CompletionInput, messages: unknown[], extra: Record<string, unknown>): string {
  return JSON.stringify({
    ...extraParameters(profile),
    model: profile.model,
    messages,
    temperature: input.temperature ?? profile.temperature,
    max_tokens: input.maxTokens ?? profile.maxTokens,
    ...(input.json && { response_format: { type: 'json_object' } }),
    ...extra
  })
}

const systemOf = (profile: LlmProfile, input: CompletionInput): string =>
  [input.system, profile.instructions].filter((s) => s.length > 0).join('\n\n')

function headersOf(profile: LlmProfile): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(profile.apiKey && { Authorization: `Bearer ${profile.apiKey}` }) }
}

const signalOf = (profile: LlmProfile, input: CompletionInput): AbortSignal =>
  AbortSignal.any([AbortSignal.timeout(input.timeoutMs ?? profile.timeoutSeconds * 1000), ...(input.signal ? [input.signal] : [])])

async function failure(response: Response): Promise<Error> {
  const body = (await response.text()).slice(0, 300)
  if (isRefusalResponse(response.status, body)) return new RefusalError(`${response.status} ${response.statusText}: ${body}`.trim())
  return new Error(`The LLM request failed: ${response.status} ${response.statusText} ${body}`.trim())
}

function fetchFailure(input: CompletionInput, url: string, error: unknown): unknown {
  if (input.signal?.aborted) return input.signal.reason
  if ((error as Error).name === 'TimeoutError') return new Error('The LLM took too long to answer.')
  return unreachable(url, error)
}

/** Calls an OpenAI-compatible `/chat/completions` endpoint and returns the reply text. */
export async function chatCompletion(
  profile: LlmProfile,
  input: CompletionInput,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const url = endpoint(profile.baseUrl, '/chat/completions')
  // Grows as tools are called: the model's requests and their results are appended.
  const messages: unknown[] = [{ role: 'system', content: systemOf(profile, input) }, ...input.messages]
  let tools = input.tools && input.tools.length > 0 ? input.tools : undefined

  const request = (): Promise<AssistantMessage> => inTurn(url, profile.maxConcurrent, input.signal, send)
  async function send(): Promise<AssistantMessage> {
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: headersOf(profile),
        body: requestBody(profile, input, messages, tools ? {
          tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
        } : {}),
        signal: signalOf(profile, input)
      })
    } catch (error) {
      throw fetchFailure(input, url, error)
    }

    if (!response.ok) {
      const error = await failure(response)
      // Not every endpoint or model accepts tools. Carry on without them rather than fail.
      if (!(error instanceof RefusalError) && tools && response.status < 500 && /tool|function/i.test(error.message)) {
        tools = undefined
        return send()
      }
      throw error
    }

    const data = (await response.json()) as { choices?: { finish_reason?: unknown; native_finish_reason?: unknown; message?: AssistantMessage }[] }
    const choice = data.choices?.[0]
    const finishes = [choice?.finish_reason, choice?.native_finish_reason].filter((reason): reason is string => typeof reason === 'string').map((reason) => reason.toLowerCase())
    const stopped = finishes.find((reason) => REFUSAL_FINISHES.includes(reason))
    if (stopped) throw new RefusalError(`the reply was stopped (${stopped})`)
    if (typeof choice?.message?.refusal === 'string' && choice.message.refusal.length > 0) {
      throw new RefusalError(choice.message.refusal)
    }
    // Nothing at all, and not for want of room: that is how some providers answer what they will not write.
    const said = typeof choice?.message?.content === 'string' && choice.message.content.trim().length > 0
    if (!said && (choice?.message?.tool_calls ?? []).length === 0 && !finishes.includes('length')) {
      throw new RefusalError('the endpoint returned an empty reply')
    }
    return choice?.message ?? {}
  }

  for (let round = 0; ; round++) {
    input.signal?.throwIfAborted()
    const message = await request()
    const calls = message.tool_calls ?? []
    if (!tools || calls.length === 0) {
      if (typeof message.content !== 'string' || message.content.trim().length === 0) {
        throw new Error('The LLM returned an empty reply.')
      }
      return message.content.trim()
    }

    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls })
    for (const [n, call] of calls.entries()) {
      const result = await runTool(tools, call)
      messages.push({ role: 'tool', tool_call_id: call.id, content: n === calls.length - 1 ? `${result}\n\n${AFTER_TOOL}` : result })
    }
    if (round + 1 >= MAX_TOOL_ROUNDS) tools = undefined
  }
}

// Said to the model after its tools have run, so that what comes next is the reply itself.
export const AFTER_TOOL = 'Now write your reply.'

interface ToolCall {
  id: string
  function: { name: string; arguments?: string }
}

interface AssistantMessage {
  content?: unknown
  refusal?: unknown
  tool_calls?: ToolCall[]
}

/** Runs the tool a call names. Problems are reported back to the model, not thrown. */
async function runTool(tools: LlmTool[], call: ToolCall): Promise<string> {
  const tool = tools.find((one) => one.name === call.function.name)
  if (!tool) return `There is no tool called ${call.function.name}.`
  try {
    const args: unknown = JSON.parse(call.function.arguments || '{}')
    return await tool.run(typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {})
  } catch (error) {
    return `The tool failed: ${(error as Error).message}`
  }
}

/**
 * Streams a reply from `/chat/completions` (server-sent events), calling `onDelta` with each piece of text as it
 * arrives, and returns the whole reply. Used by the scene writer so the first beat shows almost at once. No tools.
 */
export async function streamCompletion(
  profile: LlmProfile,
  input: Omit<CompletionInput, 'tools'>,
  onDelta: (text: string) => void,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const url = endpoint(profile.baseUrl, '/chat/completions')
  const messages = [{ role: 'system', content: systemOf(profile, input) }, ...input.messages]
  return inTurn(url, profile.maxConcurrent, input.signal, async () => {
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: headersOf(profile),
        body: requestBody(profile, input, messages, { stream: true }),
        signal: signalOf(profile, input)
      })
    } catch (error) {
      throw fetchFailure(input, url, error)
    }
    if (!response.ok) throw await failure(response)
    if (!response.body) throw new Error('The endpoint did not stream a reply.')

    let whole = ''
    let pending = ''
    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    const handle = (line: string): void => {
      const data = line.replace(/^data:\s?/, '').trim()
      if (!line.startsWith('data:') || data === '' || data === '[DONE]') return
      let chunk: { choices?: { delta?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[] }
      try {
        chunk = JSON.parse(data)
      } catch {
        return
      }
      const choice = chunk.choices?.[0]
      const finish = typeof choice?.finish_reason === 'string' ? choice.finish_reason.toLowerCase() : undefined
      if (finish && REFUSAL_FINISHES.includes(finish)) throw new RefusalError(`the reply was stopped (${finish})`)
      if (typeof choice?.delta?.refusal === 'string' && choice.delta.refusal.length > 0) throw new RefusalError(choice.delta.refusal)
      const text = choice?.delta?.content
      if (typeof text === 'string' && text.length > 0) {
        whole += text
        onDelta(text)
      }
    }
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ''
        for (const line of lines) handle(line)
      }
      pending += decoder.decode()
      if (pending.length > 0) handle(pending)
    } catch (error) {
      if (error instanceof RefusalError) throw error
      throw fetchFailure(input, url, error)
    }
    if (whole.trim().length === 0) throw new RefusalError('the endpoint returned an empty reply')
    return whole.trim()
  })
}
