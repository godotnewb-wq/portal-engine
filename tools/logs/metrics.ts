import type { CallTrace } from '@engine/core'
import { FUNCTION_WORDS, gestureKey, plainWords, planLines, statesFact, type TurnTrace } from '@engine/scene'
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

/** How the lines of each turn follow one another (round 0, session 2026-11-06_2313_c313). */
const trigrams = (text: string) => {
  const w = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
  return w.slice(2).map((_, i) => `${w[i]} ${w[i + 1]} ${w[i + 2]}`)
}

/**
 * How much of each line's wording comes straight from its planned point (session 2026-11-07_0013_714e: half).
 * A line is matched to its exchange line through the trace (`line:<n>`), or, in older logs, to its speaker's points.
 * On a `scene` turn (Milestone 5 task 6), a line is matched to its speaker's moment and the pressure on them: the
 * director's own wording. Not the facts they were offered, which a line is meant to state (decided in task 8, user:
 * with them the rate was 6%, without 0.6%).
 */
export function copiedFromPlan(turns: Omit<TurnTrace, 'calls'>[]): number {
  const shares = turns.flatMap((t) => {
    const scene = t.director.plan.scene
    const lines = planLines(t.director.plan)
    const plannedFor = (speaker: string, b: TurnTrace['beats'][number]): string => {
      if (scene) {
        const m = scene.moments.find((x) => x.who === speaker)
        return [m?.lands, m?.wants, ...scene.pressures.filter((x) => x.who === speaker).map((x) => x.text)].filter(Boolean).join(' ')
      }
      const n = b.plan.find((p) => p.startsWith('line:'))
      return n ? lines[Number(n.slice(5)) - 1]?.point ?? '' : lines.filter((l) => l.who === speaker).map((l) => l.point).join(' ')
    }
    return t.beats.flatMap((b) => {
      if (b.beat.kind !== 'dialogue') return []
      const point = plannedFor(b.beat.speaker, b)
      const said = trigrams(b.beat.text)
      if (!point || said.length === 0) return []
      const planned = new Set(trigrams(point))
      return [said.filter((g) => planned.has(g)).length / said.length]
    })
  })
  return shares.length === 0 ? Number.NaN : avg(shares)
}

/**
 * A turn's paragraphs as the writer wrote them: beats cut from the same line of the same reply. A paragraph belongs to
 * the first character who speaks in it, or to the narration. The `situation` writer writes a beat a line, so there a
 * paragraph is a beat.
 */
export function paragraphs(t: Omit<TurnTrace, 'calls'>): { who: string; text: string }[] {
  const out: { who: string; text: string; key: string }[] = []
  for (const b of t.beats) {
    const key = `${b.source}:${b.line}`
    const last = out.at(-1)
    if (last && last.key === key && b.line > 0) {
      last.text += ` ${b.beat.text}`
      if (last.who === 'narration' && b.beat.kind === 'dialogue') last.who = b.beat.speaker
    } else out.push({ key, who: b.beat.kind === 'dialogue' ? b.beat.speaker : 'narration', text: b.beat.text })
  }
  return out.map(({ who, text }) => ({ who, text }))
}

/**
 * How characters talk to each other (Milestone 5 task 6; redesign §11), from the paragraphs, so both pipelines count
 * alike: replies between characters (a character's lines right after another character's, not the player's), how
 * many of those open by picking up what they answer (naming its speaker, or a word of it in the first sentence), and
 * the longest run of paragraphs in a row by one speaker.
 */
export function conversation(turns: Omit<TurnTrace, 'calls'>[], nameOf: (id: string) => string = (id) => id): { repliesPerTurn: number; replyOpenerRate: number; longestRunPerTurn: number } {
  const content = (text: string) => new Set(plainWords(text).filter((w) => w.length > 3 && !FUNCTION_WORDS.has(w)))
  let replies = 0
  let openers = 0
  const shaped = turns.map((t) => {
    const spoken = paragraphs(t).filter((p) => p.who !== 'narration')
    let longest = 0
    let run = 0
    let n = 0
    spoken.forEach((p, i) => {
      const prev = spoken[i - 1]
      run = prev && prev.who === p.who ? run + 1 : 1
      longest = Math.max(longest, run)
      if (!prev || prev.who === p.who) return
      n++
      const first = p.text.split(/(?<=[.!?])\s/)[0] ?? p.text
      const theirs = content(prev.text)
      const picksUp = plainWords(first).includes(plainWords(nameOf(prev.who))[0] ?? '\u0000') || [...content(first)].some((w) => theirs.has(w))
      if (picksUp) openers++
    })
    replies += n
    return { n, longest }
  })
  return { repliesPerTurn: avg(shaped.map((s) => s.n)), replyOpenerRate: replies === 0 ? Number.NaN : share(openers, replies), longestRunPerTurn: avg(shaped.map((s) => s.longest)) }
}

