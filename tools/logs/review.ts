import type { Pack } from '@engine/pack'
import { currentFlags, type FlagRecord, type Rating } from '@engine/review'
import type { SessionLog, TurnRecord } from '@platform/logs'
import { namer, sceneLocation } from './load'
import { latestScores } from './transcript'

export interface FlagFilter {
  rating?: Rating
  reason?: string
  /** A character id or name; "narration" for narration beats. */
  speaker?: string
  /** Include beats the AI scorer marked, labeled as such. */
  ai?: boolean
}

/** What a beat was meant to do, from the plan items it carries out: the speaker's brief, the reaction, the walk-on line. */
function brief(turn: TurnRecord, items: string[], nameOf: (id: string) => string): string {
  const p = turn.director.plan
  return items
    .map((item) => {
      const [kind, id] = item.split(':') as [string, string]
      if (kind === 'speaker') {
        const s = p.speakers.find((x) => x.id === id)
        return s ? `${nameOf(id)}'s brief: ${s.intent}${s.point ? `; point: ${s.point}` : ''}${s.mood ? ` (mood: ${s.mood})` : ''}${s.hiding ? `; hiding ${s.hiding}, ${s.approach ?? 'deflect'}` : ''}` : ''
      }
      if (kind === 'reaction') return `${nameOf(id)}'s reaction: ${p.reactions.find((r) => r.id === id)?.beat ?? ''}`
      if (kind === 'walk-on') return `walk-on ${nameOf(id)}: ${p.walk_ons.find((w) => w.id === id)?.line ?? ''}`
      if (kind === 'check') return `check ${id}: ${turn.checks.find((c) => c.id === id)?.line ?? 'not rolled'}`
      return 'narration'
    })
    .filter(Boolean)
    .join('; ')
}

/**
 * Every flagged beat and turn, with its context: the player's input, the brief from the plan the beat carried out,
 * and the beats around it (milestone 2, A4). Where findings for a tuning round start.
 */
export function renderFlags(content: Pack, logs: { log: SessionLog; flags: FlagRecord[] }[], filter: FlagFilter = {}): string {
  const out: string[] = []
  let shown = 0
  for (const { log, flags } of logs) {
    const standing = [...currentFlags(flags).values()].map((f) => ({ ...f, by: 'person' as const }))
    const ai = filter.ai
      ? [...latestScores(log.scores).values()].flatMap((s) =>
          s.beats.map((m) => ({ turnSession: s.turnSession, turnId: s.turnId, beat: m.beat, flag: { rating: m.rating, reasons: m.reasons, note: m.note }, by: 'AI' as const }))
        )
      : []
    for (const f of [...standing, ...ai]) {
      const turn = log.turns.find((t) => t.turnId === f.turnId)
      if (!turn) continue
      const nameOf = namer(content, sceneLocation(log, turn.sceneId))
      const beat = f.beat !== undefined ? turn.beats.find((b) => b.index === f.beat) : undefined
      const speaker = beat ? (beat.beat.kind === 'dialogue' ? beat.beat.speaker : 'narration') : undefined
      if (filter.rating && f.flag.rating !== filter.rating) continue
      if (filter.reason && !f.flag.reasons.some((r) => r === filter.reason)) continue
      if (filter.speaker && !(speaker && [speaker, nameOf(speaker)].some((n) => n.toLowerCase() === filter.speaker!.toLowerCase()))) continue
      shown++
      out.push(
        `## ${f.by === 'AI' ? '🤖 AI: ' : ''}${f.flag.rating.toUpperCase()} — ${beat ? `beat ${f.beat}${speaker ? ` (${nameOf(speaker)})` : ''}` : 'whole turn'} · \`${log.session.id}\` turn ${turn.turn}`,
        '',
        f.flag.reasons.length > 0 ? `Reasons: ${f.flag.reasons.join(', ')}` : '',
        f.flag.note ? `Note: “${f.flag.note}”` : '',
        `**You:** ${turn.input}`,
        beat ? `*${brief(turn, beat.plan, nameOf)}* (${beat.source}${beat.salvaged ? ', salvaged' : ''}, line ${beat.line})` : `*Plan: ${turn.director.plan.speakers.map((s) => `${nameOf(s.id)} — ${s.intent}`).join('; ')}*`,
        turn.checks.length > 0 ? `🎲 ${turn.checks.map((c) => c.line).join(' · ')}` : '',
        '',
        ...turn.beats
          .filter((b) => !beat || Math.abs(b.index - beat.index) <= 1)
          .map((b) => `${b === beat ? '**→**' : '   '} ${b.index}. ${b.beat.kind === 'dialogue' ? `${nameOf(b.beat.speaker)}: ` : ''}${b.beat.text}`),
        ''
      )
    }
  }
  return [`# Flags (${shown})`, '', ...out.filter((l, i, all) => l !== '' || all[i - 1] !== '')].join('\n')
}

/** A seeded shuffle, so a blind test can be rebuilt with its key. */
function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs]
  let s = seed >>> 0 || 1
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/**
 * The blind voice test (milestone 2, B3): lines of dialogue by the cast, without names or context, in shuffled
 * order; the reader names who says each. The key is kept separately.
 */
export function blindTest(content: Pack, log: SessionLog, count = 10, seed = 1): { test: string; key: string } {
  const lines = log.turns.flatMap((t) =>
    t.beats.flatMap((b) => (b.beat.kind === 'dialogue' && t.cast.before.some((c) => c.id === (b.beat as { speaker: string }).speaker) ? [{ speaker: b.beat.speaker, text: b.beat.text, where: `${t.turnId} beat ${b.index}` }] : []))
  )
  const picked = shuffle(lines, seed).slice(0, count)
  const nameOf = namer(content)
  const cast = [...new Set(log.turns.flatMap((t) => t.cast.before.map((c) => c.id)))].map(nameOf).sort()
  return {
    test: [`# Blind voice test \`${log.session.id}\``, '', `Who says each line? The cast: ${cast.join(', ')}.`, '', ...picked.map((l, i) => `${i + 1}. “${l.text}”`), ''].join('\n'),
    key: [`# Answer key \`${log.session.id}\` (seed ${seed})`, '', ...picked.map((l, i) => `${i + 1}. ${nameOf(l.speaker)} — ${l.where}`), '', `Target: 8 of ${picked.length} right.`, ''].join('\n')
  }
}
