import type { Beat } from '@engine/state'
import { plainName } from '@engine/core'

/**
 * The writer's output format: one beat per line, `NARRATION: …` or `Name: …`, with hidden tags in square brackets
 * anywhere (narrator-scene-engine §5). Tag grammar:
 *   [Name: EXPRESSION smirk]   [Name: COMFORT 2 too loud]   [Name: MOOD wary]   [LEAVES: Name]   [END SCENE]
 */
export const NARRATION = 'NARRATION'

/** Someone a line or tag can name. `kind` says what a beat by them is. */
export interface Speaker {
  id: string
  names: string[]
  kind: 'cast' | 'walk-on' | 'player'
  /** How narration names them ("Ada", "the porter"); by default their second name. */
  display?: string
}

export interface Tags {
  expressions: Record<string, string>
  comfort: Record<string, { level: number; reason: string }>
  moods: Record<string, string>
  leaves: string[]
  ended: boolean
}

export interface ParsedReply {
  beats: Beat[]
  /** For each beat, its line in the raw reply (1-based), so a logged beat can be traced to what the model wrote. */
  lines: number[]
  tags: Tags
  /** Speaker names written on dialogue lines that match no one here. */
  unknownSpeakers: string[]
  /** Tags that didn't parse or named no one here; dropped. */
  droppedTags: string[]
  /** Raw lines (1-based) where a dialogue line mixed speech and action and code split it into beats. */
  reshaped: number[]
}

