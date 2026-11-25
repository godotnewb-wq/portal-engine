import type { BenchLlm } from './run'

/**
 * A stand-in LLM for running the bench without a model: the director's reply is unreadable (so the game plans each
 * turn), and the writer voices whoever the plan says speaks, or, for the `scene` pipeline, whoever is in the moment. Each witness warms a little to the player, states no change
 * in what anyone is to them, and remembers one Normal moment about the player,
 * so a long multi-scene run has something to consolidate, and consolidation merges whatever it is given. Proves the
 * harness, not the prose.
 */
export function mockLlm(): BenchLlm {
  return {
    turn: {
      direct: async () => '(mock director: no plan)',
      write: async (prompt, onDelta) => {
        // The situation writer's brief lists "- Ada: in this exchange, …" under "# Who speaks"; the scene writer's lists
        // "- Ada: …" under "# What each person brings (…)". A heading is matched on its start.
        const section = (heading: string) => prompt.user.split(new RegExp(`^# ${heading}[^\\n]*\\n`, 'm'))[1]?.split('\n\n')[0] ?? ''
        const speakers = [...section('Who speaks').matchAll(/^- ([^:\s]+): in this exchange/gm), ...section('What each person brings').matchAll(/^- ([^:\s]+):/gm)].map((m) => m[1]!)
        const reply = ['NARRATION: The conduit buzzes overhead.', ...speakers.map((name) => `${name}: "Mock line from ${name}."`)].join('\n')
        onDelta(reply)
        return reply
      }
    },
    // The mock bookkeeper records nothing, so the harness runs the call and the records without a model.
    bookkeeper: { call: async () => JSON.stringify({ secrets: [], new: [], changed: '', moods: [], checks: [] }), waitMs: 30_000 },
    summarize: async (prompt) => {
      if (prompt.system.startsWith('You judge how one scene')) return JSON.stringify({ reason: '', approval: 'unchanged', trust: 'unchanged', interest: 'a little more', others: [], toward: [], resolved: [], ties: [] })
      if (prompt.system.startsWith('You merge')) {
        const who = prompt.user.match(/^(\S+)'s memories/)?.[1] ?? 'Someone'
        return JSON.stringify({ text: `${who} remembers ${prompt.user.split('\n').length - 1} mock scenes as one.` })
      }
      const who = prompt.user.match(/^About (\S+)/)?.[1] ?? 'Someone'
      return JSON.stringify({ memories: [{ text: `${who} remembers a mock scene.`, level: 'normal', why: '', about: ['player'] }], revisited: [] })
    }
  }
}
