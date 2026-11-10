import type { Beat } from '@engine/state'
import type { WitnessReport } from '@engine/relationships'
import type { Meters } from '@engine/characters'
import type { Pack } from '@engine/pack'
import { lineText, planLines, type TurnTrace } from '@engine/scene'
import { callsOf, metricInputOf, nameIn, type BenchRun, type ScenarioRun } from './run'
import { compareMetrics, metrics, renderMetrics } from '../logs/metrics'

const beatLine = (content: Pack, run: ScenarioRun, beat: Beat): string =>
  beat.kind === 'narration' ? `*${beat.text}*` : `**${nameIn(content, run.location, beat.speaker)}:** ${beat.text}`

const delta = (before: Meters, after: Meters): string =>
  Object.keys(after)
    .map((k) => {
      const d = after[k] - before[k]
      return `${k} ${after[k]}${d === 0 ? '' : ` (${d > 0 ? '+' : ''}${d})`}`
    })
    .join(', ')

const average = (xs: number[]) => (xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length))

/** The numbers that show at a glance whether a change made things better or worse. */
export function stats(run: ScenarioRun) {
  const turnCalls = callsOf(run).filter((c) => c.role !== 'summary')
  return {
    turns: run.turns.length,
    calls: turnCalls.length,
    rewrites: run.turns.filter((t) => t.rewrite).length,
    salvaged: run.turns.filter((t) => t.rewrite?.salvage).length,
    fallbacks: run.turns.filter((t) => t.director.read === 'unreadable').length,
    corrections: run.turns.reduce((n, t) => n + t.director.corrections.length, 0),
    beats: run.turns.reduce((n, t) => n + t.beats.length, 0),
    turnMs: average(run.turns.map((t) => t.cost.ms)),
    firstTextMs: average(turnCalls.flatMap((c) => (c.role === 'writer' && c.firstTextMs !== undefined ? [c.firstTextMs] : []))),
    directorMs: average(turnCalls.filter((c) => c.role === 'director').map((c) => c.ms))
  }
}

/** The check lines, beats and fixes of a traced turn, as the report shows them. */
const checkLines = (t: TurnTrace) => t.checks.map((c) => c.line)
const fixes = (t: TurnTrace) => t.findings.map((p) => p.fix)
const left = (t: TurnTrace) => t.rewrite?.remaining.map((p) => p.fix) ?? []
const shown = (t: TurnTrace): Beat[] => t.beats.map((b) => b.beat)
/** A scenario's label in tables: its id, and its repeat when there are several. */
const runName = (run: ScenarioRun, repeats: boolean) => `${run.id}${repeats ? ` #${run.repeat}` : ''}`

const STAT_HEADS = ['Scenario', 'Turns', 'Calls', 'Rewrites', 'Salvaged', 'Fallback plans', 'Corrections', 'Beats', 'Avg turn ms', 'Avg first text ms', 'Avg director ms']

function statRow(run: ScenarioRun, repeats = false): string {
  const s = stats(run)
  return `| ${runName(run, repeats)}${run.error ? ' ⚠' : ''} | ${s.turns} | ${s.calls} | ${s.rewrites} | ${s.salvaged} | ${s.fallbacks} | ${s.corrections} | ${s.beats} | ${s.turnMs} | ${s.firstTextMs} | ${s.directorMs} |`
}

