import type { Beat, Meters } from '../../shared/model'
import type { Content } from '../../shared/game/content'
import { nameIn, type BenchRun, type ScenarioRun } from './run'

const beatLine = (content: Content, run: ScenarioRun, beat: Beat): string =>
  beat.kind === 'narration' ? `*${beat.text}*` : `**${nameIn(content, run.location, beat.speaker)}:** ${beat.text}`

const delta = (before: Meters, after: Meters): string =>
  (['approval', 'trust', 'attraction'] as const)
    .map((k) => {
      const d = after[k] - before[k]
      return `${k} ${after[k]}${d === 0 ? '' : ` (${d > 0 ? '+' : ''}${d})`}`
    })
    .join(', ')

const average = (xs: number[]) => (xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length))

/** The numbers that show at a glance whether a change made things better or worse. */
export function stats(run: ScenarioRun) {
  const turnCalls = run.calls.filter((c) => c.turn !== 'summary')
  return {
    turns: run.turns.length,
    calls: turnCalls.length,
    rewrites: run.turns.filter((t) => t.rewrite.length > 0).length,
    salvaged: run.turns.filter((t) => t.remaining.length > 0).length,
    fallbacks: run.turns.filter((t) => t.fallback).length,
    corrections: run.turns.reduce((n, t) => n + t.corrections.length, 0),
    beats: run.turns.reduce((n, t) => n + t.beats.length, 0),
    turnMs: average(run.turns.map((t) => t.ms)),
    firstTextMs: average(turnCalls.flatMap((c) => (c.role === 'writer' && c.firstTextMs !== undefined ? [c.firstTextMs] : []))),
    directorMs: average(turnCalls.filter((c) => c.role === 'director').map((c) => c.ms))
  }
}

const STAT_HEADS = ['Scenario', 'Turns', 'Calls', 'Rewrites', 'Salvaged', 'Fallback plans', 'Corrections', 'Beats', 'Avg turn ms', 'Avg first text ms', 'Avg director ms']

function statRow(run: ScenarioRun): string {
  const s = stats(run)
  return `| ${run.id}${run.error ? ' ⚠' : ''} | ${s.turns} | ${s.calls} | ${s.rewrites} | ${s.salvaged} | ${s.fallbacks} | ${s.corrections} | ${s.beats} | ${s.turnMs} | ${s.firstTextMs} | ${s.directorMs} |`
}

