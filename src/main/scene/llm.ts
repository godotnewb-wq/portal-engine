import type { Settings } from '../../shared/settings'
import { complete, stream } from '../ai/router'
import type { Summarize } from './endScene'
import type { TurnLlm } from './runTurn'

/** The scene pipeline's calls through the configured profiles: the director asks for JSON, the writer streams. */
export function turnLlm(settings: Settings, nsfw: boolean): TurnLlm {
  return {
    async direct(prompt) {
      const { reply } = await complete(settings, 'director', nsfw, { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], json: true })
      return reply
    },
    async write(prompt, onDelta, onRestart) {
      const { reply } = await stream(settings, 'writer', nsfw, { system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }, onDelta, onRestart)
      return reply
    }
  }
}

/** The end-of-scene summary call: low temperature, JSON. */
export function summaryLlm(settings: Settings, nsfw: boolean): Summarize {
  return async (prompt) => {
    const { reply } = await complete(settings, 'summary', nsfw, { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], json: true })
    return reply
  }
}
