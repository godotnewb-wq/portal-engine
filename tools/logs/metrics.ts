import type { CallTrace } from '@engine/core'
import type { TurnTrace } from '@engine/scene'
import { currentFlags, RUBRIC, type FlagRecord, type ScoreRecord } from '@engine/review'
import type { ErrorRecord } from '@platform/logs'

/** What the metrics read from one session: its turns and calls, and the flags, scores and errors about them. */
export interface MetricInput {
  session: string
  turns: Omit<TurnTrace, 'calls'>[]
  calls: Omit<CallTrace, 'prompt'>[]
  /** Flags on this session's turns, from whichever session they were made in. */
  flags: FlagRecord[]
  scores: ScoreRecord[]
  errors: ErrorRecord[]
}

const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)
const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const count = <T extends string>(xs: T[]): Record<string, number> => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})
const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole)

/** Word n-grams of a text, lower-cased, punctuation dropped. */
export function ngrams(text: string, n = 4): string[] {
  const w = text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean)
  return w.length < n ? [] : [...Array(w.length - n + 1).keys()].map((i) => w.slice(i, i + n).join(' '))
}

/**
 * Phrases (word 4-grams) that turn up in more than one turn of the same scene: what the repetition tracker would
 * have caught. Counted once per turn they appear in, beyond the first.
 */
export function repeatedPhrases(turns: Omit<TurnTrace, 'calls'>[], n = 4): Map<string, number> {
  const seen = new Map<string, Set<string>>()
  for (const t of turns) {
    const grams = new Set(t.beats.flatMap((b) => ngrams(b.beat.text, n)))
    for (const g of grams) seen.set(`${t.sceneId}\u0000${g}`, new Set([...(seen.get(`${t.sceneId}\u0000${g}`) ?? []), t.turnId]))
  }
  const repeated = new Map<string, number>()
  for (const [key, ids] of seen) if (ids.size > 1) repeated.set(key.split('\u0000')[1]!, (repeated.get(key.split('\u0000')[1]!) ?? 0) + ids.size - 1)
  return repeated
}

/** The longest run of turns each character spent present without a speaking slot, per scene, worst case. */
/** How the lines of each turn follow one another (round 0, session 2026-11-06_2313_c313). */
export function exchangeShape(turns: Omit<TurnTrace, 'calls'>[]): { answeredBackPerTurn: number; sameSpeakerPerTurn: number } {
  const shapes = turns.map((t) => {
    const who = t.beats.flatMap((b) => (b.beat.kind === 'dialogue' ? [b.beat.speaker] : []))
    const runs = who.filter((w, i) => i === 0 || who[i - 1] !== w)
    return { back: runs.filter((w, i) => i >= 2 && runs[i - 2] === w).length, same: who.length - runs.length }
  })
  return { answeredBackPerTurn: avg(shapes.map((s) => s.back)), sameSpeakerPerTurn: avg(shapes.map((s) => s.same)) }
}

function longestSilence(turns: Omit<TurnTrace, 'calls'>[]): Record<string, number> {
  const worst: Record<string, number> = {}
  const run: Record<string, number> = {}
  let scene = ''
  for (const t of turns) {
    if (t.sceneId !== scene) {
      scene = t.sceneId
      for (const k of Object.keys(run)) run[k] = 0
    }
    const speaking = new Set(t.director.plan.speakers.map((s) => s.id))
    for (const c of t.cast.before.filter((c) => !c.departed)) {
      run[c.id] = speaking.has(c.id) ? 0 : (run[c.id] ?? 0) + 1
      worst[c.id] = Math.max(worst[c.id] ?? 0, run[c.id]!)
    }
  }
  return worst
}

export interface Metrics {
  sessions: number
  turns: number
  beats: number
  director: { unreadableRate: number; jsonRetried: number; correctionsPerTurn: number }
  writer: { rewriteRate: number; rewriteReasons: Record<string, number>; salvageRate: number; tagErrorsPerTurn: number; reshapedPerTurn: number; fallbackProfileRate: number }
  /**
   * `answeredBackPerTurn`: a speaker answered by someone who then gets answered in turn (A, B, A), the sign of a
   * conversation rather than speeches; `sameSpeakerPerTurn`: a line followed by another from the same speaker.
   */
  cast: { speakingShare: Record<string, number>; longestSilence: Record<string, number>; dialogueWords: Record<string, number>; answeredBackPerTurn: number; sameSpeakerPerTurn: number }
  checks: { total: number; skills: Record<string, number>; difficulties: Record<string, number>; successRate: number }
  pacing: { beatsPerTurn: number; wordsPerBeat: number }
  repetition: { repeatedPerTurn: number; top: [string, number][] }
  speed: { firstTextMs: number; turnMs: number; tokensPerTurn: number }
  flags: {
    beatsFlagged: number
    goodShare: number
    badShare: number
    byReason: Record<string, number>
    bySpeaker: Record<string, { good: number; meh: number; bad: number }>
    byKind: Record<string, { beats: number; bad: number }>
    bySource: Record<string, { beats: number; bad: number }>
    turnFlags: number
  }
  ai: {
    turnsScored: number
    items: Record<string, number>
    /** Of beats both a person and the scorer marked, how often they agreed on the rating. */
    agreement: { both: number; same: number; humanBadMarkedBad: number; humanBad: number; aiBadFlaggedBad: number; aiBad: number }
  }
  errors: Record<string, number>
}