function scenarioSection(content: Content, run: ScenarioRun): string {
  const name = (id: string) => nameIn(content, run.location, id)
  const lines = [`## ${run.title} (\`${run.id}\`)`, '', `> ${run.watchFor}`, '']
  if (run.forceNatural !== undefined) lines.push(`Checks forced to a natural ${run.forceNatural}.`, '')
  if (run.error) lines.push(`**Stopped:** ${run.error}`, '')
  run.turns.forEach((t, i) => {
    lines.push(`### Turn ${i + 1}`, '', `**Player:** ${t.input}`, '')
    const plan = [
      ...t.speakers.map((s) => `- **${name(s.id)}** speaks: ${s.intent}${s.mood ? ` *(mood: ${s.mood})*` : ''}${s.hiding ? ` — hiding: ${s.hiding} (${s.approach ?? '?'})` : ''}`),
      ...t.reactions.map((r) => `- ${name(r.id)} reacts: ${r.beat}`),
      ...t.checks.map((c) => `- 🎲 ${c}`),
      t.texture.length > 0 ? `- Texture: ${t.texture.join('; ')}` : '',
      ...t.corrections.map((c) => `- ⚙ corrected: ${c}`),
      t.fallback ? '- ⚙ director reply unreadable; the game planned the turn' : ''
    ].filter(Boolean)
    lines.push('<details><summary>Plan</summary>', '', ...plan, '', '</details>', '')
    lines.push(...t.beats.map((b, n) => `${n + 1}. ${beatLine(content, run, b)}`), '')
    if (t.rewrite.length > 0) lines.push(`Rewrite asked to fix: ${t.rewrite.map((f) => `"${f}"`).join(' ')}`, '')
    if (t.remaining.length > 0) lines.push(`Still wrong after the rewrite (salvaged): ${t.remaining.map((f) => `"${f}"`).join(' ')}`, '')
    lines.push(`*${t.calls} calls, ${t.ms} ms*`, '')
  })
  if (run.summaries.length > 0) {
    lines.push('### After the scene', '')
    for (const r of run.summaries) {
      lines.push(`- **${name(r.id)}** (${r.level}): ${r.memory}${r.reason ? ` — *${r.reason}*` : ''}`, `  - Toward the player: ${delta(r.before, r.after)}`)
      for (const o of r.others) lines.push(`  - Toward ${name(o.with)} (${o.label}): ${delta(o.before, o.after)}`)
      for (const fact of r.learned) lines.push(`  - Learned: ${fact}`)
      if (r.error) lines.push(`  - ⚠ summary failed: ${r.error}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** A run as a readable report: the numbers first, then every scenario's turns, plans, beats and summaries. */
export function renderReport(content: Content, bench: BenchRun): string {
  return [
    `# Scene test bench — ${bench.label}`,
    '',
    `Run ${bench.startedAt}. Models: ${Object.entries(bench.models).map(([role, model]) => `${role} \`${model}\``).join(', ')}.`,
    '',
    `| ${STAT_HEADS.join(' | ')} |`,
    `|${STAT_HEADS.map(() => '---').join('|')}|`,
    ...bench.scenarios.map(statRow),
    '',
    ...bench.scenarios.map((run) => scenarioSection(content, run))
  ].join('\n')
}

/** Escapes a cell for a Markdown table. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, '<br>')

/**
 * Two runs side by side (narrator-scene-engine §10): their numbers, then each scenario they share, turn by turn, with
 * the beats in two columns. A scenario only one of them ran is listed but not compared.
 */
export function compareRuns(content: Content, a: BenchRun, b: BenchRun): string {
  const lines = [
    `# Bench comparison: ${a.label} vs ${b.label}`,
    '',
    `- **A** — ${a.label} (${a.startedAt}): ${Object.entries(a.models).map(([r, m]) => `${r} \`${m}\``).join(', ')}`,
    `- **B** — ${b.label} (${b.startedAt}): ${Object.entries(b.models).map(([r, m]) => `${r} \`${m}\``).join(', ')}`,
    '',
    `| Run | ${STAT_HEADS.join(' | ')} |`,
    `|---|${STAT_HEADS.map(() => '---').join('|')}|`
  ]
  const ids = [...new Set([...a.scenarios.map((s) => s.id), ...b.scenarios.map((s) => s.id)])]
  for (const id of ids) {
    const ra = a.scenarios.find((s) => s.id === id)
    const rb = b.scenarios.find((s) => s.id === id)
    if (ra) lines.push(`| A ${statRow(ra)}`)
    if (rb) lines.push(`| B ${statRow(rb)}`)
  }
  lines.push('')
  for (const id of ids) {
    const ra = a.scenarios.find((s) => s.id === id)
    const rb = b.scenarios.find((s) => s.id === id)
    if (!ra || !rb) {
      lines.push(`## \`${id}\``, '', `Only in ${ra ? 'A' : 'B'}.`, '')
      continue
    }
    lines.push(`## ${ra.title} (\`${id}\`)`, '', `> ${ra.watchFor}`, '')
    const turns = Math.max(ra.turns.length, rb.turns.length)
    for (let i = 0; i < turns; i++) {
      const ta = ra.turns[i]
      const tb = rb.turns[i]
      lines.push(`### Turn ${i + 1}: ${ta?.input ?? tb?.input}`, '', '| A | B |', '|---|---|')
      const side = (run: ScenarioRun, t: typeof ta) =>
        t ? cell([...t.checks.map((c) => `🎲 ${c}`), ...t.beats.map((beat) => beatLine(content, run, beat)), t.rewrite.length > 0 ? `↻ rewritten (${t.rewrite.length} fixes)` : ''].filter(Boolean).join('\n\n')) : '—'
      lines.push(`| ${side(ra, ta)} | ${side(rb, tb)} |`, '')
    }
    const memories = (run: ScenarioRun) => cell(run.summaries.map((r) => `**${nameIn(content, run.location, r.id)}:** ${r.memory} (${delta(r.before, r.after)})`).join('\n\n') || '—')
    lines.push('### After the scene', '', '| A | B |', '|---|---|', `| ${memories(ra)} | ${memories(rb)} |`, '')
  }
  return lines.join('\n')
}
