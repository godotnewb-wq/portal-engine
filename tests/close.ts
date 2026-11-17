import type { Pack } from '@engine/pack'
import { answerTie, type GameState } from '@engine/state'
import { endScene, judgeScene, type RelationshipTrace, type SceneEnd, type Summarize } from '@engine/relationships'

/**
 * A scene's whole end, as the app plays it (milestone 4c): every witness's relationship call and the ties settled from
 * them, the player's answer to any change that waits on them, then every witness's memory call. One `call` answers
 * both kinds; a reply may hold both calls' fields, and each reads its own.
 */
export async function closeScene(content: Pack, state: GameState, call: Summarize, answer = true): Promise<SceneEnd & { judged: RelationshipTrace }> {
  const judged = await judgeScene(content, state, call)
  let next = judged.state
  while (next.scene!.pendingTies.length > 0) next = answerTie(content, next, 0, answer)
  return { ...(await endScene(content, next, call)), judged: judged.trace }
}
