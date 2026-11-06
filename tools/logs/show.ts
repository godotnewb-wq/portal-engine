import type { Pack } from '@engine/pack'
import { promptOf, type SessionLog } from '@platform/logs'
import { namer, sceneLocation } from './load'
import { planSummary } from './transcript'

const fence = (text: string) => `\`\`\`\`\n${text}\n\`\`\`\``

/** One turn in full (milestone 2, A4): its trace and every call with the full prompt put back together, and the raw reply. */
export function renderTurn(content: Pack, log: SessionLog, n: number): string {
  const turn = log.turns[n - 1]
  if (!turn) throw new Error(`${log.session.id} has ${log.turns.length} turns; there is no turn ${n}.`)
  const nameOf = namer(content, sceneLocation(log, turn.sceneId))
  const { calls, beats, ...rest } = turn
  const lines = [
    `# Turn ${n} \`${turn.turnId}\` of \`${log.session.id}\``,
    '',
    `**You:** ${turn.input}`,
    '',
    `*Plan: ${planSummary(turn, nameOf)}*`,
    '',
    '## Beats',
    '',
    ...beats.map((b) => `${b.index}. ${b.beat.kind === 'dialogue' ? `**${nameOf(b.beat.speaker)}:** ` : ''}${b.beat.text}  \n   <sub>${b.source} line ${b.line}${b.salvaged ? ', salvaged' : ''} · ${b.plan.join(', ')}</sub>`),
    '',
    '## Trace',
    '',
    fence(JSON.stringify(rest, null, 2))
  ]
  for (const id of calls) {
    const call = log.calls.get(id)
    if (!call) {
      lines.push('', `## ${id}`, '', '(missing from calls.jsonl)')
      continue
    }
    const prompt = promptOf(log, call)
    const meta = call.meta ? ` · ${[call.meta.profile, call.meta.model, call.meta.temperature !== undefined && `t=${call.meta.temperature}`, call.meta.usage && `${call.meta.usage.input ?? '?'}→${call.meta.usage.output ?? '?'} tokens`].filter(Boolean).join(' · ')}` : ''
    lines.push('', `## ${call.role} \`${id}\``, '', `${call.ms} ms${call.firstTextMs !== undefined ? `, first text ${call.firstTextMs} ms` : ''}${meta}${call.restarted ? ' · restarted on another profile' : ''}${call.meta?.declined ? ` · declined: ${call.meta.declined}` : ''}${call.error ? ` · **error:** ${call.error}` : ''}`, '', '### System', '', fence(prompt.system), '', '### User', '', fence(prompt.user), '', '### Reply', '', fence(call.reply))
  }
  return lines.join('\n')
}
