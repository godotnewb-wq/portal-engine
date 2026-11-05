import { describe, expect, it } from 'vitest'
import { LlmProfileSchema } from '../../shared/settings'
import { chatCompletion, extraParameters, isRefusalResponse, listModels, RefusalError, streamCompletion } from './openai'

const profile = LlmProfileSchema.parse({ baseUrl: 'http://host/v1/', apiKey: 'sk-1', model: 'test-model', maxTokens: 50, instructions: 'Be brief.' })
const input = { system: 'You direct scenes.', messages: [{ role: 'user' as const, content: 'Hi' }] }

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as typeof fetch
  return { impl, calls }
}

/** An endpoint that streams the given pieces as server-sent events, split at awkward places. */
function streamingFetch(pieces: string[], finish = 'stop') {
  const events = [...pieces.map((content) => ({ choices: [{ delta: { content } }] })), { choices: [{ delta: {}, finish_reason: finish }] }]
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
  const impl = (async () => {
    const bytes = new TextEncoder().encode(text)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
        controller.close()
      }
    })
    return new Response(body, { status: 200 })
  }) as unknown as typeof fetch
  return impl
}

describe('chatCompletion', () => {
  it('posts to /chat/completions with the system prompt, instructions and profile settings', async () => {
    const { impl, calls } = fakeFetch(200, { choices: [{ message: { content: ' {"ok":true} ' } }] })
    const reply = await chatCompletion(profile, { ...input, json: true }, impl)
    expect(reply).toBe('{"ok":true}')
    expect(calls[0]!.url).toBe('http://host/v1/chat/completions')
    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.model).toBe('test-model')
    expect(body.max_tokens).toBe(50)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You direct scenes.\n\nBe brief.' })
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-1')
  })

  it('throws a RefusalError when a content filter stops the reply', async () => {
    const { impl } = fakeFetch(200, { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] })
    await expect(chatCompletion(profile, input, impl)).rejects.toBeInstanceOf(RefusalError)
  })

  it('throws a RefusalError for an empty reply that was not cut short', async () => {
    const { impl } = fakeFetch(200, { choices: [{ finish_reason: 'stop', message: { content: '' } }] })
    await expect(chatCompletion(profile, input, impl)).rejects.toBeInstanceOf(RefusalError)
  })

  it('reports an ordinary failure as an error, not a refusal', async () => {
    const { impl } = fakeFetch(500, 'boom')
    await expect(chatCompletion(profile, input, impl)).rejects.not.toBeInstanceOf(RefusalError)
  })
})

describe('streamCompletion', () => {
  it('passes each piece on as it arrives and returns the whole reply', async () => {
    const seen: string[] = []
    const reply = await streamCompletion(profile, input, (t) => seen.push(t), streamingFetch(['You step ', 'into the bar.', '\n[BEAT]']))
    expect(seen.join('')).toBe('You step into the bar.\n[BEAT]')
    expect(reply).toBe('You step into the bar.\n[BEAT]')
  })

  it('throws a RefusalError when the stream finishes on a content filter', async () => {
    await expect(streamCompletion(profile, input, () => {}, streamingFetch(['Partial'], 'content_filter'))).rejects.toBeInstanceOf(RefusalError)
  })
})

describe('isRefusalResponse', () => {
  it('tells a moderation block from a bad key', () => {
    expect(isRefusalResponse(400, '{"error":{"code":"content_policy_violation"}}')).toBe(true)
    expect(isRefusalResponse(403, 'Forbidden')).toBe(true)
    expect(isRefusalResponse(403, 'invalid api key')).toBe(false)
    expect(isRefusalResponse(500, 'moderation')).toBe(false)
  })
})

describe('extraParameters', () => {
  const at = (baseUrl: string, more: Record<string, unknown> = {}) => LlmProfileSchema.parse({ baseUrl, ...more })
  it('sends nothing extra at defaults, and reasoning the way each endpoint takes it', () => {
    expect(extraParameters(at('https://api.openai.com/v1'))).toEqual({})
    expect(extraParameters(at('https://api.openai.com/v1', { reasoning: 'low' }))).toEqual({ reasoning_effort: 'low' })
    expect(extraParameters(at('https://openrouter.ai/api/v1', { reasoning: 'off' }))).toEqual({ reasoning: { enabled: false } })
    expect(extraParameters(at('http://localhost:1234/v1', { reasoning: 'off' }))).toEqual({ chat_template_kwargs: { enable_thinking: false } })
  })
})

describe('listModels', () => {
  it('reads the OpenAI shape and a bare list, sorted and unique', async () => {
    expect(await listModels(profile, fakeFetch(200, { data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] }).impl)).toEqual(['a', 'b'])
    expect(await listModels(profile, fakeFetch(200, ['x']).impl)).toEqual(['x'])
  })
})

describe('response_format', () => {
  it('asks again without it when the endpoint turns it down', async () => {
    const bodies: Record<string, unknown>[] = []
    const impl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      bodies.push(body)
      return body.response_format
        ? new Response('{"error":"response_format is not supported"}', { status: 400 })
        : new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 })
    }) as typeof fetch
    expect(await chatCompletion(profile, { ...input, json: true }, impl)).toBe('{}')
    expect(bodies.map((b) => 'response_format' in b)).toEqual([true, false])
  })
})