/**
 * Facts said again within a scene (redesign §11; Milestone 5 task 6): a fact the plan offered in any turn of the scene
 * (a scene plan's pools, a situation move's `says`) that a line states in a turn after one where a line already stated
 * it, counted once per turn it comes back in. The same word-run test as the bookkeeper's stand-in (`statesFact`).
 */
export function factRepeats(turns: Omit<TurnTrace, 'calls'>[]): number {
  const byScene = new Map<string, Omit<TurnTrace, 'calls'>[]>()
  for (const t of turns) byScene.set(t.sceneId, [...(byScene.get(t.sceneId) ?? []), t])
  let repeats = 0
  for (const scene of byScene.values()) {
    const facts = new Map<string, string>()
    for (const t of scene) {
      const p = t.director.plan
      for (const pool of Object.values(p.scene?.pools ?? {})) for (const f of pool) facts.set(f.id, f.text)
      for (const m of p.moves ?? []) for (const x of m.says) facts.set(x.id ?? x.text, x.text)
    }
    const said = new Set<string>()
    for (const t of scene) {
      const lines = t.beats.flatMap((b) => (b.beat.kind === 'dialogue' ? [b.beat.text] : []))
      for (const [id, text] of facts) {
        if (!lines.some((l) => statesFact(text, l))) continue
        if (said.has(id)) repeats++
        said.add(id)
      }
    }
  }
  return repeats
}

export function exchangeShape(turns: Omit<TurnTrace, 'calls'>[]): { answeredBackPerTurn: number; sameSpeakerPerTurn: number } {
  const shapes = turns.map((t) => {
    const who = t.beats.flatMap((b) => (b.beat.kind === 'dialogue' ? [b.beat.speaker] : []))
    const runs = who.filter((w, i) => i === 0 || who[i - 1] !== w)
    // One planned line written as two beats, or line, action, line, is how a character talks, not a speech
    // (session 2026-11-07_0039_e46a). So with an exchange, a speech is the plan giving one speaker two lines in a row;
    // older plans, without one, are read from the beats.
    // A scene turn has no exchange; its own paragraphs say who spoke twice in a row (Milestone 5 task 6).
    const exchange = t.director?.plan?.scene ? undefined : t.director?.plan?.exchange
    const spoken = paragraphs(t).filter((p) => p.who !== 'narration').map((p) => p.who)
    const same = exchange ? exchange.filter((l, i) => i > 0 && exchange[i - 1]!.who === l.who).length : t.director?.plan?.scene ? spoken.filter((w, i) => i > 0 && spoken[i - 1] === w).length : who.length - runs.length
    return { back: runs.filter((w, i) => i >= 2 && runs[i - 2] === w).length, same }
  })
  return { answeredBackPerTurn: avg(shapes.map((s) => s.back)), sameSpeakerPerTurn: avg(shapes.map((s) => s.same)) }
}