function scenarioSection(content: Pack, run: ScenarioRun, repeats = false): string {
  const name = (id: string) => nameIn(content, run.location, id)
  const lines = [`## ${run.title} (\`${run.id}\`${repeats ? `, #${run.repeat}, seed ${run.seed}` : ''})`, '', `> ${run.watchFor}`, '']
  if (run.forceNatural !== undefined) lines.push(`Checks forced to a natural ${run.forceNatural}.`, '')
  if (run.error) lines.push(`**Stopped:** ${run.error}`, '')
  run.turns.forEach((t, i) => {
    lines.push(`### Turn ${i + 1}`, '', `**Player:** ${t.input}`, '')
    const p = t.director.plan
    const exchange = planLines(p)
    const plan = [
      ...exchange.map((_, i) => `- line ${lineText(exchange, i, name)}`),
      ...p.speakers.map((s) => `- **${name(s.id)}** speaks: ${s.intent}${s.mood ? ` *(mood: ${s.mood})*` : ''}${s.hiding ? ` — hiding: ${s.hiding} (${s.approach ?? '?'})` : ''}`),
      ...p.reactions.map((r) => `- ${name(r.id)} reacts: ${r.beat}`),
      ...checkLines(t).map((c) => `- 🎲 ${c}`),
      p.texture.length > 0 ? `- Texture: ${p.texture.join('; ')}` : '',
      ...t.director.corrections.map((c) => `- ⚙ corrected: ${c}`),
      t.director.read === 'unreadable' ? '- ⚙ director reply unreadable; the game planned the turn' : ''
    ].filter(Boolean)
    lines.push('<details><summary>Plan</summary>', '', ...plan, '', '</details>', '')
    lines.push(...shown(t).map((b, n) => `${n + 1}. ${beatLine(content, run, b)}`), '')
    if (fixes(t).length > 0) lines.push(`Rewrite asked to fix: ${fixes(t).map((f) => `"${f}"`).join(' ')}`, '')
    if (left(t).length > 0) lines.push(`Still wrong after the rewrite (salvaged): ${left(t).map((f) => `"${f}"`).join(' ')}`, '')
    lines.push(`*${t.cost.calls} calls, ${t.cost.ms} ms*`, '')
  })
  const summaries = reportsOf(run)
  if (summaries.length > 0) {
    lines.push('### After the scene', '')
    for (const r of summaries) {
      lines.push(`- **${name(r.id)}** (${r.level}): ${r.memory}${r.reason ? ` — *${r.reason}*` : ''}`, `  - Toward the player: ${delta(r.before, r.after)}`)
      for (const o of r.others) lines.push(`  - Toward ${name(o.with)} (${o.label}): ${delta(o.before, o.after)}`)
      for (const fact of r.learned) lines.push(`  - Learned: ${fact}`)
      if (r.error) lines.push(`  - ⚠ summary failed: ${r.error}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** What each witness took from the scene. */
const reportsOf = (run: ScenarioRun): WitnessReport[] => run.sceneEnd?.witnesses.flatMap((w) => (w.report ? [{ ...w.report, ...(w.error && { error: w.error }) }] : [])) ?? []

/** The lore budgets a run used, marking those the config set; nothing for runs from before they were recorded. */
const budgetsLine = (bench: BenchRun): string => {
  const b = bench.loreBudgets
  if (!b) return ''
  const mark = (f: 'sceneTokens' | 'triggeredTokens' | 'loreLines', v: number) => `${v}${b.set.includes(f) ? ' (config)' : ''}`
  return ` Lore budgets: scene ${mark('sceneTokens', b.sceneTokens)}, triggered ${mark('triggeredTokens', b.triggeredTokens)}, lines ${mark('loreLines', b.loreLines)}.`
}

/** A run as a readable report: the numbers first, then every scenario's turns, plans, beats and summaries. */
export function renderReport(content: Pack, bench: BenchRun): string {
  const repeats = bench.options.repeat > 1
  return [
    `# Scene test bench — ${bench.label}`,
    '',
    `Run ${bench.startedAt}, pack \`${bench.pack}\` ${bench.packVersion}, prompts \`${bench.prompts}\`${bench.options.pipeline ? `, pipeline \`${bench.options.pipeline}\`` : ''}${repeats ? `, ${bench.options.repeat} repeats` : ''}. Models: ${Object.entries(bench.models).map(([role, model]) => `${role} \`${model}\``).join(', ')}.${budgetsLine(bench)}`,
    '',
    `| ${STAT_HEADS.join(' | ')} |`,
    `|${STAT_HEADS.map(() => '---').join('|')}|`,
    ...bench.scenarios.map((run) => statRow(run, repeats)),
    '',
    '## Metrics',
    '',
    renderMetrics(metrics(bench.scenarios.map(metricInputOf)), (id) => nameIn(content, bench.scenarios[0]?.location ?? '', id)),
    '',
    ...bench.scenarios.map((run) => scenarioSection(content, run, repeats))
  ].join('\n')
}

/** Escapes a cell for a Markdown table. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, '<br>')

/**
 * Two runs side by side (narrator-scene-engine §10): their numbers, then each scenario they share, turn by turn, with
 * the beats in two columns. A scenario only one of them ran is listed but not compared.
 */
export function compareRuns(content: Pack, a: BenchRun, b: BenchRun): string {
  const lines = [
    `# Bench comparison: ${a.label} vs ${b.label}`,
    '',
    `- **A** — ${a.label} (${a.startedAt}): ${Object.entries(a.models).map(([r, m]) => `${r} \`${m}\``).join(', ')}.${budgetsLine(a)}`,
    `- **B** — ${b.label} (${b.startedAt}): ${Object.entries(b.models).map(([r, m]) => `${r} \`${m}\``).join(', ')}.${budgetsLine(b)}`,
    '',
    `| Run | ${STAT_HEADS.join(' | ')} |`,
    `|---|${STAT_HEADS.map(() => '---').join('|')}|`
  ]
  const ids = [...new Set([...a.scenarios.map((s) => s.id), ...b.scenarios.map((s) => s.id)])]
  const repeats = a.options.repeat > 1 || b.options.repeat > 1
  for (const id of ids) {
    for (const ra of a.scenarios.filter((s) => s.id === id)) lines.push(`| A ${statRow(ra, repeats)}`)
    for (const rb of b.scenarios.filter((s) => s.id === id)) lines.push(`| B ${statRow(rb, repeats)}`)
  }
  // Metrics over the scenarios both runs played, so a scenario only one of them ran doesn't skew the difference.
  const shared = (run: BenchRun) => run.scenarios.filter((s) => a.scenarios.some((x) => x.id === s.id) && b.scenarios.some((x) => x.id === s.id))
  lines.push('', '## Metrics (scenarios both ran)', '', compareMetrics(metrics(shared(a).map(metricInputOf)), metrics(shared(b).map(metricInputOf))))
  lines.push('')
  for (const id of ids) {
    const ra = a.scenarios.find((s) => s.id === id)
    const rb = b.scenarios.find((s) => s.id === id)
    if (!ra || !rb) {
      lines.push(`## \`${id}\``, '', `Only in ${ra ? 'A' : 'B'}.`, '')
      continue
    }
    lines.push(`## ${ra.title} (\`${id}\`)`, '', `> ${ra.watchFor}`, '')
    // Side by side, the first repeat of each; the numbers above cover all of them.
    const turns = Math.max(ra.turns.length, rb.turns.length)
    for (let i = 0; i < turns; i++) {
      const ta = ra.turns[i]
      const tb = rb.turns[i]
      lines.push(`### Turn ${i + 1}: ${ta?.input ?? tb?.input}`, '', '| A | B |', '|---|---|')
      const side = (run: ScenarioRun, t: typeof ta) =>
        t ? cell([...checkLines(t).map((c) => `🎲 ${c}`), ...shown(t).map((beat) => beatLine(content, run, beat)), t.rewrite ? `↻ rewritten (${t.findings.length} fixes)` : ''].filter(Boolean).join('\n\n')) : '—'
      lines.push(`| ${side(ra, ta)} | ${side(rb, tb)} |`, '')
    }
    const memories = (run: ScenarioRun) => cell(reportsOf(run).map((r) => `**${nameIn(content, run.location, r.id)}:** ${r.memory} (${delta(r.before, r.after)})`).join('\n\n') || '—')
    lines.push('### After the scene', '', '| A | B |', '|---|---|', `| ${memories(ra)} | ${memories(rb)} |`, '')
  }
  return lines.join('\n')
}
