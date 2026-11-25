import type { Beat } from '@engine/state'
import { plainName } from '@engine/core'

/**
 * The writer's output format: one beat per line, `NARRATION: …` or `Name: …`, with hidden tags in square brackets
 * anywhere (director writer §5). Tag grammar:
 *   [Name: EXPRESSION smirk]   [Name: COMFORT 2 too loud]   [LEAVES: Name]   [END SCENE]
 * The `MOOD` tag was retired in milestone 4b (the director's `feels` owns felt emotion); one written anyway is dropped.
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

function parseTag(body: string, speakers: Speaker[], tags: Tags, dropped: string[], script = false): void {
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
  // The scene writer often leaves the word EXPRESSION out ("[Ada: WARY]"); one plain word after a name is what the face shows.
  const bare = script ? body.match(/^\s*([^:]+?)\s*:\s*(?!EXPRESSION\b|COMFORT\b)(\p{L}[\p{L}-]*)\s*$/iu) : null
  const named = bare ? [bare[0], bare[1], 'EXPRESSION', bare[2]] : body.match(/^\s*([^:]+?)\s*:\s*(EXPRESSION|COMFORT)\s*:?\s*(.*?)\s*$/i)
  const s = named ? who(named[1]!, speakers) : undefined
  if (!named || s?.kind !== 'cast') {
    dropped.push(raw)
    return
  }
  const kind = named[2]!.toUpperCase()
  const value = named[3]!
  if (kind === 'EXPRESSION' && value) tags.expressions[s.id] = value.toLowerCase().split(/[\s,;]+/)[0]!
  else if (kind === 'COMFORT') {
    const m = value.match(/^([1-5])\b\s*(.*)$/)
    if (m) tags.comfort[s.id] = { level: Number(m[1]), reason: m[2]!.replace(/^[-–—,:]\s*/, '') }
    else dropped.push(raw)
  } else dropped.push(raw)
}