/** The longest run of turns each character spent present without speaking, per scene, worst case. */
function longestSilence(turns: Omit<TurnTrace, 'calls'>[]): Record<string, number> {
  const worst: Record<string, number> = {}
  const run: Record<string, number> = {}
  let scene = ''
  for (const t of turns) {
    if (t.sceneId !== scene) {
      scene = t.sceneId
      for (const k of Object.keys(run)) run[k] = 0
    }
    // Who spoke, not who was planned to (Milestone 5 task 6): the same count on both pipelines.
    const speaking = new Set(t.beats.flatMap((b) => (b.beat.kind === 'dialogue' ? [b.beat.speaker] : [])))
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
  /**
   * `speakerReactionsPerTurn`: speakers the director also listed under `reactions`, dropped by validation; reported
   * apart (milestone 4a task 7) because they were most of all corrections and hid the ones that matter.
   * `otherCorrectionsPerTurn`: every other correction. `correctionsPerTurn` stays the total, for comparing older runs.
   */
  director: { unreadableRate: number; jsonRetried: number; correctionsPerTurn: number; speakerReactionsPerTurn: number; otherCorrectionsPerTurn: number }
  /** What the director's briefs cost a turn, in estimated tokens: always-on, and optional detail chosen (milestone 4a); absent from older logs. */
  briefs?: { recurringTokens: number; detailTokens: number; detailsPerTurn: number; cutPerTurn: number }
  writer: { rewriteRate: number; rewriteReasons: Record<string, number>; salvageRate: number; tagErrorsPerTurn: number; reshapedPerTurn: number; fallbackProfileRate: number }
  /**
   * `answeredBackPerTurn`: a speaker answered by someone who then gets answered in turn (A, B, A), the sign of a
   * conversation rather than speeches; `sameSpeakerPerTurn`: a line followed by another from the same speaker.
   */
  cast: {
    speakingShare: Record<string, number>
    longestSilence: Record<string, number>
    dialogueWords: Record<string, number>
    answeredBackPerTurn: number
    sameSpeakerPerTurn: number
    /** Milestone 5: replies between characters a turn, the share that pick up what they answer, the longest run by one speaker. */
    repliesPerTurn: number
    replyOpenerRate: number
    longestRunPerTurn: number
  }
  checks: { total: number; skills: Record<string, number>; difficulties: Record<string, number>; successRate: number }
  pacing: { beatsPerTurn: number; wordsPerBeat: number }
  /** Share of a line's three-word runs found in its planned point: the writer copying the director's notes. */
  copiedFromPlan: number
  /** `factRepeatsPerScene` (Milestone 5): facts the plan offered said again in a later turn of the scene. */
  repetition: { repeatedPerTurn: number; top: [string, number][]; factRepeatsPerScene: number }
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
    /** The mean over every score given (the milestone-4 plan's "rubric mean over every score"); NaN when none. */
    mean: number
    items: Record<string, number>
    /** Of beats both a person and the scorer marked, how often they agreed on the rating. */
    agreement: { both: number; same: number; humanBadMarkedBad: number; humanBad: number; aiBadFlaggedBad: number; aiBad: number }
  }
  /**
   * Relevance (scene system redesign.md §11): how often a speaker keeps a secret, how many lines use slang or
   * talk about the speaker's aim, gestures repeated within a scene, and how many characters speak a turn. Rates over
   * logs without usage counts (before redesign step 2) are NaN.
   */
  relevance: {
    liveSecretRate: number
    slangRate: number
    aimRate: number
    gestureRepeatsPerTurn: number
    /** Milestone 5: the same, per scene (the redesign's target is none twice). */
    gestureRepeatsPerScene: number
    speakersPerTurn: number
    slangBySpeaker: Record<string, number>
    aimBySpeaker: Record<string, number>
  }
  errors: Record<string, number>
}

/** Gestures that come back within a scene, per turn they come back in: the same character, the same first words. */
export function gestureRepeats(turns: Omit<TurnTrace, 'calls'>[]): number {
  const seen = new Map<string, Set<string>>()
  let repeats = 0
  for (const t of turns) {
    const keys = new Set((t.usage?.gestures ?? []).map((g) => `${g.who}\u0000${gestureKey(g.gesture)}`))
    const before = seen.get(t.sceneId) ?? new Set<string>()
    for (const k of keys) if (before.has(k)) repeats++
    seen.set(t.sceneId, new Set([...before, ...keys]))
  }
  return repeats
}

/** The automatic metrics (milestone 2, B2), over one or more sessions. */
/** A correction for a speaker the director also listed as a silent reaction (`validatePlan`'s wording). */
const isSpeakerReaction = (c: string) => /^dropped reaction for .*: they speak this beat$/.test(c)

