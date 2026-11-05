import { describe, expect, it } from 'vitest'
import { SettingsSchema, profileFor } from '../../shared/settings'
import { RefusalError } from './openai'
import { complete, NOT_CONFIGURED, stream } from './router'

const at = (model: string) => ({ baseUrl: 'http://host/v1', model })

describe('profileFor', () => {
  it('uses the role when set, borrows the writer otherwise, and prefers NSFW for NSFW scenes', () => {
    const settings = SettingsSchema.parse({ director: at('fast'), writer: at('strong'), nsfw: at('open') })
    expect(profileFor(settings, 'director', false)).toBe('director')
    expect(profileFor(settings, 'summary', false)).toBe('writer')
    expect(profileFor(settings, 'director', true)).toBe('nsfw')
  })
})

describe('complete', () => {
  it('fails plainly when nothing is set up', async () => {
    await expect(complete(SettingsSchema.parse({}), 'director', false, { system: '', messages: [] })).rejects.toThrow(NOT_CONFIGURED)
  })

  it('hands a declined request to the NSFW profile', async () => {
    const settings = SettingsSchema.parse({ writer: at('strong'), nsfw: at('open') })
    const used: string[] = []
    const reply = await complete(settings, 'writer', false, { system: '', messages: [] }, async (profile) => {
      used.push(profile.model)
      if (profile.model === 'strong') throw new RefusalError('content_filter')
      return 'ok'
    })
    expect(reply).toEqual({ reply: 'ok', profileId: 'nsfw' })
    expect(used).toEqual(['strong', 'open'])
  })

  it('treats a plain-text refusal as declining', async () => {
    const settings = SettingsSchema.parse({ writer: at('strong'), nsfw: at('open') })
    const reply = await complete(settings, 'writer', false, { system: '', messages: [] }, async (profile) =>
      profile.model === 'strong' ? "I'm sorry, but I can't continue this." : 'You lean in.'
    )
    expect(reply.profileId).toBe('nsfw')
  })
})

describe('stream', () => {
  it('tells the caller to clear what was shown before the fallback streams', async () => {
    const settings = SettingsSchema.parse({ writer: at('strong'), nsfw: at('open') })
    let shown = ''
    const result = await stream(settings, 'writer', false, { system: '', messages: [] }, (t) => (shown += t), () => (shown = ''), async (profile, _input, onDelta) => {
      onDelta(profile.model)
      if (profile.model === 'strong') throw new RefusalError('safety')
      return 'open'
    })
    expect(result.profileId).toBe('nsfw')
    expect(shown).toBe('open')
  })
})
