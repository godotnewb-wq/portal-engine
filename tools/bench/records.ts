import type { CallTrace } from '@engine/core'
import type { Feeling } from '@engine/characters'
import type { Bookkeeping } from '@engine/state'
import type { TurnTrace } from '@engine/scene'
import { callsOf, type BookkeepingRun, type ScenarioRun } from './run'

/**
 * The bookkeeper's part of a bench report (milestone 4c task 4; milestone-4 plan Part 4c, Acceptance): what each turn
 * recorded, what fell back, the leaks, and the mismatches logged and never applied (what changed against the
 * director's `change`, moods against its `feels`, checks the prose didn't honor). Also tokens by role, against which
 * 4c's cost is reported with no pass mark.
 */

type Name = (id: string) => string

/** A turn's bookkeeper in a run, by the turn's id. */
export const bookkeepingOf = (run: ScenarioRun, turnId: string): BookkeepingRun | undefined => run.bookkeeping?.find((b) => b.turnId === turnId)

/** What the director felt for someone this turn: a speaker's or a reaction's `feels`. */
const planned = (t: TurnTrace, id: string): Feeling | undefined => t.director.plan.speakers.find((s) => s.id === id)?.feels ?? t.director.plan.reactions.find((r) => r.id === id)?.feels

/**
 * A mood the bookkeeper read that differs from the director's felt one: another family, or two or more steps of
 * intensity apart. Prose shows the masked surface, so some of these are expected; they are counted, never applied.
 */
export function moodMismatches(t: TurnTrace, records: Bookkeeping): { id: string; felt: Feeling; read: Feeling }[] {
  return records.moods.flatMap((m) => {
    const felt = planned(t, m.id)
    return felt && (felt.family !== m.feeling.family || Math.abs(felt.intensity - m.feeling.intensity) >= 2) ? [{ id: m.id, felt, read: m.feeling }] : []
  })
}

/** Whether one of the director's `change` and the bookkeeper's `changed` says something changed and the other doesn't. */
const oneSided = (t: TurnTrace, records: Bookkeeping) => !!t.director.plan.change?.trim() !== !!records.changed?.trim()

/** A scenario's records in numbers. */
export function recordStats(run: ScenarioRun) {
  const turns = run.turns.flatMap((t) => {
    const b = bookkeepingOf(run, t.turnId)
    return b ? [{ t, b }] : []
  })
  const sum = (f: (x: (typeof turns)[number]) => number) => turns.reduce((n, x) => n + f(x), 0)
  return {
    turns: turns.length,
    failed: turns.filter(({ b }) => b.records.unaudited && !b.late).length,
    late: turns.filter(({ b }) => b.late).length,
    out: sum(({ b }) => b.records.out.length),
    leaks: sum(({ b }) => b.records.leaks.length),
    guesses: sum(({ b }) => b.records.guesses.length),
    around: sum(({ b }) => (b.records.around ?? []).length),
    unresolved: sum(({ b }) => b.records.unresolved.length),
    changed: turns.filter(({ t, b }) => !b.records.unaudited && oneSided(t, b.records)).length,
    moods: sum(({ t, b }) => moodMismatches(t, b.records).length),
    unhonored: sum(({ b }) => b.records.checks.filter((c) => !c.honored).length),
    refused: sum(({ b }) => b.records.refused.length)
  }
}

export const RECORD_HEADS = ['Scenario', 'Turns recorded', 'Failed', 'Late', 'Came out', 'Leaks', 'Guesses', 'Talked around', 'Unresolved', 'Changed vs change', 'Mood mismatches', 'Checks not honored', 'Refused']

export const recordRow = (label: string, run: ScenarioRun): string => {
  const s = recordStats(run)
  return `| ${label} | ${s.turns} | ${s.failed} | ${s.late} | ${s.out} | ${s.leaks} | ${s.guesses} | ${s.around} | ${s.unresolved} | ${s.changed} | ${s.moods} | ${s.unhonored} | ${s.refused} |`
}

const feeling = (f: Feeling) => `${f.shade} (${f.family}) ${f.intensity}`
const at = (x: { at: 'player' | number }) => (x.at === 'player' ? "the player's words" : `line ${x.at}`)