const QUOTED = /(["“])([^"”\n]*)(["”]|$)/g
const PRONOUN_START = /^(?:He|She)\b(?!['’])/i
/** "She's", "He'd", "She'll": the name can't take the contraction ("Ada's at the bar"), so it is spelled out. */
const CONTRACTED_START = /^(?:He|She)['’](s|d|ll)\b/i
/** After "'s" or "'d", these words mean has or had ("she's got", "he'd been"); anything else means is or would. */
const PERFECT_WORDS = new Set(['got', 'gotten', 'been', 'had', 'done', 'gone', 'seen', 'left', 'taken', 'made', 'put', 'better'])
/** "Her coin", "His glass" opening an action cut from a line: whose it is gets lost unless the name replaces it. */
const POSSESSIVE_START = /^(?:His|Her)\b(?!['’])/i
/** "From the back booth, she lifts her glass": a subject partway in, after an opening phrase, with no name before it. */
const LATER_PRONOUN = /,\s+(?:she|he)\b(?!['’])/i
/** Stage direction with no one doing anything ("From her booth, without looking up"): it opens on a place or a manner, and goes on with more of either or an -ing phrase. */
const STAGING_OPENING = /^(?:from|without|with|across|over|behind|under|through|at|near|by)\b/i
const STAGING_PIECE = /^(?:from|without|with|across|over|behind|under|through|at|near|by|\p{L}+ing)\b/iu
/** "A beat.", "A pause.": a stage direction with nothing in it to show. */
export const PAUSE_ONLY = /^(?:a|another|one)\s+(?:long\s+|short\s+)?(?:beat|pause|moment)[.!…]*$/i
/** An unquoted line that opens like this is about the speaker, not said by them ("Ada: She sets three cups down"). */
const ACTION_START = /^(?:He|She|They|His|Her|Their)\b/
/** "she says," between two quoted parts is attribution, not an action worth its own beat. */
const SPEECH_TAG = /^(?:\S+\s+){0,2}(?:says|said|adds|asks|replies|mutters|murmurs|whispers|continues|goes on)\b(?!\s+nothing)[^.!?]*[.!?]?$/i
/** A capitalized word ending in -s followed by one of these is a verb missing its subject ("Wipes the slate"). */
const OBJECT_WORDS = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'its', 'my', 'your', 'at', 'to', 'toward', 'towards', 'into', 'onto', 'up', 'down', 'out', 'off', 'over', 'back', 'away', 'through', 'across', 'without'])
const NOT_VERBS = new Set(['his', 'its', 'this', 'thus', 'yes', 'as', 'us', 'was', 'is', 'perhaps', 'always', 'sometimes', 'besides', 'unless', 'plus', 'towards', 'across'])

const displayName = (s: Speaker) => s.display ?? s.names[1] ?? s.id

/** Gives an action cut out of a dialogue line its subject, so the beat reads on its own: "wipes the slate" → "Ada wipes the slate". */
function withSubject(action: string, s: Speaker): string {
  const name = displayName(s)
  const capital = name.charAt(0).toUpperCase() + name.slice(1)
  const contracted = action.match(CONTRACTED_START)
  if (contracted) {
    const rest = action.slice(contracted[0].length)
    const next = rest.trim().split(/\s+/)[0]?.toLowerCase().replace(/\W+$/, '') ?? ''
    const ending = contracted[1]!.toLowerCase()
    const perfect = PERFECT_WORDS.has(next)
    const verb = ending === 'll' ? 'will' : ending === 's' ? (perfect ? 'has' : 'is') : perfect ? 'had' : 'would'
    return `${capital} ${verb}${rest}`
  }
  if (PRONOUN_START.test(action)) return action.replace(PRONOUN_START, capital)
  if (POSSESSIVE_START.test(action)) return action.replace(POSSESSIVE_START, `${capital}'s`)
  const named = s.names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(action))
  // A subject after an opening phrase ("From the back booth, she lifts her glass") is the speaker, unnamed so far.
  if (!named && LATER_PRONOUN.test(action)) return action.replace(LATER_PRONOUN, (m) => m.replace(/(?:she|he)$/i, capital))
  // Stage direction with no one in it ("From her booth, without turning her head") says how the speaker speaks.
  const pieces = action.replace(/[.!…]+$/, '').split(/\s*,\s*/)
  if (!named && STAGING_OPENING.test(pieces[0]!) && pieces.every((x) => STAGING_PIECE.test(x))) return `${capital} speaks ${action.charAt(0).toLowerCase()}${action.slice(1)}`
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
    if (!/\p{L}/u.test(action) || PAUSE_ONLY.test(action)) return
    if (SPEECH_TAG.test(action) && action.split(/\s+/).length <= 6) return
    parts.push({ said: false, text: withSubject(action, s) })
  }
  for (const q of quotes) {
    between(text.slice(at, q.index))
    const said = q[2]!.trim()
    const last = parts.at(-1)
    // A quote that ran on into "he says," ends where the next starts with a capital ("Running warm," he says. "It'll
    // hold."); one that goes on in lower case is the same sentence ("discreet," she says, "and the work…").
    if (said && last?.said) last.text = `${/^\p{Lu}/u.test(said) ? last.text.replace(/,$/, '.') : last.text} ${said}`
    else if (said) parts.push({ said: true, text: said })
    at = q.index! + q[0].length
  }
  between(text.slice(at))
  return parts.map((p): Beat => (p.said ? { kind: 'dialogue', speaker: s.id, text: p.text } : { kind: 'narration', text: p.text }))
}

export interface ParseOptions {
  /**
   * The scene writer's script form (Milestone 5 task 3): a paragraph may run into the next speaker's label after a
   * sentence ends ("Ada looks away. Ben: \"Well?\""), and an expression tag may leave out the word EXPRESSION.
   */
  script?: boolean
}

/** A sentence end followed by a short, capitalized label and a colon: maybe the next speaker, mid-paragraph. */
const MID_LABEL = /(?<=[.!?…"”*)]\s+)([\p{Lu}][\p{L}'-]*(?:\s[\p{Lu}][\p{L}'-]*){0,2})\s*:\s/gu

/** A line split where someone here starts speaking partway through it; a label that names no one here stays put. */
function speakerTurns(line: string, speakers: Speaker[]): string[] {
  const cuts = [...line.matchAll(MID_LABEL)].filter((m) => who(m[1]!, speakers) || NARRATOR_NAMES.includes(plainName(m[1]!))).map((m) => m.index!)
  if (cuts.length === 0) return [line]
  return [0, ...cuts].map((at, k) => line.slice(at, cuts[k] ?? line.length).trim()).filter(Boolean)
}

/** Reads the writer's reply into beats and tags. Lenient: an unlabelled line is narration. */
export function parseReply(reply: string, speakers: Speaker[], options: ParseOptions = {}): ParsedReply {
  const tags: Tags = { expressions: {}, comfort: {}, leaves: [], ended: false }
  const droppedTags: string[] = []
  const unknownSpeakers: string[] = []
  const reshaped: number[] = []
  // Thinking is blanked rather than cut, keeping its newlines, so line numbers still match the raw reply.
  const withoutThinking = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, (m) => m.replace(/[^\n]/g, ''))
  for (const m of withoutThinking.matchAll(TAG)) parseTag(m[1]!, speakers, tags, droppedTags, options.script)

  const beats: Beat[] = []
  const lines: number[] = []
  const push = (beat: Beat, n: number) => {
    beats.push(beat)
    lines.push(n)
  }
  const rows = withoutThinking.replace(TAG, '').split(/\r?\n/).flatMap((line, i) => (options.script ? speakerTurns(line, speakers) : [line]).map((part) => [i, part] as const))
  for (const [i, line] of rows) {
    const n = i + 1
    if (line.trim().length === 0 || /^\s*(?:```|---+)\s*$/.test(line)) continue
    const m = line.match(LINE)
    const label = m?.[1]?.trim()
    if (m && label && NARRATOR_NAMES.includes(plainName(label))) {
      const text = clean(m[2]!)
      if (text && !PAUSE_ONLY.test(text)) push({ kind: 'narration', text }, n)
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
