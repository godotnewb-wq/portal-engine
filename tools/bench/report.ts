import type { Beat } from '@engine/state'
import { parseConsolidation, type RelationshipTrace, type SceneEndTrace, type WitnessReport } from '@engine/relationships'
import { feelingLabel, type Meters } from '@engine/characters'
import type { Pack } from '@engine/pack'
import { lineText, moodOf, planLines, type TurnTrace } from '@engine/scene'
import { callsOf, metricInputOf, nameIn, turnsOf, type BenchRun, type SceneRun, type ScenarioRun } from './run'
import { comparability } from './inputs'
import { bookkeepingOf, RECORD_HEADS, recordLines, recordRow, renderTokens } from './records'
import { compareMetrics, metrics, renderMetrics } from '../logs/metrics'

/** How a run names people: as recorded when it ran, else from the pack loaded now (runs from before names were recorded). */
type Names = (location: string, id: string) => string
export const namesOf = (content: Pack, bench: BenchRun): Names => (location, id) => bench.inputs?.names[id] ?? nameIn(content, location, id)

const beatLine = (names: Names, location: string, beat: Beat): string =>
  beat.kind === 'narration' ? `*${beat.text}*` : `**${names(location, beat.speaker)}:** ${beat.text}`

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
  // Turn calls only: summaries and consolidation run between scenes, and the bookkeeper after the turn is shown
  // (milestone 4c), so "Calls" stays the turn's own two or three; its own numbers are in the Bookkeeper section.
  const turnCalls = callsOf(run).filter((c) => !['relationship', 'memory', 'summary', 'consolidation', 'ties', 'bookkeeper'].includes(c.role))
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

function missedCheck(run: ScenarioRun): string {
  const expected = run.expectedCheck
  if (!expected || run.turns[expected.turn - 1]?.checks.some((check) => check.who === expected.who && check.skill === expected.skill)) return ''
  return `Expected check not exercised on turn ${expected.turn}: ${expected.who} (${expected.skill}).`
}

function statRow(run: ScenarioRun, repeats = false): string {
  const s = stats(run)
  return `| ${runName(run, repeats)}${run.error ? ' ⚠' : ''}${missedCheck(run) ? ' ⚠ Expected check not exercised' : ''} | ${s.turns} | ${s.calls} | ${s.rewrites} | ${s.salvaged} | ${s.fallbacks} | ${s.corrections} | ${s.beats} | ${s.turnMs} | ${s.firstTextMs} | ${s.directorMs} |`
}

function loreLines(turn: TurnTrace, budgets?: BenchRun['loreBudgets']): string[] {
  const lore = turn.lore
  if (!lore) return []
  const limits = lore.budgets ?? budgets
  const lines = [
    `Lore stage (uncapped): ≈${lore.tokens.stage} director tokens, ≈${lore.tokens.writerStage} writer tokens.`
  ]
  for (const layer of ['scene', 'triggered'] as const) {
    const budget = layer === 'scene' ? limits?.sceneTokens : limits?.triggeredTokens
    lines.push(`Lore ${layer}: ≈${lore.tokens[layer]}${budget === undefined ? '' : ` / ${budget}`} tokens.`)
    const summaries = lore[layer].filter((entry) => entry.form === 'summary').map((entry) => entry.id)
    const cuts = lore.budgetCuts?.[layer]
    if (summaries.length > 0) lines.push(`${layer} summaries: ${summaries.join(', ')}.`)
    if (cuts?.shortened.length) lines.push(`${layer} shortened to fit: ${cuts.shortened.join(', ')}.`)
    if (cuts?.dropped.length) lines.push(`${layer} dropped to fit: ${cuts.dropped.join(', ')}.`)
  }
  const planned = turn.director.plan.lore ?? []
  lines.push(`Lore lines: ${planned.length}${limits ? ` / ${limits.loreLines}` : ''}.`)
  for (const line of planned) lines.push(`${line.entry}${line.who ? ` (${line.who})` : ''}: ${line.line}`)
  for (const correction of turn.director.corrections.filter((c) => /^(dropped )?lore line /.test(c))) {
    lines.push(`Lore correction: ${correction}`)
  }
  const departures = turn.cast.after.filter((after) => after.departed && turn.cast.before.some((before) => before.id === after.id && !before.departed))
  if (departures.length > 0) lines.push(`Left the scene: ${departures.map((actor) => actor.id).join(', ')}.`)
  return lines
}

