import { firstName } from '@engine/core'
import type { Character } from '@engine/characters'
import type { Beat, Scene } from '@engine/state'
import { characterById, type Pack } from '@engine/pack'
import type { ParsedReply } from './beats'
import type { Problem } from './checks'
import { presentCast } from './plan'

/**
 * The repetition tracker (claude/director-writer.md §8; claude/scene-system-redesign.md §5.4). Round 0 found slang in
 * a third to a half of some characters' lines and the same gesture in most turns (one character's jacket patch in ~60% of tram
 * turns), so code keeps a short list of what each character has used lately and gives it to the writer to avoid.
 */

/** How many recent turns count as "lately". */
export const RECENT_USE_TURNS = 2
/** Repeats of recently used words or gestures in one draft before it's sent back for a rewrite (tune). */
export const REPEAT_REWRITE = 2
/** Longest gesture phrase kept, in words. */
const GESTURE_WORDS = 8
/** Verbs after a name that are talk or being, not a gesture. */
const NOT_GESTURES = new Set(['says', 'asks', 'adds', 'answers', 'replies', 'is', 'was', 'has', 'had', 'does', 'did', 'seems', 'sounds'])

export interface RecentUse {
  slang: string[]
  gestures: string[]
}

/** A slang entry as words to find: "the book (the operator's manual)" is looked for as "the book". */
export const slangTerms = (c: Character): string[] => c.voice.slang.map((s) => s.replace(/\([^)]*\)/g, '').trim()).filter(Boolean)

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const has = (text: string, term: string) => new RegExp(`(^|[^\\p{L}])${escape(term)}($|[^\\p{L}])`, 'iu').test(text)

/** Slang terms of this character that a line uses. */
export const slangIn = (c: Character, text: string): string[] => slangTerms(c).filter((t) => has(text, t))

/** Gestures a narration beat gives this character: "Ada rubs the patch on her sleeve" → "rubs the patch on her sleeve". */
export function gesturesIn(c: Character, text: string): string[] {
  const name = escape(firstName(c.name))
  const out: string[] = []
  for (const m of text.matchAll(new RegExp(`\\b${name}(?:'s)?\\s+([a-z]+s)\\b([^.;:!?—]*)`, 'g'))) {
    if (NOT_GESTURES.has(m[1]!)) continue
    out.push(`${m[1]}${m[2]}`.trim().split(/\s+/).slice(0, GESTURE_WORDS).join(' ').replace(/[,]+$/, ''))
  }
  return out
}

/** What each character present used in the last few turns: slang in their own lines, gestures in narration. */
export function recentlyUsed(content: Pack, scene: Scene, turns = RECENT_USE_TURNS): Record<string, RecentUse> {
  const beats = scene.turns.slice(-turns).flatMap((t) => t.beats)
  const out: Record<string, RecentUse> = {}
  for (const id of presentCast(scene)) {
    const c = characterById(content, id)
    if (!c) continue
    const slang = [...new Set(beats.flatMap((b) => (b.kind === 'dialogue' && b.speaker === id ? slangIn(c, b.text) : [])))]
    const gestures = [...new Set(beats.flatMap((b) => (b.kind === 'narration' ? gesturesIn(c, b.text) : [])))]
    if (slang.length > 0 || gestures.length > 0) out[id] = { slang, gestures }
  }
  return out
}

/** The verb and the first longer word after it, which is what a repeat shares: "rubs the patch on her sleeve" → "rubs patch". */
export const gestureKey = (g: string) => {
  const [verb, ...rest] = g.toLowerCase().split(/\s+/)
  return [verb, rest.find((w) => w.length > 3)].filter(Boolean).join(' ')
}

/**
 * Recently used slang and gestures that come back in a draft. One repeat is let through (a word can come back for a
 * reason); from `REPEAT_REWRITE` on, the draft is sent back.
 */
export function repeatProblems(content: Pack, parsed: ParsedReply, recent: Record<string, RecentUse>): Problem[] {
  const hits: { beat: number; text: string }[] = []
  parsed.beats.forEach((b, i) => {
    for (const [id, used] of Object.entries(recent)) {
      const c = characterById(content, id)!
      if (b.kind === 'dialogue' && b.speaker === id) for (const t of slangIn(c, b.text).filter((t) => used.slang.includes(t))) hits.push({ beat: i + 1, text: t })
      if (b.kind === 'narration') {
        const old = new Set(used.gestures.map(gestureKey))
        for (const g of gesturesIn(c, b.text).filter((g) => old.has(gestureKey(g)))) hits.push({ beat: i + 1, text: `${firstName(c.name)} ${g}` })
      }
    }
  })
  if (hits.length < REPEAT_REWRITE) return []
  return hits.map((h) => ({ kind: 'repeated' as const, beat: h.beat, text: h.text, fix: `Beat ${h.beat} repeats "${h.text}", used in the last turns. Say or show it another way, or leave it out.` }))
}

/** What a turn's lines used, for the metrics: slang per dialogue beat, lines that talk about the speaker's aim, gestures. */
export interface Usage {
  slang: { beat: number; speaker: string; terms: string[] }[]
  aim: { beat: number; speaker: string }[]
  gestures: { beat: number; who: string; gesture: string }[]
}

/** Words in an aim long enough to mean something ("Keep every passenger in the car" → keep, every, passenger…). */
const aimWords = (aim: string) => [...new Set(aim.toLowerCase().match(/\p{L}{5,}/gu) ?? [])]

/**
 * Counts a turn's use of slang, of the speaker's aim for the scene (two or more of its longer words in one line, the
 * measure round 0 used), and of gestures, so the metrics can tell whether relevance in code works.
 */
export function usageOf(content: Pack, beats: Beat[]): Usage {
  const usage: Usage = { slang: [], aim: [], gestures: [] }
  const cast = new Map<string, Character>()
  const char = (id: string) => (cast.has(id) ? cast.get(id) : (cast.set(id, characterById(content, id)!), cast.get(id)))
  beats.forEach((b, i) => {
    if (b.kind === 'dialogue') {
      const c = char(b.speaker)
      if (!c) return
      const terms = slangIn(c, b.text)
      if (terms.length > 0) usage.slang.push({ beat: i + 1, speaker: c.id, terms })
      const line = b.text.toLowerCase()
      if (aimWords(c.agenda.current).filter((w) => line.includes(w)).length >= 2) usage.aim.push({ beat: i + 1, speaker: c.id })
    } else {
      for (const c of content.characters) for (const g of gesturesIn(c, b.text)) usage.gestures.push({ beat: i + 1, who: c.id, gesture: g })
    }
  })
  return usage
}