/** The automatic metrics (milestone 2, B2), over one or more sessions. */
export function metrics(inputs: MetricInput[]): Metrics {
  const turns = inputs.flatMap((i) => i.turns.map((t) => ({ ...t, session: i.session })))
  const calls = inputs.flatMap((i) => i.calls)
  const beats = turns.flatMap((t) => t.beats.map((b) => ({ ...b, turn: t })))
  const dialogue = beats.filter((b) => b.beat.kind === 'dialogue')
  const checks = turns.flatMap((t) => t.checks)
  const writerCalls = calls.filter((c) => c.role === 'writer' || c.role === 'rewrite')
  const repeated = repeatedPhrases(turns)

  // Flags: the latest on each beat or turn, of this session's turns only.
  const flags = [...currentFlags(inputs.flatMap((i) => i.flags.filter((f) => f.turnSession === i.session))).values()]
  const beatFlags = flags.filter((f) => f.beat !== undefined)
  const beatOf = (f: FlagRecord) => beats.find((b) => b.turn.session === f.turnSession && b.turn.turnId === f.turnId && b.index === f.beat)
  const tally = <K extends string>(key: (f: FlagRecord) => K | undefined) => {
    const out: Record<string, { good: number; meh: number; bad: number }> = {}
    for (const f of beatFlags) {
      const k = key(f)
      if (!k) continue
      out[k] ??= { good: 0, meh: 0, bad: 0 }
      out[k][f.flag!.rating]++
    }
    return out
  }
  const byBeats = (key: (b: (typeof beats)[number]) => string) => {
    const out: Record<string, { beats: number; bad: number }> = {}
    for (const b of beats) {
      const k = key(b)
      out[k] ??= { beats: 0, bad: 0 }
      out[k].beats++
      const f = beatFlags.find((x) => x.turnSession === b.turn.session && x.turnId === b.turn.turnId && x.beat === b.index)
      if (f?.flag?.rating === 'bad') out[k].bad++
    }
    return out
  }

  // AI scores: the newest scorer version's record per turn.
  const latestScores = new Map<string, ScoreRecord>()
  for (const s of inputs.flatMap((i) => i.scores)) {
    const key = `${s.turnSession}/${s.turnId}`
    const had = latestScores.get(key)
    if (!had || s.scorer.version > had.scorer.version || (s.scorer.version === had.scorer.version && s.at > had.at)) latestScores.set(key, s)
  }
  const scores = [...latestScores.values()]
  const aiMarks = scores.flatMap((s) => s.beats.map((m) => ({ ...m, turnSession: s.turnSession, turnId: s.turnId })))
  const human = (m: { turnSession: string; turnId: string; beat: number }) => beatFlags.find((f) => f.turnSession === m.turnSession && f.turnId === m.turnId && f.beat === m.beat)
  const both = aiMarks.filter((m) => human(m))
  const humanBad = beatFlags.filter((f) => f.flag!.rating === 'bad')
  const aiBad = aiMarks.filter((m) => m.rating === 'bad')

  return {
    sessions: inputs.length,
    turns: turns.length,
    beats: beats.length,
    director: {
      unreadableRate: share(turns.filter((t) => t.director.read === 'unreadable').length, turns.length),
      jsonRetried: turns.filter((t) => t.director.read === 'json-retried').length,
      correctionsPerTurn: avg(turns.map((t) => t.director.corrections.length))
    },
    writer: {
      rewriteRate: share(turns.filter((t) => t.rewrite).length, turns.length),
      rewriteReasons: count(turns.flatMap((t) => [...new Set(t.findings.map((p) => p.kind))])),
      salvageRate: share(turns.filter((t) => t.rewrite?.salvage).length, turns.length),
      tagErrorsPerTurn: avg(turns.map((t) => t.tags.dropped.length)),
      reshapedPerTurn: avg(turns.map((t) => t.writer.reshaped?.length ?? 0)),
      fallbackProfileRate: share(writerCalls.filter((c) => c.restarted || c.meta?.declined).length, writerCalls.length)
    },
    cast: {
      speakingShare: Object.fromEntries(Object.entries(count(dialogue.map((b) => (b.beat as { speaker: string }).speaker))).map(([k, v]) => [k, share(v, dialogue.length)])),
      longestSilence: longestSilence(turns),
      ...exchangeShape(turns),
      dialogueWords: dialogue.reduce<Record<string, number>>((m, b) => {
        const who = (b.beat as { speaker: string }).speaker
        m[who] = (m[who] ?? 0) + words(b.beat.text)
        return m
      }, {})
    },
    checks: {
      total: checks.length,
      skills: count(checks.map((c) => c.skill)),
      difficulties: count(checks.map((c) => c.difficulty)),
      // No checks, no rate: NaN shows as a dash rather than a misleading 0%.
      successRate: checks.length === 0 ? Number.NaN : share(checks.filter((c) => c.degree !== 'failure').length, checks.length)
    },
    pacing: { beatsPerTurn: avg(turns.map((t) => t.beats.length)), wordsPerBeat: avg(beats.map((b) => words(b.beat.text))) },
    repetition: {
      repeatedPerTurn: share([...repeated.values()].reduce((a, b) => a + b, 0), turns.length),
      top: [...repeated.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
    },
    speed: {
      firstTextMs: avg(calls.filter((c) => c.role === 'writer' && c.firstTextMs !== undefined).map((c) => c.firstTextMs!)),
      turnMs: avg(turns.map((t) => t.cost.ms)),
      tokensPerTurn: avg(turns.flatMap((t) => (t.cost.tokens ? [t.cost.tokens.input + t.cost.tokens.output] : [])))
    },
    flags: {
      beatsFlagged: beatFlags.length,
      goodShare: share(beatFlags.filter((f) => f.flag!.rating === 'good').length, beats.length),
      badShare: share(humanBad.length, beats.length),
      byReason: count(beatFlags.flatMap((f) => f.flag!.reasons)),
      bySpeaker: tally((f) => {
        const b = beatOf(f)
        return b ? (b.beat.kind === 'dialogue' ? b.beat.speaker : 'narration') : undefined
      }),
      byKind: byBeats((b) => b.beat.kind),
      bySource: byBeats((b) => (b.salvaged ? 'salvaged' : b.source)),
      turnFlags: flags.filter((f) => f.beat === undefined).length
    },
    ai: {
      turnsScored: scores.length,
      items: Object.fromEntries(
        RUBRIC.flatMap((item) => {
          const xs = scores.flatMap((s) => s.items.filter((i) => i.id === item.id).map((i) => i.score))
          return xs.length > 0 ? [[`${item.id}. ${item.name}`, avg(xs)]] : []
        })
      ),
      agreement: {
        both: both.length,
        same: both.filter((m) => human(m)!.flag!.rating === m.rating).length,
        humanBadMarkedBad: humanBad.filter((f) => aiMarks.some((m) => m.turnSession === f.turnSession && m.turnId === f.turnId && m.beat === f.beat && m.rating === 'bad')).length,
        humanBad: humanBad.length,
        aiBadFlaggedBad: aiBad.filter((m) => human(m)?.flag?.rating === 'bad').length,
        aiBad: aiBad.length
      }
    },
    errors: count(inputs.flatMap((i) => i.errors.map((e) => e.where)))
  }
}

const pct = (x: number) => (Number.isNaN(x) ? '—' : `${Math.round(x * 100)}%`)
const num = (x: number) => (Number.isNaN(x) ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(2))
const list = (r: Record<string, number>, f: (x: number) => string = num) =>
  Object.entries(r)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k} ${f(v)}`)
    .join(', ') || '—'

/** The headline numbers, flat, for side-by-side comparison. Lower is better unless the name says otherwise. */
export function headline(m: Metrics): [string, number, 'lower' | 'higher' | 'info'][] {
  return [
    ['turns', m.turns, 'info'],
    ['director unreadable rate', m.director.unreadableRate, 'lower'],
    ['corrections / turn', m.director.correctionsPerTurn, 'lower'],
    ['rewrite rate', m.writer.rewriteRate, 'lower'],
    ['salvage rate', m.writer.salvageRate, 'lower'],
    ['tag errors / turn', m.writer.tagErrorsPerTurn, 'lower'],
    ['mixed lines split / turn', m.writer.reshapedPerTurn, 'lower'],
    ['fallback-profile rate', m.writer.fallbackProfileRate, 'lower'],
    ['check success rate', m.checks.successRate, 'info'],
    ['distinct skills', Object.keys(m.checks.skills).length, 'higher'],
    ['answered back / turn', m.cast.answeredBackPerTurn, 'higher'],
    ['same speaker twice / turn', m.cast.sameSpeakerPerTurn, 'lower'],
    ['beats / turn', m.pacing.beatsPerTurn, 'info'],
    ['words / beat', m.pacing.wordsPerBeat, 'info'],
    ['repeated phrases / turn', m.repetition.repeatedPerTurn, 'lower'],
    ['first text ms', m.speed.firstTextMs, 'lower'],
    ['turn ms', m.speed.turnMs, 'lower'],
    ['tokens / turn', m.speed.tokensPerTurn, 'lower'],
    ['beats flagged bad', m.flags.badShare, 'lower'],
    ['beats flagged good', m.flags.goodShare, 'higher'],
    ['errors', Object.values(m.errors).reduce((a, b) => a + b, 0), 'lower']
  ]
}

const isRate = (name: string) => /rate|flagged/.test(name)

/** Metrics as Markdown, names given through `nameOf` (character ids to names). */
export function renderMetrics(m: Metrics, nameOf: (id: string) => string = (id) => id): string {
  const named = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [nameOf(k), v]))
  const a = m.ai.agreement
  return [
    `| Metric | Value |`,
    `|---|---|`,
    ...headline(m).map(([name, value]) => `| ${name} | ${isRate(name) ? pct(value) : num(value)} |`),
    '',
    `- **Rewrite reasons:** ${list(m.writer.rewriteReasons)}`,
    `- **Speaking share:** ${list(named(m.cast.speakingShare), pct)}`,
    `- **Longest silence (turns):** ${list(named(m.cast.longestSilence))}`,
    `- **Dialogue words:** ${list(named(m.cast.dialogueWords))}`,
    `- **Checks:** ${m.checks.total}; skills ${list(m.checks.skills)}; difficulties ${list(m.checks.difficulties)}`,
    `- **Repeated phrases:** ${m.repetition.top.map(([g, n]) => `"${g}" ×${n}`).join(', ') || '—'}`,
    `- **Flags:** ${m.flags.beatsFlagged} beats, ${m.flags.turnFlags} turns; reasons ${list(m.flags.byReason)}`,
    `- **Flags by speaker:** ${Object.entries(m.flags.bySpeaker).map(([k, v]) => `${nameOf(k)} ${v.good}/${v.meh}/${v.bad} (good/meh/bad)`).join(', ') || '—'}`,
    `- **Bad flags by kind:** ${Object.entries(m.flags.byKind).map(([k, v]) => `${k} ${v.bad}/${v.beats}`).join(', ') || '—'}; **by source:** ${Object.entries(m.flags.bySource).map(([k, v]) => `${k} ${v.bad}/${v.beats}`).join(', ') || '—'}`,
    `- **AI scores:** ${m.ai.turnsScored} turns; ${Object.entries(m.ai.items).sort((x, y) => parseInt(x[0]) - parseInt(y[0])).map(([k, v]) => `${k} ${num(v)}`).join(', ') || '—'}`,
    `- **AI vs people:** same rating on ${a.same} of ${a.both} beats both marked; scorer marked bad ${a.humanBadMarkedBad} of ${a.humanBad} beats people flagged bad; people flagged bad ${a.aiBadFlaggedBad} of ${a.aiBad} beats the scorer marked bad`,
    `- **Errors:** ${list(m.errors)}`
  ].join('\n')
}

/** Two sets of metrics side by side with the change, the better direction marked. */
export function compareMetrics(a: Metrics, b: Metrics): string {
  const hb = headline(b)
  return [
    `| Metric | A | B | Change |`,
    `|---|---|---|---|`,
    ...headline(a).map(([name, va, better], i) => {
      const vb = hb[i]![1]
      const show = (x: number) => (isRate(name) ? pct(x) : num(x))
      const d = Number.isNaN(va) || Number.isNaN(vb) ? 0 : vb - va
      const mark = d === 0 || better === 'info' ? '' : (better === 'lower') === d < 0 ? ' ✓' : ' ✗'
      return `| ${name} | ${show(va)} | ${show(vb)} | ${d === 0 ? '—' : `${d > 0 ? '+' : ''}${isRate(name) ? `${Math.round(d * 100)} pts` : num(d)}${mark}`} |`
    })
  ].join('\n')
}
