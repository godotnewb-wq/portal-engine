import type { Pack } from '@engine/pack'
import { currentFlags, flagKey, RUBRIC, type FlagRecord, type ScoreRecord } from '@engine/review'
import type { SessionLog, TurnRecord } from '@platform/logs'
import { namer, sceneLocation } from './load'

const flagLine = (r?: FlagRecord) => {
  if (!r?.flag) return ''
  const { rating, reasons, note } = r.flag
  return ` ⚑ **${rating}**${reasons.length ? ` (${reasons.join(', ')})` : ''}${note ? `: “${note}”` : ''}`
}

/** The newest score for each turn. */
export function latestScores(scores: ScoreRecord[]): Map<string, ScoreRecord> {
  const out = new Map<string, ScoreRecord>()
  for (const s of scores) {
    const had = out.get(s.turnId)
    if (!had || s.scorer.version > had.scorer.version || (s.scorer.version === had.scorer.version && s.at > had.at)) out.set(s.turnId, s)
  }
  return out
}

/** A short line for a turn's plan: who speaks and why, who reacts. */
export function planSummary(turn: TurnRecord, nameOf: (id: string) => string): string {
  const p = turn.director.plan
  return [
    ...p.speakers.map((s) => `${nameOf(s.id)}: ${s.point ? `${s.point} — ` : ''}${s.intent}${s.hiding ? ` [hiding: ${s.approach ?? 'deflect'}]` : ''}`),
    ...p.reactions.map((r) => `${nameOf(r.id)} reacts`),
    turn.director.read === 'unreadable' ? 'game-planned (director unreadable)' : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * A session as a readable Markdown transcript (milestone 2, A4): the player's input, a short plan summary, the
 * check chips and code findings, and the beats with their flags, notes and AI scores inline. Built on request, so it
 * always shows the latest flags and scores.
 */
export function renderTranscript(content: Pack, log: SessionLog, flags: FlagRecord[]): string {
  const s = log.session
  const standing = currentFlags(flags)
  const scores = latestScores(log.scores)
  const lines = [
    `# ${s.kind === 'bench' ? `Bench: ${s.bench?.title ?? s.from}` : 'Play session'} \`${s.id}\``,
    '',
    `Pack \`${s.pack.id}\` ${s.pack.version}, prompts \`${s.prompts}\`, engine ${s.engine}. Started ${s.startedAt}${s.endedAt ? `, ended ${s.endedAt}` : ' (did not close cleanly)'}${s.from ? `, from ${s.from}` : ''}.`,
    Object.keys(s.models).length > 0 ? `Models: ${Object.entries(s.models).map(([role, m]) => `${role} \`${m.model}\``).join(', ')}.` : '',
    s.bench ? `\n> ${s.bench.watchFor}` : '',
    ''
  ]
  let scene = ''
  for (const turn of log.turns) {
    const location = sceneLocation(log, turn.sceneId)
    const nameOf = namer(content, location)
    if (turn.sceneId !== scene) {
      scene = turn.sceneId
      lines.push(`## Scene \`${scene}\`${location ? ` at ${content.locations.find((l) => l.id === location)?.name ?? location}` : ''}`, '')
    }
    const turnFlag = standing.get(flagKey({ turnSession: s.id, turnId: turn.turnId }))
    const score = scores.get(turn.turnId)
    lines.push(`### Turn ${turn.turn} \`${turn.turnId}\`${flagLine(turnFlag)}`, '', `**You:** ${turn.input}`, '', `*Plan: ${planSummary(turn, nameOf)}*`, '')
    if (turn.checks.length > 0) lines.push(turn.checks.map((c) => `🎲 ${c.line}`).join(' · '), '')
    if (turn.findings.length > 0) lines.push(`⚙ ${turn.findings.map((p) => `${p.kind}${p.beat ? ` (beat ${p.beat})` : ''}`).join(', ')}${turn.rewrite ? ' → rewritten' : ''}${turn.rewrite?.salvage ? `, salvaged (dropped ${turn.rewrite.salvage.dropped.join(', ') || 'none'}, cut ${turn.rewrite.salvage.cut})` : ''}`, '')
    for (const b of turn.beats) {
      const who = b.beat.kind === 'narration' ? '' : `**${nameOf(b.beat.speaker)}:** `
      const ai = score?.beats.find((m) => m.beat === b.index)
      const aiLine = ai ? ` 🤖 ${ai.rating}${ai.reasons.length ? ` (${ai.reasons.join(', ')})` : ''}${ai.note ? `: ${ai.note}` : ''}` : ''
      lines.push(`${b.index}. ${who}${b.beat.kind === 'narration' ? `*${b.beat.text}*` : b.beat.text}${flagLine(standing.get(flagKey({ turnSession: s.id, turnId: turn.turnId, beat: b.index })))}${aiLine}`)
    }
    lines.push('')
    if (score) lines.push(`🤖 ${score.items.map((i) => `${RUBRIC.find((r) => r.id === i.id)?.name ?? i.id} ${i.score}`).join(' · ')}`, '')
  }
  for (const end of log.scenes) {
    if (end.type !== 'end') continue
    const nameOf = namer(content, sceneLocation(log, end.sceneId))
    lines.push(`## After scene \`${end.sceneId}\``, '')
    for (const w of end.witnesses) lines.push(`- **${nameOf(w.id)}** (${w.summary.level}): ${w.summary.memory}${w.summary.reason ? ` — *${w.summary.reason}*` : ''}${w.error ? ` ⚠ ${w.error}` : ''}`)
    lines.push('')
  }
  if (log.errors.length > 0) lines.push('## Errors', '', ...log.errors.map((e) => `- ${e.at} ${e.where}${e.turnId ? ` \`${e.turnId}\`` : ''}: ${e.message}`), '')
  return lines.join('\n')
}