export function metrics(inputs: MetricInput[]): Metrics {
  // A scene is one session's: the bench's repeat plays of a scenario share its scene id, so keyed on the id alone the
  // repeat metrics (phrases, gestures, facts, silences) counted play 2 echoing play 1 (Milestone 5 task 8, round 3:
  // the core set's three plays showed two to three times the full set's repeats, on both pipelines).
  const turns = inputs.flatMap((i) => i.turns.map((t) => ({ ...t, session: i.session, sceneId: `${i.session}\u0001${t.sceneId}` })))
  const briefed = turns.flatMap((t) => (t.brief ? [t.brief] : []))
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
      correctionsPerTurn: avg(turns.map((t) => t.director.corrections.length)),
      speakerReactionsPerTurn: avg(turns.map((t) => t.director.corrections.filter(isSpeakerReaction).length)),
      otherCorrectionsPerTurn: avg(turns.map((t) => t.director.corrections.filter((c) => !isSpeakerReaction(c)).length))
    },
    ...(briefed.length > 0 && {
      briefs: {
        recurringTokens: avg(briefed.map((b) => Object.values(b.recurring).reduce((n, x) => n + x, 0))),
        detailTokens: avg(briefed.map((b) => b.used)),
        detailsPerTurn: avg(briefed.map((b) => b.selected.length)),
        cutPerTurn: avg(briefed.map((b) => b.cut.length))
      }
    }),
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
      ...conversation(turns),
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
    copiedFromPlan: copiedFromPlan(turns),
    repetition: {
      repeatedPerTurn: share([...repeated.values()].reduce((a, b) => a + b, 0), turns.length),
      top: [...repeated.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10),
      factRepeatsPerScene: share(factRepeats(turns), new Set(turns.map((t) => t.sceneId)).size)
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
      mean: (() => {
        const all = scores.flatMap((s) => s.items.map((i) => i.score))
        return all.length > 0 ? all.reduce((a, b) => a + b, 0) / all.length : Number.NaN
      })(),
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
    relevance: relevanceOf(turns),
    errors: count(inputs.flatMap((i) => i.errors.map((e) => e.where)))
  }
}

