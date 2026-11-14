import { firstName, traced, TracedError, type CallTrace, type Prompt } from '@engine/core'
import { entryById } from '@engine/codex'
import { memoryId, pointersOf } from '@engine/memory'
import { characterById, locationById, type Pack } from '@engine/pack'
import { daysSince, type GameState, type Memory } from '@engine/state'
import type { Summarize } from './endScene'

/**
 * Consolidation (memory §7; decided 2026-11-13): when a character has many older memories on one subject, a background
 * call merges them into one memory in their own voice ("All month, the player kept covering for me"). Normal and
 * Fleeting memories only, never Core; a consolidated memory isn't merged again (no nesting in milestone 4b). The result
 * is Normal, recalled and faded like one, and takes over its originals' subjects and learned-secret pointers; the
 * originals stay in the save, out of recall, linked to it. Runs after the daily upkeep, never on a player's turn.
 */

/** A subject memories can share: a topic (a codex entry or a secret), a person, the place, or the player. */
export interface Subject {
  kind: 'topic' | 'person' | 'place' | 'player'
  id: string
}

export interface Group {
  owner: string
  subject: Subject
  memories: Memory[]
}

/** Every subject a memory is about. The player is a subject apart: nearly every memory has them. */
export function subjectsOf(m: Memory): Subject[] {
  return [
    ...m.topics.map((id): Subject => ({ kind: 'topic', id })),
    ...m.about.filter((p) => p !== 'player').map((id): Subject => ({ kind: 'person', id })),
    ...(m.place ? [{ kind: 'place' as const, id: m.place }] : []),
    ...(m.about.includes('player') ? [{ kind: 'player' as const, id: 'player' }] : [])
  ]
}

/** Most specific first: a topic, then a person, then a place, then the player, who is in almost everything. */
const SPECIFIC = { topic: 0, person: 1, place: 2, player: 3 } as const
const key = (s: Subject) => `${s.kind}:${s.id}`

/**
 * The groups due for consolidation: per character, memories that may merge (Normal or Fleeting, still in recall,
 * not consolidated themselves, older than `consolidate.days`) sharing a subject, at least `consolidate.min` of them.
 * A memory joins one group per upkeep: the most specific subject first, then the largest group (decided in code).
 */
export function consolidationGroups(content: Pack, state: GameState): Group[] {
  const C = content.ruleset.memory.consolidate
  const eligible = state.memories.filter((m) => m.level !== 'core' && m.inRecall && !m.from && !m.mergedInto && daysSince(m.at, state.time) >= C.days)
  const groups: Group[] = []
  for (const owner of [...new Set(eligible.map((m) => m.owner))]) {
    const used = new Set<string>()
    const mine = eligible.filter((m) => m.owner === owner)
    for (;;) {
      const bySubject = new Map<string, { subject: Subject; memories: Memory[] }>()
      for (const m of mine.filter((x) => !used.has(x.id))) {
        for (const s of subjectsOf(m)) {
          const g = bySubject.get(key(s)) ?? { subject: s, memories: [] }
          g.memories.push(m)
          bySubject.set(key(s), g)
        }
      }
      const next = [...bySubject.values()]
        .filter((g) => g.memories.length >= C.min)
        .sort((a, b) => SPECIFIC[a.subject.kind] - SPECIFIC[b.subject.kind] || b.memories.length - a.memories.length || key(a.subject).localeCompare(key(b.subject)))[0]
      if (!next) break
      next.memories.forEach((m) => used.add(m.id))
      groups.push({ owner, subject: next.subject, memories: [...next.memories].sort((a, b) => a.at - b.at) })
    }
  }
  return groups
}

/** A subject in words: a codex entry's title, "Ada's secret", a person's or place's name, or the player's. */
export function subjectWords(content: Pack, state: GameState, s: Subject): string {
  if (s.kind === 'player') return state.player.name
  if (s.kind === 'person') return characterById(content, s.id)?.name ?? s.id
  if (s.kind === 'place') return locationById(content, s.id)?.name ?? s.id
  const entry = entryById(content.codex, s.id)
  if (entry) return entry.title
  const holder = characterById(content, s.id.slice(0, s.id.indexOf('.')))
  return holder ? `${firstName(holder.name)}'s secret` : s.id
}