const TAG = /\[([^\]\n]*)\]/g
const LINE = /^\s*(?:[*_]{1,2})?([^:*_[\]\n"“]{1,40}?)(?:[*_]{1,2})?\s*:\s*(?:[*_]{1,2})?\s*(.+)$/
const NARRATOR_NAMES = ['narration', 'narrator', 'narrative']

function who(written: string, speakers: Speaker[]): Speaker | undefined {
  const asked = plainName(written)
  return speakers.find((s) => s.names.some((n) => plainName(n) === asked))
}

/** Removes quote marks and stray emphasis wrapping a whole line. */
function clean(text: string): string {
  let t = text.trim().replace(/^[*_]+|[*_]+$/g, '').trim()
  if (/^["“].*["”]$/.test(t) && !/["”].*["“]/.test(t.slice(1, -1))) t = t.slice(1, -1).trim()
  return t
}

function parseTag(body: string, speakers: Speaker[], tags: Tags, dropped: string[]): void {
  const raw = `[${body}]`
  if (/^\s*END[\s_-]*SCENE\s*$/i.test(body)) {
    tags.ended = true
    return
  }
  const leaves = body.match(/^\s*LEAVES?\s*:\s*(.+?)\s*$/i)
  if (leaves) {
    const s = who(leaves[1]!, speakers)
    if (s?.kind === 'cast') tags.leaves.push(s.id)
    else dropped.push(raw)
    return
  }
  const named = body.match(/^\s*([^:]+?)\s*:\s*(EXPRESSION|COMFORT|MOOD)\s*:?\s*(.*?)\s*$/i)
  const s = named ? who(named[1]!, speakers) : undefined
  if (!named || s?.kind !== 'cast') {
    dropped.push(raw)
    return
  }
  const kind = named[2]!.toUpperCase()
  const value = named[3]!
  if (kind === 'EXPRESSION' && value) tags.expressions[s.id] = value.toLowerCase().split(/[\s,;]+/)[0]!
  else if (kind === 'MOOD' && value) tags.moods[s.id] = value
  else if (kind === 'COMFORT') {
    const m = value.match(/^([1-5])\b\s*(.*)$/)
    if (m) tags.comfort[s.id] = { level: Number(m[1]), reason: m[2]!.replace(/^[-–—,:]\s*/, '') }
    else dropped.push(raw)
  } else dropped.push(raw)
}

const QUOTED = /(["“])([^"”\n]*)(["”]|$)/g
const PRONOUN_START = /^(?:He|She)\b/
/** An unquoted line that opens like this is about the speaker, not said by them ("Ada: She sets three cups down"). */
const ACTION_START = /^(?:He|She|They|His|Her|Their)\b/
/** "she says," between two quoted parts is attribution, not an action worth its own beat. */
const SPEECH_TAG = /^(?:\S+\s+){0,2}(?:says|said|adds|asks|replies|mutters|murmurs|whispers|continues|goes on)\b[^.!?]*$/i
/** A capitalized word ending in -s followed by one of these is a verb missing its subject ("Wipes the slate"). */
const OBJECT_WORDS = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'its', 'my', 'your', 'at', 'to', 'toward', 'towards', 'into', 'onto', 'up', 'down', 'out', 'off', 'over', 'back', 'away', 'through', 'across', 'without'])
const NOT_VERBS = new Set(['his', 'its', 'this', 'thus', 'yes', 'as', 'us', 'was', 'is', 'perhaps', 'always', 'sometimes', 'besides', 'unless', 'plus', 'towards', 'across'])

const displayName = (s: Speaker) => s.display ?? s.names[1] ?? s.id

/** Gives an action cut out of a dialogue line its subject, so the beat reads on its own: "wipes the slate" → "Ada wipes the slate". */
function withSubject(action: string, s: Speaker): string {
  const name = displayName(s)
  const capital = name.charAt(0).toUpperCase() + name.slice(1)
  if (PRONOUN_START.test(action)) return action.replace(PRONOUN_START, capital)
  if (/^\p{Ll}/u.test(action)) return `${capital} ${action}`
  const [first = '', second = ''] = action.split(/\s+/)
  const lower = first.toLowerCase()
  if (/^\p{Lu}\p{Ll}+s$/u.test(first) && !NOT_VERBS.has(lower) && OBJECT_WORDS.has(second.toLowerCase())) {
    return `${capital} ${lower}${action.slice(first.length)}`
  }
  return action
}

/**
 * One character's line as beats: what they say, and what they do, never both in one beat (milestone 2, round 0 F1).
 * The writer is asked for that form; this keeps a line that mixes them readable without spending a rewrite on it.
 */
function dialogueBeats(raw: string, s: Speaker): Beat[] {
  const text = raw.trim()
  const quotes = [...text.matchAll(QUOTED)]
  if (quotes.length === 0) {
    const plain = clean(text)
    if (!plain) return []
    // The line pattern has already taken an opening asterisk, so a closing one is what's left of *an action*.
    const emphasized = /^[*_]|[*_]$/.test(text)
    const own = s.names.some((n) => plain.toLowerCase().startsWith(`${n.toLowerCase()} `))
    if (emphasized || own || ACTION_START.test(plain)) return [{ kind: 'narration', text: withSubject(plain, s) }]
    return [{ kind: 'dialogue', speaker: s.id, text: plain }]
  }
  const parts: Array<{ said: boolean; text: string }> = []
  let at = 0
  const between = (t: string) => {
    const action = t.replace(/[*_]+/g, '').trim().replace(/^[,;:—–-]+\s*|\s*[,;:—–-]+$/g, '').trim()
    if (!/\p{L}/u.test(action)) return
    if (SPEECH_TAG.test(action) && action.split(/\s+/).length <= 6) return
    parts.push({ said: false, text: withSubject(action, s) })
  }
  for (const q of quotes) {
    between(text.slice(at, q.index))
    const said = q[2]!.trim()
    const last = parts.at(-1)
    if (said && last?.said) last.text = `${last.text} ${said}`
    else if (said) parts.push({ said: true, text: said })
    at = q.index! + q[0].length
  }
  between(text.slice(at))
  return parts.map((p): Beat => (p.said ? { kind: 'dialogue', speaker: s.id, text: p.text } : { kind: 'narration', text: p.text }))
}

/** Reads the writer's reply into beats and tags. Lenient: an unlabelled line is narration. */
export function parseReply(reply: string, speakers: Speaker[]): ParsedReply {
  const tags: Tags = { expressions: {}, comfort: {}, moods: {}, leaves: [], ended: false }
  const droppedTags: string[] = []
  const unknownSpeakers: string[] = []
  const reshaped: number[] = []
  // Thinking is blanked rather than cut, keeping its newlines, so line numbers still match the raw reply.
  const withoutThinking = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, (m) => m.replace(/[^\n]/g, ''))
  for (const m of withoutThinking.matchAll(TAG)) parseTag(m[1]!, speakers, tags, droppedTags)

  const beats: Beat[] = []
  const lines: number[] = []
  const push = (beat: Beat, n: number) => {
    beats.push(beat)
    lines.push(n)
  }
  for (const [i, line] of withoutThinking.replace(TAG, '').split(/\r?\n/).entries()) {
    const n = i + 1
    if (line.trim().length === 0 || /^\s*(?:```|---+)\s*$/.test(line)) continue
    const m = line.match(LINE)
    const label = m?.[1]?.trim()
    if (m && label && NARRATOR_NAMES.includes(plainName(label))) {
      const text = clean(m[2]!)
      if (text) push({ kind: 'narration', text }, n)
      continue
    }
    if (m && label) {
      const s = who(label, speakers)
      const text = clean(m[2]!)
      if (!text) continue
      if (s) {
        const split = dialogueBeats(m[2]!, s)
        if (split.length !== 1 || split[0]!.kind !== 'dialogue') reshaped.push(n)
        for (const beat of split) push(beat, n)
      } else {
        // A colon inside ordinary narration ("One rule: never ask.") is not a speaker; only a short, name-like label is.
        if (/^[\p{Lu}][\p{L}' .-]{0,30}$/u.test(label) && label.split(/\s+/).length <= 3) {
          unknownSpeakers.push(label)
          push({ kind: 'dialogue', speaker: label, text }, n)
        } else push({ kind: 'narration', text: clean(line) }, n)
      }
      continue
    }
    push({ kind: 'narration', text: clean(line) }, n)
  }
  return { beats, lines, tags, unknownSpeakers: [...new Set(unknownSpeakers)], droppedTags, reshaped }
}

/** While a reply streams in, only lines that have ended are beats; the last one may still be growing. */
export function finishedPart(streamed: string): string {
  const end = streamed.lastIndexOf('\n')
  return end < 0 ? '' : streamed.slice(0, end)
}
