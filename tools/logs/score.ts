import type { Pack } from '@engine/pack'
import { traced, type CallMeta, type CallTrace, type Prompt } from '@engine/core'
import { buildScorerPrompt, parseScore, SCORER_VERSION, type ScoreRecord } from '@engine/review'
import { LogSession, readSession, type SessionLog, type TurnRecord } from '@platform/logs'
import { namer, sceneLocation } from './load'

export type Scorer = (prompt: Prompt) => Promise<string | { text: string; meta?: CallMeta }>

/** The two turns before this one in its scene, as the scorer sees them, for repetition and focus. */
function earlier(content: Pack, log: SessionLog, turn: TurnRecord): string[] {
  const nameOf = namer(content, sceneLocation(log, turn.sceneId))
  return log.turns
    .filter((t) => t.sceneId === turn.sceneId && t.turn < turn.turn)
    .slice(-2)
    .map((t) => [`You: ${t.input}`, ...t.beats.map((b) => (b.beat.kind === 'narration' ? b.beat.text : `${nameOf(b.beat.speaker)}: ${b.beat.text}`))].join('\n'))
}

export interface ScoreRun {
  scored: number
  skipped: number
  failed: number
}

/**
 * Runs the AI scorer (milestone 2, A5) over a session's turns that have no score from the current scorer version,
 * one call at a time, appending to the session's `scores.jsonl` and its calls to `calls.jsonl` (role `scorer`).
 * Never during play. A reply that can't be read is logged as an error and scores nothing.
 */
export async function scoreSession(content: Pack, dir: string, scorer: Scorer, options: { now?: () => number; log?: (line: string) => void } = {}): Promise<ScoreRun> {
  const log = readSession(dir)
  const session = LogSession.resume(dir)
  const now = options.now ?? Date.now
  const done = new Set(log.scores.filter((s) => s.turnSession === log.session.id && s.scorer.version === SCORER_VERSION).map((s) => s.turnId))
  const result: ScoreRun = { scored: 0, skipped: 0, failed: 0 }
  for (const turn of log.turns) {
    if (done.has(turn.turnId)) {
      result.skipped++
      continue
    }
    const location = sceneLocation(log, turn.sceneId) ?? ''
    const prompt = buildScorerPrompt(content, turn, location, earlier(content, log, turn))
    const calls: CallTrace[] = []
    const id = `${turn.turnId}:scorer:v${SCORER_VERSION}:${now()}`
    try {
      const reply = await traced(calls, { id, role: 'scorer', turnId: turn.turnId, sceneId: turn.sceneId }, prompt, now, () => scorer(prompt))
      const parsed = parseScore(reply, turn)
      if (!parsed) {
        session.error({ where: 'scorer', message: 'The scorer reply could not be read.', turnId: turn.turnId, calls })
        result.failed++
        continue
      }
      const meta = calls[0]?.meta
      const record: ScoreRecord = {
        turnSession: log.session.id,
        turnId: turn.turnId,
        scorer: { version: SCORER_VERSION, ...(meta?.profile && { profile: meta.profile }), ...(meta?.model && { model: meta.model }) },
        at: new Date(now()).toISOString(),
        items: parsed.items,
        beats: parsed.beats,
        callId: id
      }
      session.score(record, calls[0])
      result.scored++
      options.log?.(`  ${turn.turnId}: ${parsed.items.map((i) => `${i.id}:${i.score}`).join(' ')}`)
    } catch (error) {
      session.error({ where: 'scorer', message: (error as Error).message, turnId: turn.turnId, calls })
      result.failed++
    }
  }
  return result
}
