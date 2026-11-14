import type { GameState, Memory } from '@engine/state'

/**
 * Secrets learned in play (milestone 4b; decided 2026-11-13): a secret stays its holder's; someone who learns it keeps a
 * memory of learning it, which carries the secret's fact id and, for a linked secret, the codex pointer. The memory
 * grants the knowledge while it is in the save, whether or not it is still recalled.
 */

/** The learned secrets a memory carries: its own, and those a consolidated memory took over from its originals. */
export const pointersOf = (m: Memory): { secret: string; codex?: string }[] => [...(m.secret ? [{ secret: m.secret, ...(m.codex && { codex: m.codex }) }] : []), ...(m.inherited ?? [])]

/** Their memories of learning someone else's secret, a consolidated memory carrying one included. */
export const learnedMemories = (state: GameState, who: string): Memory[] => state.memories.filter((m) => m.owner === who && pointersOf(m).length > 0)

/** The secrets a character learned, each once, with its codex pointer when linked. */
export function learnedSecrets(state: GameState, who: string): { secret: string; codex?: string }[] {
  const all = learnedMemories(state, who).flatMap(pointersOf)
  return [...new Map(all.map((p) => [p.secret, p])).values()]
}

/** Whether a character has learned a secret (by fact id). */
export const hasLearned = (state: GameState, who: string, secret: string): boolean => learnedSecrets(state, who).some((p) => p.secret === secret)

/** Codex entries a character knows through what they learned: the pointers on their memories. */
export const learnedEntries = (state: GameState, who: string): string[] => [...new Set(learnedSecrets(state, who).flatMap((p) => (p.codex ? [p.codex] : [])))]

/**
 * Who knows a held secret, besides its holder: every character with a memory of learning it or in front of whom it came
 * out this scene (their memory is written at the scene's end), and the player when it is among the facts they found
 * out, or was said in front of them this scene.
 */
export function knowersOf(state: GameState, secret: string, text: string): string[] {
  const holder = secret.slice(0, secret.indexOf('.'))
  const now = (state.scene?.turns ?? []).flatMap((t) => (t.exposed ?? []).filter((e) => e.secret === secret).flatMap((e) => e.to))
  const learners = [...new Set([...state.memories.filter((m) => pointersOf(m).some((p) => p.secret === secret)).map((m) => m.owner), ...now])].filter((x) => x !== holder)
  const player = (state.facts[holder] ?? []).includes(text) || !!state.scene?.told.includes(secret)
  return player ? [...learners, 'player'] : learners
}