/** The relevance metrics (redesign step 2) over a set of turns. */
export function relevanceOf(turns: Omit<TurnTrace, 'calls'>[]): Metrics['relevance'] {
  const slots = turns.flatMap((t) => t.director.plan.speakers)
  const counted = turns.filter((t) => t.usage)
  const lines = counted.flatMap((t) => t.beats.filter((b) => b.beat.kind === 'dialogue').map((b) => ({ t, b })))
  const linesBy = count(lines.map(({ b }) => (b.beat as { speaker: string }).speaker))
  const per = (hits: { speaker: string }[]) => Object.fromEntries(Object.entries(count(hits.map((h) => h.speaker))).map(([k, v]) => [k, share(v, linesBy[k] ?? 0)]))
  const slang = counted.flatMap((t) => t.usage!.slang)
  const aim = counted.flatMap((t) => t.usage!.aim)
  const rate = (n: number) => (counted.length === 0 ? Number.NaN : share(n, lines.length))
  return {
    liveSecretRate: share(slots.filter((s) => s.hiding).length, slots.length),
    slangRate: rate(slang.length),
    aimRate: rate(aim.length),
    gestureRepeatsPerTurn: counted.length === 0 ? Number.NaN : share(gestureRepeats(counted), counted.length),
    gestureRepeatsPerScene: counted.length === 0 ? Number.NaN : share(gestureRepeats(counted), new Set(counted.map((t) => t.sceneId)).size),
    speakersPerTurn: avg(turns.map((t) => new Set(t.beats.flatMap((b) => (b.beat.kind === 'dialogue' ? [b.beat.speaker] : []))).size)),
    slangBySpeaker: per(slang),
    aimBySpeaker: per(aim)
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
    ['speakers listed as reactions / turn', m.director.speakerReactionsPerTurn, 'lower'],
    ['other corrections / turn', m.director.otherCorrectionsPerTurn, 'lower'],
    ...(m.briefs
      ? ([
          ['brief always-on tokens / turn', m.briefs.recurringTokens, 'info'],
          ['brief detail tokens / turn', m.briefs.detailTokens, 'info'],
          ['brief details / turn', m.briefs.detailsPerTurn, 'info'],
          ['brief details cut / turn', m.briefs.cutPerTurn, 'info']
        ] as [string, number, 'info'][])
      : []),
    ['rewrite rate', m.writer.rewriteRate, 'lower'],
    ['salvage rate', m.writer.salvageRate, 'lower'],
    ['tag errors / turn', m.writer.tagErrorsPerTurn, 'lower'],
    ['mixed lines split / turn', m.writer.reshapedPerTurn, 'lower'],
    ['fallback-profile rate', m.writer.fallbackProfileRate, 'lower'],
    ['check success rate', m.checks.successRate, 'info'],
    ['distinct skills', Object.keys(m.checks.skills).length, 'higher'],
    ['answered back / turn', m.cast.answeredBackPerTurn, 'higher'],
    ['same speaker twice / turn', m.cast.sameSpeakerPerTurn, 'lower'],
    ['replies between characters / turn', m.cast.repliesPerTurn, 'higher'],
    ['reply opener rate', m.cast.replyOpenerRate, 'higher'],
    ['longest run by one speaker / turn', m.cast.longestRunPerTurn, 'info'],
    ['copied from plan rate', m.copiedFromPlan, 'lower'],
    ['speakers / turn', m.relevance.speakersPerTurn, 'info'],
    ['live secret rate', m.relevance.liveSecretRate, 'lower'],
    ['slang line rate', m.relevance.slangRate, 'lower'],
    ['aim line rate', m.relevance.aimRate, 'lower'],
    ['gesture repeats / turn', m.relevance.gestureRepeatsPerTurn, 'lower'],
    ['gesture repeats / scene', m.relevance.gestureRepeatsPerScene, 'lower'],
    ['beats / turn', m.pacing.beatsPerTurn, 'info'],
    ['words / beat', m.pacing.wordsPerBeat, 'info'],
    ['repeated phrases / turn', m.repetition.repeatedPerTurn, 'lower'],
    ['fact repeats / scene', m.repetition.factRepeatsPerScene, 'lower'],
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
    `- **Slang lines by speaker:** ${list(named(m.relevance.slangBySpeaker), pct)}; **aim lines by speaker:** ${list(named(m.relevance.aimBySpeaker), pct)}`,
    `- **Repeated phrases:** ${m.repetition.top.map(([g, n]) => `"${g}" ×${n}`).join(', ') || '—'}`,
    `- **Flags:** ${m.flags.beatsFlagged} beats, ${m.flags.turnFlags} turns; reasons ${list(m.flags.byReason)}`,
    `- **Flags by speaker:** ${Object.entries(m.flags.bySpeaker).map(([k, v]) => `${nameOf(k)} ${v.good}/${v.meh}/${v.bad} (good/meh/bad)`).join(', ') || '—'}`,
    `- **Bad flags by kind:** ${Object.entries(m.flags.byKind).map(([k, v]) => `${k} ${v.bad}/${v.beats}`).join(', ') || '—'}; **by source:** ${Object.entries(m.flags.bySource).map(([k, v]) => `${k} ${v.bad}/${v.beats}`).join(', ') || '—'}`,
    `- **AI scores:** ${m.ai.turnsScored} turns${Number.isNaN(m.ai.mean) ? '' : `, mean over every score ${num(m.ai.mean)}`}; ${Object.entries(m.ai.items).sort((x, y) => parseInt(x[0]) - parseInt(y[0])).map(([k, v]) => `${k} ${num(v)}`).join(', ') || '—'}`,
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
    }),
    // The AI scores (milestone 4c: the rubric is an acceptance check, so a comparison shows it), higher is better.
    ...(a.ai.turnsScored > 0 || b.ai.turnsScored > 0
      ? [['AI score, mean over every score', a.ai.mean, b.ai.mean] as const, ...[...new Set([...Object.keys(a.ai.items), ...Object.keys(b.ai.items)])].sort((x, y) => parseInt(x) - parseInt(y)).map((k) => [`AI score ${k}`, a.ai.items[k] ?? Number.NaN, b.ai.items[k] ?? Number.NaN] as const)].map(([name, va, vb]) => {
          const d = Number.isNaN(va) || Number.isNaN(vb) ? 0 : vb - va
          return `| ${name} | ${Number.isNaN(va) ? '—' : num(va)} | ${Number.isNaN(vb) ? '—' : num(vb)} | ${d === 0 ? '—' : `${d > 0 ? '+' : ''}${num(d)}${d > 0 ? ' ✓' : ' ✗'}`} |`
        })
      : [])
  ].join('\n')
}
