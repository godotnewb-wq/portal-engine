import type { Beat } from '../model'
import { plainName } from './names'

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
  tags: Tags
  /** Speaker names written on dialogue lines that match no one here. */
  unknownSpeakers: string[]
  /** Tags that didn't parse or named no one here; dropped. */
  droppedTags: string[]
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

/** Reads the writer's reply into beats and tags. Lenient: an unlabelled line is narration. */
export function parseReply(reply: string, speakers: Speaker[]): ParsedReply {
  const tags: Tags = { expressions: {}, comfort: {}, moods: {}, leaves: [], ended: false }
  const droppedTags: string[] = []
  const unknownSpeakers: string[] = []
  const withoutThinking = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  for (const m of withoutThinking.matchAll(TAG)) parseTag(m[1]!, speakers, tags, droppedTags)

  const beats: Beat[] = []
  for (const line of withoutThinking.replace(TAG, '').split(/\r?\n/)) {
    if (line.trim().length === 0 || /^\s*(?:```|---+)\s*$/.test(line)) continue
    const m = line.match(LINE)
    const label = m?.[1]?.trim()
    if (m && label && NARRATOR_NAMES.includes(plainName(label))) {
      const text = clean(m[2]!)
      if (text) beats.push({ kind: 'narration', text })
      continue
    }
    if (m && label) {
      const s = who(label, speakers)
      const text = clean(m[2]!)
      if (!text) continue
      if (s) beats.push({ kind: 'dialogue', speaker: s.id, text })
      else {
        // A colon inside ordinary narration ("One rule: never ask.") is not a speaker; only a short, name-like label is.
        if (/^[\p{Lu}][\p{L}' .-]{0,30}$/u.test(label) && label.split(/\s+/).length <= 3) {
          unknownSpeakers.push(label)
          beats.push({ kind: 'dialogue', speaker: label, text })
        } else beats.push({ kind: 'narration', text: clean(line) })
      }
      continue
    }
    beats.push({ kind: 'narration', text: clean(line) })
  }
  return { beats, tags, unknownSpeakers: [...new Set(unknownSpeakers)], droppedTags }
}

/** While a reply streams in, only lines that have ended are beats; the last one may still be growing. */
export function finishedPart(streamed: string): string {
  const end = streamed.lastIndexOf('\n')
  return end < 0 ? '' : streamed.slice(0, end)
}
