import type { Settings } from '@llm'
import { complete, stream, type CallInfo, type LlmRole, type RoutedReply } from '@llm'
import type { Summarize } from '@engine/relationships'
import type { TurnLlm } from '@engine/scene'
import type { CallMeta, Prompt } from '@engine/core'

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

/** A JSON call through a role's profile, with its metadata. */
async function judged(settings: Settings, role: LlmRole, nsfw: boolean, prompt: Prompt) {
  const { info, onInfo } = collector()
  const routed = await complete(settings, role, nsfw, { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], json: true, onInfo })
  return { text: routed.reply, meta: metaOf(settings, routed, info) }
}

/** The scene pipeline's calls through the configured profiles: the director asks for JSON, the writer streams. */
export function turnLlm(settings: Settings, nsfw: boolean): TurnLlm {
  return {
    direct: (prompt) => judged(settings, 'director', nsfw, prompt),
    async write(prompt, onDelta, onRestart) {
      const { info, onInfo } = collector()
      const routed = await stream(settings, 'writer', nsfw, { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], onInfo }, onDelta, onRestart)
      return { text: routed.reply, meta: metaOf(settings, routed, info) }
    }
  }
}

/** The end-of-scene summary call: low temperature, JSON. */
export function summaryLlm(settings: Settings, nsfw: boolean): Summarize {
  return (prompt) => judged(settings, 'summary', nsfw, prompt)
}

/** The AI scorer's call (milestone 2, A5): JSON, after play only. */
export function scorerLlm(settings: Settings): (prompt: Prompt) => Promise<{ text: string; meta: CallMeta }> {
  return (prompt) => judged(settings, 'scorer', false, prompt)
}