/** What the director's briefs carried this turn (milestone 4a): always-on cost, the detail chosen and why, and cuts. */
function briefLines(turn: TurnTrace): string[] {
  const b = turn.brief
  if (!b) return []
  const always = Object.values(b.recurring).reduce((n, x) => n + x, 0)
  return [
    `Always-on: ≈${always} tokens (${Object.entries(b.recurring).map(([id, n]) => `${id} ${n}`).join(', ')}).`,
    `Optional detail: ≈${b.used} / ${b.budget} tokens, ${b.selected.length} chosen.`,
    ...b.selected.map((d) => `+ ${d.id} (${d.rank}; ${d.trigger}; ≈${d.tokens})`),
    ...b.cut.map((d) => `− ${d.id} (${d.rank}; ${d.trigger}; cut: ${d.why})`),
    ...(b.dropped.length > 0 ? [`Topic changed; let go: ${b.dropped.join(', ')}.`] : [])
  ]
}

function scenarioSection(names: Names, run: ScenarioRun, repeats: boolean, budgets?: BenchRun['loreBudgets']): string {
  const turnLines = (n: Names, location: string, turns: TurnTrace[], heading: string, b?: BenchRun['loreBudgets']) => turnSection(n, location, turns, heading, b, run)
  const lines = [`## ${run.title} (\`${run.id}\`${repeats ? `, #${run.repeat}, seed ${run.seed}` : ''})`, '', `> ${run.watchFor}`, '']
  if (run.forceNatural !== undefined) lines.push(`Checks forced to a natural ${run.forceNatural}.`, '')
  const missed = missedCheck(run)
  if (missed) lines.push(`**${missed}**`, '')
  if (run.error) lines.push(`**Stopped:** ${run.error}`, '')
  if (!run.scenes) {
    lines.push(...turnLines(names, run.location, run.turns, '###', budgets), ...tieLines(names, run.location, run.ties, run.sceneEnd, '###'), ...afterLines(names, run.location, run.sceneEnd, '###'))
    return lines.join('\n')
  }
  for (const s of run.scenes) {
    const name = (id: string) => names(s.location, id)
    const when = s.n === 1 ? '' : s.days === 0 ? ', the same evening' : `, ${s.days} day${s.days === 1 ? '' : 's'} later`
    lines.push(`### Scene ${s.n}: \`${s.location}\`${when}`, '', `Present: ${s.cast.map(name).join(', ')}.`, '')
    lines.push(...nightLines(names, s), ...turnLines(names, s.location, turnsOf(run, s), '####', budgets), ...tieLines(names, s.location, s.ties, s.sceneEnd, '####'), ...afterLines(names, s.location, s.sceneEnd, '####'))
  }
  return lines.join('\n')
}

/** What each night between scenes merged (milestone 4b): whose memories, on what subject, and the merged text. */
function nightLines(names: Names, s: SceneRun): string[] {
  const groups = s.consolidations.flatMap((night) =>
    night.groups.map((g, i) => {
      const call = night.calls.find((c) => c.id.endsWith(`:${i + 1}`))
      const subject = g.subject.kind === 'player' ? 'the player' : g.subject.kind === 'person' ? names(s.location, g.subject.id) : `\`${g.subject.id}\``
      const outcome = g.made ? `→ ${g.made}: "${parseConsolidation(call?.reply ?? '')}"` : g.refused ? `refused: ${g.refused}` : `failed: ${g.error ?? '?'}`
      return `- ${names(s.location, g.owner)} merged ${g.from.length} memories about ${subject} (${g.from.join(', ')}) ${outcome}`
    })
  )
  return groups.length > 0 ? ['Overnight, consolidation:', '', ...groups, ''] : []
}

/**
 * Relationship changes at a scene's end (milestone 4c: settled from the witnesses' relationship calls; before it, one
 * tie check): what changed, what waited for the player and their answer, what was refused, what only one side said.
 * Runs from before 4c have no `alone` or `witnesses`, and may have the tie check's `error`.
 */
function tieLines(names: Names, location: string, ties: (RelationshipTrace & { error?: string }) | undefined, end: SceneEndTrace | undefined, heading: string): string[] {
  if (!ties) return []
  const name = (id: string) => names(location, id)
  const lines = [
    ...ties.applied.map((e) => `- ${name(e.from)} → ${name(e.to)}: ${[...e.added.map((t) => `+${t}`), ...e.ended.map((t) => `−${t}`)].join(' ')}${e.word ? ` ("${e.word}")` : ''}${e.reason ? ` — ${e.reason}` : e.line ? ` — “${e.line}”` : ''}`),
    ...(end?.answered ?? []).map((a) => `- Asked the player: ${name(a.change.from)} → ${name(a.change.to)}${a.change.add ? ` +${a.change.add}` : ''}${a.change.end ? ` −${a.change.end}` : ''}: ${a.accepted ? 'yes' : 'no'}`),
    ...ties.refused.map((x) => `- Refused ${x}`),
    ...(ties.alone ?? []).map((x) => `- One side only, no change: ${x}`),
    ...(ties.witnesses ?? []).flatMap((w) => (w.error ? [`- ⚠ ${name(w.id)}'s relationship call failed: ${w.error}`] : [])),
    ...(ties.error ? [`- ⚠ tie check failed: ${ties.error}`] : [])
  ]
  return [`${heading} Relationship changes`, '', ...(lines.length > 0 ? lines : ['None.']), '']
}

/** A scene's turns as the report shows them, each with its bookkeeper's records when the run had one (milestone 4c). */
function turnSection(names: Names, location: string, turns: TurnTrace[], heading: string, budgets?: BenchRun['loreBudgets'], run?: ScenarioRun): string[] {
  const name = (id: string) => names(location, id)
  const lines: string[] = []
  turns.forEach((t, i) => {
    lines.push(`${heading} Turn ${i + 1}`, '', `**Player:** ${t.input}`, '')
    const p = t.director.plan
    const exchange = planLines(p)
    const plan = [
      ...exchange.map((_, i) => `- line ${lineText(exchange, i, name)}`),
      ...p.speakers.map((s) => `- **${name(s.id)}** speaks: ${s.intent}${moodOf(s) ? ` *(feels: ${moodOf(s)})*` : ''}${s.hiding ? ` — hiding: ${s.hiding} (${s.approach ?? '?'})` : ''}`),
      ...p.reactions.map((r) => `- ${name(r.id)} reacts: ${r.beat}`),
      ...checkLines(t).map((c) => `- 🎲 ${c}`),
      p.texture.length > 0 ? `- Texture: ${p.texture.join('; ')}` : '',
      ...t.director.corrections.map((c) => `- ⚙ corrected: ${c}`),
      t.director.read === 'unreadable' ? '- ⚙ director reply unreadable; the game planned the turn' : ''
    ].filter(Boolean)
    lines.push('<details><summary>Plan</summary>', '', ...plan, '', '</details>', '')
    const lore = loreLines(t, budgets)
    if (lore.length > 0) lines.push('<details><summary>Lore</summary>', '', ...lore.map((line) => '- ' + line), '', '</details>', '')
    const brief = briefLines(t)
    if (brief.length > 0) lines.push('<details><summary>Briefs</summary>', '', ...brief.map((line) => '- ' + line), '', '</details>', '')
    lines.push(...shown(t).map((b, n) => `${n + 1}. ${beatLine(names, location, b)}`), '')
    const records = run ? recordLines(name, t, bookkeepingOf(run, t.turnId)) : []
    if (records.length > 0) lines.push('<details><summary>Records</summary>', '', ...records.map((line) => '- ' + line), '', '</details>', '')
    if (fixes(t).length > 0) lines.push(`Rewrite asked to fix: ${fixes(t).map((f) => `"${f}"`).join(' ')}`, '')
    if (left(t).length > 0) lines.push(`Still wrong after the rewrite (salvaged): ${left(t).map((f) => `"${f}"`).join(' ')}`, '')
    lines.push(`*${t.cost.calls} calls, ${t.cost.ms} ms*`, '')
  })
  return lines
}

/** What each witness took from a scene: memories, meters, what they learned and what they carry (milestone 4b). */
function afterLines(names: Names, location: string, end: SceneEndTrace | undefined, heading: string): string[] {
  const name = (id: string) => names(location, id)
  const summaries = reportsOf(end)
  if (summaries.length === 0) return []
  const lines = [`${heading} After the scene`, '']
  for (const r of summaries) {
    lines.push(`- **${name(r.id)}** (${r.level}): ${r.memory}${r.reason ? ` — *${r.reason}*` : ''}`)
    for (const m of r.memories.slice(1)) lines.push(`  - Also remembers (${m.level}): ${m.text}`)
    for (const m of r.revisited) lines.push(`  - Came back to ${m.id} (now ${m.level})`)
    for (const note of r.memoryNotes) lines.push(`  - Memory note: ${note}`)
    lines.push(`  - Toward the player: ${delta(r.before, r.after)}`)
    for (const o of r.others) lines.push(`  - Toward ${name(o.with)}: ${delta(o.before, o.after)}`)
    for (const fact of r.learned) lines.push(`  - Learned: ${fact}`)
    for (const id of r.heard) lines.push(`  - Took in someone's secret: ${id}`)
    const c = r.carried
    if (c?.aftermath) lines.push(`  - Carries: ${feelingLabel(c.aftermath)}`)
    for (const t of c?.toward ?? []) lines.push(`  - Carries toward ${name(t.toward)}: ${feelingLabel(t.feeling)}${t.renewed ? ' (renewed)' : ''}${t.repeat ? ` — repeat ${t.repeat.count}: ${t.repeat.meter} ${t.repeat.change > 0 ? '+' : ''}${t.repeat.change}` : ''}`)
    for (const who of c?.resolved ?? []) lines.push(`  - Resolved toward ${name(who)}`)
    for (const d of c?.dropped ?? []) lines.push(`  - Dropped: ${d}`)
    if (r.error) lines.push(`  - ⚠ failed: ${r.error}`)
  }
  lines.push('')
  return lines
}

/** Where a turn was played: its scene's location in a run with several. */
const locationOf = (run: ScenarioRun, t: TurnTrace): string => run.scenes?.find((s) => s.id === t.sceneId)?.location ?? run.location
/** What every witness took from every scene of a run. */
const allReports = (run: ScenarioRun): WitnessReport[] => (run.scenes ? run.scenes.flatMap((s) => reportsOf(s.sceneEnd)) : reportsOf(run.sceneEnd))

/** What each witness took from the scene. */
const reportsOf = (end: SceneEndTrace | undefined): WitnessReport[] => end?.witnesses.flatMap((w) => (w.report ? [{ ...w.report, ...(w.error && { error: w.error }) }] : [])) ?? []

/** The lore budgets a run used, marking those the config set; nothing for runs from before they were recorded. */
const budgetsLine = (bench: BenchRun): string => {
  const b = bench.loreBudgets
  if (!b) return ''
  const mark = (f: 'sceneTokens' | 'triggeredTokens' | 'loreLines', v: number) => `${v}${b.set.includes(f) ? ' (config)' : ''}`
  return ` Lore budgets: scene ${mark('sceneTokens', b.sceneTokens)}, triggered ${mark('triggeredTokens', b.triggeredTokens)}, lines ${mark('loreLines', b.loreLines)}.`
}

/** Where a run's code and content came from, as far as it recorded. */
const inputsLine = (bench: BenchRun): string => {
  const i = bench.inputs
  if (!i) return 'Inputs: not recorded (a run from before milestone 3.6), so comparisons can match it on scenario, repeat and seed only.'
  const source = i.source ? `source \`${i.source.commit.slice(0, 7)}\`${i.source.dirty ? ' with uncommitted changes' : ''}` : 'source unknown (no git)'
  return `Inputs: ${source}, pack content \`${i.pack}\`.`
}

/** A run as a readable report: the numbers first, then every scenario's turns, plans, beats and summaries. */
export function renderReport(content: Pack, bench: BenchRun): string {
  const repeats = bench.options.repeat > 1
  const names = namesOf(content, bench)
  return [
    `# Scene test bench — ${bench.label}`,
    '',
    `Run ${bench.startedAt}, pack \`${bench.pack}\` ${bench.packVersion}, prompts \`${bench.prompts}\`${repeats ? `, ${bench.options.repeat} repeats` : ''}. Models: ${Object.entries(bench.models).map(([role, model]) => `${role} \`${model}\``).join(', ')}.${budgetsLine(bench)}`,
    '',
    inputsLine(bench),
    '',
    `| ${STAT_HEADS.join(' | ')} |`,
    `|${STAT_HEADS.map(() => '---').join('|')}|`,
    ...bench.scenarios.map((run) => statRow(run, repeats)),
    '',
    '## Metrics',
    '',
    renderMetrics(metrics(bench.scenarios.map(metricInputOf)), (id) => names(bench.scenarios[0]?.location ?? '', id)),
    '',
    ...(bench.scenarios.some((run) => run.bookkeeping) ? ['## Bookkeeper', '', `| ${RECORD_HEADS.join(' | ')} |`, `|${RECORD_HEADS.map(() => '---').join('|')}|`, ...bench.scenarios.map((run) => recordRow(runName(run, repeats), run)), ''] : []),
    '## Tokens by role',
    '',
    renderTokens(bench.scenarios),
    '',
    ...bench.scenarios.map((run) => scenarioSection(names, run, repeats, bench.loreBudgets))
  ].join('\n')
}

/** Escapes a cell for a Markdown table. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, '<br>')

/**
 * Two runs side by side (director writer §10): what differs in their inputs, their numbers, metrics over the
 * scenario plays whose inputs match (milestone 3.6: same scenario, repeat and seed, and the same scenario content when
 * both runs recorded it), then each scenario they share, turn by turn, with the beats in two columns. Each run is
 * named as it recorded, not from whichever pack is loaded now.
 */
export function compareRuns(content: Pack, a: BenchRun, b: BenchRun): string {
  const namesA = namesOf(content, a)
  const namesB = namesOf(content, b)
  const c = comparability(a, b)
  const plays = a.scenarios.length + b.scenarios.length
  const lines = [
    `# Bench comparison: ${a.label} vs ${b.label}`,
    '',
    `- **A** — ${a.label} (${a.startedAt}): ${Object.entries(a.models).map(([r, m]) => `${r} \`${m}\``).join(', ')}.${budgetsLine(a)} ${inputsLine(a)}`,
    `- **B** — ${b.label} (${b.startedAt}): ${Object.entries(b.models).map(([r, m]) => `${r} \`${m}\``).join(', ')}.${budgetsLine(b)} ${inputsLine(b)}`,
    '',
    '## What differs between the runs',
    '',
    ...(c.unknown.length > 0 ? [`⚠ Run ${c.unknown.join(' and ')} recorded no inputs, so differences in code, pack content, scenarios and model settings can't be shown, and plays are matched on scenario, repeat and seed alone.`, ''] : []),
    ...(c.differences.length > 0 ? c.differences.map((d) => `- ${d}`) : ['- No recorded input differs.']),
    '',
    `Compared: ${c.matched.length} matching scenario plays.${c.left.length > 0 ? ` Left out of the shared metrics (${c.left.length} of ${plays} plays):` : ''}`,
    ...c.left.map((l) => `- ${l}`),
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
  // Metrics over the plays whose inputs match, so a scenario only one run played, or one that changed, doesn't skew the difference.
  lines.push('', '## Metrics (matching scenario plays)', '', compareMetrics(metrics(c.matched.map(([ra]) => metricInputOf(ra))), metrics(c.matched.map(([, rb]) => metricInputOf(rb)))))
  // Cost by role over the matching plays (milestone 4c: reported against the baseline, with no pass mark).
  lines.push('', '## Tokens by role (matching scenario plays)', '', '**A**', '', renderTokens(c.matched.map(([ra]) => ra)), '', '**B**', '', renderTokens(c.matched.map(([, rb]) => rb)))
  if (a.scenarios.some((s) => s.bookkeeping) || b.scenarios.some((s) => s.bookkeeping)) {
    lines.push('', '## Bookkeeper', '', `| Run | ${RECORD_HEADS.join(' | ')} |`, `|---|${RECORD_HEADS.map(() => '---').join('|')}|`)
    for (const id of ids) {
      for (const ra of a.scenarios.filter((s) => s.id === id && s.bookkeeping)) lines.push(`| A ${recordRow(runName(ra, repeats), ra)}`)
      for (const rb of b.scenarios.filter((s) => s.id === id && s.bookkeeping)) lines.push(`| B ${recordRow(runName(rb, repeats), rb)}`)
    }
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
    // Side by side, the first repeat of each; the numbers above cover all of them.
    const turns = Math.max(ra.turns.length, rb.turns.length)
    for (let i = 0; i < turns; i++) {
      const ta = ra.turns[i]
      const tb = rb.turns[i]
      lines.push(`### Turn ${i + 1}: ${ta?.input ?? tb?.input}`, '', '| A | B |', '|---|---|')
      const side = (names: Names, run: ScenarioRun, t: typeof ta, budgets?: BenchRun['loreBudgets']) =>
        t ? cell([...checkLines(t).map((line) => `🎲 ${line}`), ...shown(t).map((beat) => beatLine(names, locationOf(run, t), beat)), ...loreLines(t, budgets), t.rewrite ? `↻ rewritten (${t.findings.length} fixes)` : ''].filter(Boolean).join('\n\n')) : '—'
      lines.push(`| ${side(namesA, ra, ta, a.loreBudgets)} | ${side(namesB, rb, tb, b.loreBudgets)} |`, '')
    }
    const memories = (names: Names, run: ScenarioRun) => cell(allReports(run).map((r) => `**${names(run.location, r.id)}:** ${r.memory} (${delta(r.before, r.after)})`).join('\n\n') || '—')
    lines.push('### After the scene', '', '| A | B |', '|---|---|', `| ${memories(namesA, ra)} | ${memories(namesB, rb)} |`, '')
  }
  return lines.join('\n')
}