/** One turn's records, as the report shows them under the turn. */
export function recordLines(name: Name, t: TurnTrace, b: BookkeepingRun | undefined): string[] {
  if (!b) return []
  const r = b.records
  const who = (id: string) => (id === 'player' ? 'the player' : id === 'narration' ? 'the narration' : name(id))
  return [
    r.source === 'plan' ? `⚠ plan-based (unaudited): ${b.late ? 'the turn stopped waiting' : 'the call failed'}${b.error ? ` — ${b.error}` : ''}` : 'Recorded by the bookkeeper.',
    ...r.out.map((o) => `Came out (${o.how}): \`${o.secret}\` by ${who(o.by)}, ${at(o)}: “${o.words}” → ${o.to.map(name).join(', ') || 'no one else'}`),
    ...r.leaks.map((l) => `⚠ Leak: \`${l.secret}\` by ${who(l.by)}, ${at(l)}: “${l.words}”${l.why ? ` (${l.why})` : ''}`),
    ...r.guesses.map((g) => `Guess: \`${g.secret}\` by ${who(g.by)}, ${at(g)}: “${g.words}”`),
    ...(r.around ?? []).map((a) => `Talked around: \`${a.secret}\` by ${who(a.by)}, ${at(a)}: “${a.words}”`),
    ...r.unresolved.map((u) => `Unresolved: \`${u.secret}\` by ${who(u.by)}, ${at(u)}: “${u.words}”${u.why ? ` (${u.why})` : ''}`),
    ...r.new.map((n) => `New detail (${who(n.by)}): ${n.text}`),
    `Changed: ${r.changed || '(nothing)'} · director's change: ${t.director.plan.change || '(none)'}`,
    ...moodMismatches(t, r).map((m) => `Mood: ${name(m.id)} felt ${feeling(m.felt)}, read as ${feeling(m.read)}`),
    ...r.checks.filter((c) => !c.honored).map((c) => `Check not honored: ${c.id}${c.note ? ` — ${c.note}` : ''}`),
    ...r.refused.map((x) => `Refused: ${x}`)
  ]
}

/** The roles a turn's calls play, and those of a scene's end, for tokens by role. */
const TURN_ROLES = ['director', 'writer', 'rewrite', 'bookkeeper'] as const
const END_ROLES = ['relationship', 'memory', 'summary', 'ties'] as const

const tokens = (calls: CallTrace[]) => ({
  calls: calls.length,
  input: calls.reduce((n, c) => n + (c.meta?.usage?.input ?? 0), 0),
  output: calls.reduce((n, c) => n + (c.meta?.usage?.output ?? 0), 0)
})

/** Scene ends in these runs: one per scene that closed. */
const sceneEnds = (runs: ScenarioRun[]) => runs.reduce((n, r) => n + (r.scenes ? r.scenes.filter((s) => s.sceneEnd).length : r.sceneEnd ? 1 : 0), 0)

/**
 * Tokens by role (Part 4c, Acceptance: cost reported against run 3, with no pass mark): per turn for the turn's
 * calls, per scene end for the end's. Older runs have no bookkeeper and may have the tie check and one summary a
 * witness (`ties`, `summary`). Zeros where the provider reported no usage.
 */
export function tokensByRole(runs: ScenarioRun[]): { role: string; calls: number; input: number; output: number; per: number; unit: 'turn' | 'scene end' }[] {
  const calls = runs.flatMap(callsOf)
  const turns = runs.reduce((n, r) => n + r.turns.length, 0)
  const ends = sceneEnds(runs)
  const row = (role: string, unit: 'turn' | 'scene end', count: number) => {
    const t = tokens(calls.filter((c) => c.role === role))
    return t.calls > 0 ? [{ role, ...t, per: count > 0 ? Math.round((t.input + t.output) / count) : 0, unit }] : []
  }
  return [...TURN_ROLES.flatMap((r) => row(r, 'turn', turns)), ...END_ROLES.flatMap((r) => row(r, 'scene end', ends))]
}

export function renderTokens(runs: ScenarioRun[]): string {
  const rows = tokensByRole(runs)
  if (rows.length === 0) return 'No calls.'
  const total = (unit: 'turn' | 'scene end') => rows.filter((r) => r.unit === unit).reduce((n, r) => n + r.per, 0)
  return [
    '| Role | Calls | Input tokens | Output tokens | Per |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.role} | ${r.calls} | ${r.input} | ${r.output} | ${r.per} a ${r.unit} |`),
    '',
    `All roles: ${total('turn')} tokens a turn, ${total('scene end')} a scene end.`
  ].join('\n')
}
