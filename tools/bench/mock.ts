import type { BenchLlm } from './run'

/**
 * A stand-in LLM for running the bench without a model: the director's reply is unreadable (so the game plans each
 * turn), and the writer voices whoever the plan says speaks. Each witness remembers one Normal moment about the player,
 * so a long multi-scene run has something to consolidate, and consolidation merges whatever it is given. Proves the
 * harness, not the prose.
 */
export function mockLlm(): BenchLlm {
  return {
    turn: {
      direct: async () => '(mock director: no plan)',
      write: async (prompt, onDelta) => {
        // The writer's brief lists "- Ada: in this exchange, …" under "# Who speaks".
        const who = prompt.user.split('# Who speaks\n')[1]?.split('\n\n')[0] ?? ''
        const speakers = [...who.matchAll(/^- ([^:\s]+): in this exchange/gm)].map((m) => m[1]!)
        const reply = ['NARRATION: The conduit buzzes overhead.', ...speakers.map((name) => `${name}: "Mock line from ${name}."`)].join('\n')
        onDelta(reply)
        return reply
      }
    },
    summarize: async (prompt) => {
      if (prompt.system.startsWith('You merge')) {
        const who = prompt.user.match(/^(\S+)'s memories/)?.[1] ?? 'Someone'
        return JSON.stringify({ text: `${who} remembers ${prompt.user.split('\n').length - 1} mock scenes as one.` })
      }
      const who = prompt.user.match(/^About (\S+)/)?.[1] ?? 'Someone'
      return JSON.stringify({ memories: [{ text: `${who} remembers a mock scene.`, level: 'normal', why: '', about: ['player'] }], revisited: [], approval: 'unchanged', trust: 'unchanged', interest: 'a little more' })
    }
  }
}