/** The background call for one group. */
export function buildConsolidationPrompt(content: Pack, state: GameState, g: Group): Prompt {
  const c = characterById(content, g.owner)!
  const me = firstName(c.name)
  const words = content.ruleset.memory.consolidate.words
  return {
    system: `You merge several of one character's older memories on the same subject into one memory, as they would remember it now. Reply with only a JSON object: {"text": "..."}

- text: one or two sentences, at most ${words} words, past tense, third person, from ${me}'s point of view: what these moments add up to for ${me}, keeping what still matters (names, promises, debts, how they were treated). No new events.`,
    user: [`${me}'s memories about ${subjectWords(content, state, g.subject)}, oldest first:`, ...g.memories.map((m) => `- (${daysSince(m.at, state.time)} days ago) ${m.text}`)].join('\n')
  }
}

/** Reads the merged text: a JSON object's `text`, or plain prose. Empty when there is nothing usable. */
export function parseConsolidation(reply: string): string {
  const body = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const raw: unknown = JSON.parse(body.slice(start, end + 1))
      if (typeof raw === 'object' && raw !== null && typeof (raw as { text?: unknown }).text === 'string') return (raw as { text: string }).text.trim()
    } catch {
      return ''
    }
    return ''
  }
  return body
}

/**
 * Applies one merge: a Normal memory with the originals' people, place (when they share one), topics and learned-secret
 * pointers, linked to them; the originals leave recall and point to it. A text over the word cap, or none, is refused
 * and the originals stay as they were.
 */
export function applyConsolidation(content: Pack, state: GameState, g: Group, text: string): { state: GameState; made?: Memory; refused?: string } {
  const words = text.split(/\s+/).filter(Boolean).length
  if (words === 0) return { state, refused: 'no text' }
  if (words > content.ruleset.memory.consolidate.words) return { state, refused: `${words} words; the most is ${content.ruleset.memory.consolidate.words}` }
  const places = [...new Set(g.memories.map((m) => m.place))]
  const pointers = [...new Map(g.memories.flatMap(pointersOf).map((p) => [p.secret, p])).values()]
  const made: Memory = {
    id: memoryId(state.memories, g.owner),
    owner: g.owner,
    text,
    level: 'normal',
    ...(places.length === 1 && places[0] && { place: places[0] }),
    at: state.time,
    revisits: 0,
    fadeFrom: state.time,
    about: [...new Set(g.memories.flatMap((m) => m.about))],
    inRecall: true,
    topics: [...new Set(g.memories.flatMap((m) => m.topics))],
    from: g.memories.map((m) => m.id),
    ...(pointers.length > 0 && { inherited: pointers })
  }
  const ids = new Set(made.from)
  const memories = [...state.memories.map((m) => (ids.has(m.id) ? { ...m, inRecall: false, mergedInto: made.id } : m)), made]
  return { state: { ...state, memories }, made }
}

/** What a consolidation run did, for the logs. */
export interface ConsolidationTrace {
  at: string
  groups: { owner: string; subject: Subject; from: string[]; made?: string; refused?: string; error?: string }[]
  calls: CallTrace[]
}

/** Runs every due group, one call each, in turn; a failed or refused one leaves its originals as they were. */
export async function consolidate(content: Pack, state: GameState, call: Summarize, now: () => number = Date.now): Promise<{ state: GameState; trace: ConsolidationTrace }> {
  const calls: CallTrace[] = []
  const groups = consolidationGroups(content, state)
  const trace: ConsolidationTrace = { at: new Date(now()).toISOString(), groups: [], calls }
  let next = state
  try {
    for (const [i, g] of groups.entries()) {
      const prompt = buildConsolidationPrompt(content, next, g)
      const from = g.memories.map((m) => m.id)
      try {
        const reply = await traced(calls, { id: `consolidation:${state.time}:${i + 1}`, role: 'consolidation' }, prompt, now, () => call(prompt))
        const applied = applyConsolidation(content, next, g, parseConsolidation(reply))
        next = applied.state
        trace.groups.push({ owner: g.owner, subject: g.subject, from, ...(applied.made && { made: applied.made.id }), ...(applied.refused && { refused: applied.refused }) })
      } catch (error) {
        trace.groups.push({ owner: g.owner, subject: g.subject, from, error: (error as Error).message })
      }
    }
  } catch (error) {
    throw new TracedError((error as Error).message, calls)
  }
  return { state: next, trace }
}
