// Adapted from Breedhaven University, src/shared/settings.ts (GPL-3.0-only). See NOTICE.md.
// Breedhaven had one main and one NSFW profile; this game has a profile per role in the scene pipeline.

import { z } from 'zod'

/**
 * The jobs an LLM does. `director` plans each turn (fast, JSON), `writer` writes the beats (strong, streamed),
 * `summary` writes memories after a scene (low temperature), `scorer` rates logged turns after play (never during a
 * turn), `nsfw` takes over any of them when its own declines.
 */
export const LLM_PROFILE_IDS = ['director', 'writer', 'summary', 'scorer', 'nsfw'] as const
export type LlmProfileId = (typeof LLM_PROFILE_IDS)[number]
export type LlmRole = Exclude<LlmProfileId, 'nsfw'>

export const LLM_DEFAULT_TIMEOUT_SECONDS = 120
export const LLM_MIN_TIMEOUT_SECONDS = 10
export const LLM_MAX_TIMEOUT_SECONDS = 1800

export const REASONING_LEVELS = ['default', 'off', 'minimal', 'low', 'medium', 'high'] as const
export type ReasoningLevel = (typeof REASONING_LEVELS)[number]
/**
 * `effort` is OpenAI's `reasoning_effort`, which most hosted endpoints copy; `openrouter` is OpenRouter's `reasoning`;
 * `template` switches thinking on or off in a local model's chat template (`enable_thinking`). `auto` goes by the address.
 */
export const REASONING_STYLES = ['auto', 'effort', 'openrouter', 'template'] as const
export type ReasoningStyle = (typeof REASONING_STYLES)[number]

/** Connection to one OpenAI-compatible chat completions endpoint. */
export const LlmProfileSchema = z.object({
  /** Up to but not including `/chat/completions`, e.g. `https://api.openai.com/v1`. */
  baseUrl: z.string().default(''),
  apiKey: z.string().default(''),
  model: z.string().default(''),
  temperature: z.number().min(0).max(2).default(0.8),
  maxTokens: z.number().int().min(1).default(1024),
  timeoutSeconds: z.number().int().min(LLM_MIN_TIMEOUT_SECONDS).max(LLM_MAX_TIMEOUT_SECONDS).default(LLM_DEFAULT_TIMEOUT_SECONDS),
  /** Appended to every system prompt sent through this profile. */
  instructions: z.string().default(''),
  reasoning: z.enum(REASONING_LEVELS).default('default'),
  reasoningStyle: z.enum(REASONING_STYLES).default('auto'),
  // Samplers. One left out is not sent, and the model's own is used: not every endpoint takes every one.
  topP: z.number().min(0).max(1).optional(),
  minP: z.number().min(0).max(1).optional(),
  topK: z.number().int().min(0).optional(),
  repetitionPenalty: z.number().min(0).max(3).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  /** OpenRouter: the providers to try first, in order, comma-separated. */
  providerOrder: z.string().default(''),
  /** OpenRouter: providers never to use, comma-separated. */
  providerIgnore: z.string().default(''),
  /** OpenRouter: whether another provider may answer when those named cannot. */
  allowFallbacks: z.boolean().default(true),
  /** The most requests sent to its address at once; the rest wait their turn. Left out, there is no limit. */
  maxConcurrent: z.number().int().min(1).optional()
})
export type LlmProfile = z.infer<typeof LlmProfileSchema>

/** Starting temperatures per role: the director and summaries judge, the writer writes. */
const ROLE_DEFAULTS: Record<LlmProfileId, Partial<LlmProfile>> = {
  director: { temperature: 0.3, maxTokens: 1200 },
  writer: { temperature: 0.9, maxTokens: 1200 },
  summary: { temperature: 0.2, maxTokens: 800 },
  scorer: { temperature: 0.2, maxTokens: 1500 },
  nsfw: { temperature: 0.9, maxTokens: 1200 }
}

export const SettingsSchema = z.object({
  director: LlmProfileSchema.prefault(ROLE_DEFAULTS.director),
  writer: LlmProfileSchema.prefault(ROLE_DEFAULTS.writer),
  summary: LlmProfileSchema.prefault(ROLE_DEFAULTS.summary),
  scorer: LlmProfileSchema.prefault(ROLE_DEFAULTS.scorer),
  nsfw: LlmProfileSchema.prefault(ROLE_DEFAULTS.nsfw)
})
export type Settings = z.infer<typeof SettingsSchema>

// API keys never leave the main process. The renderer sees only whether one is saved,
// and sends a key back only when the user types a new one.

export type LlmProfileView = Omit<LlmProfile, 'apiKey'> & { hasApiKey: boolean }
export type SettingsView = Record<LlmProfileId, LlmProfileView>

export const LlmProfileUpdateSchema = LlmProfileSchema.omit({ apiKey: true }).extend({
  /** Omitted keeps the saved key; an empty string clears it. */
  apiKey: z.string().optional()
})
export const SettingsUpdateSchema = z.object({
  director: LlmProfileUpdateSchema,
  writer: LlmProfileUpdateSchema,
  summary: LlmProfileUpdateSchema,
  scorer: LlmProfileUpdateSchema,
  nsfw: LlmProfileUpdateSchema
})
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>

/** A request for the models an endpoint offers, using what is in the settings form right now. */
export const ListModelsRequestSchema = z.object({
  profileId: z.enum(LLM_PROFILE_IDS),
  baseUrl: z.string(),
  /** A key just typed into the form. Omitted means use the saved one. */
  apiKey: z.string().optional()
})
export type ListModelsRequest = z.infer<typeof ListModelsRequestSchema>

export interface ListModelsResponse {
  models: string[]
  error?: string
}

export function toView(settings: Settings): SettingsView {
  const view = ({ apiKey, ...rest }: LlmProfile): LlmProfileView => ({ ...rest, hasApiKey: apiKey.length > 0 })
  return {
    director: view(settings.director),
    writer: view(settings.writer),
    summary: view(settings.summary),
    scorer: view(settings.scorer),
    nsfw: view(settings.nsfw)
  }
}

/** A key is not required: local servers such as LM Studio and Ollama don't use one. */
export function isConfigured(profile: { baseUrl: string; model: string }): boolean {
  return profile.baseUrl.trim().length > 0 && profile.model.trim().length > 0
}

/**
 * The profile a role is sent to. A role left unset borrows the writer's, so one endpoint is enough to play; the
 * scorer, a judge like the summaries, borrows the summary profile first. An NSFW scene goes to the NSFW profile
 * first when it is set up.
 */
export function profileFor(
  settings: Record<LlmProfileId, { baseUrl: string; model: string }>,
  role: LlmRole,
  nsfw: boolean
): LlmProfileId {
  if (nsfw && isConfigured(settings.nsfw)) return 'nsfw'
  if (isConfigured(settings[role])) return role
  if (role === 'scorer' && isConfigured(settings.summary)) return 'summary'
  return 'writer'
}
