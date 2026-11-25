import { keyWords, nameWords, sharedRun, wordsOf } from '@engine/core'
import type { Character } from './schema'

/**
 * How many of each expressive field may touch the character's trade (2026-11-25, user: a trade is one strand). How
 * they change and how each feeling shows are the person's own; a trade in every feeling made one character play his
 * job in every turn. *tune*
 */
export const TRADE_LIMITS = { shifts: 0, display: 1, tells: 1, sampleLines: 1, portrait: 2 } as const

/** Key words in a row an example line may share with one of the card's facts before it reads as that fact (*tune*). */
export const SAMPLE_FACT_WORDS = 3
/** Key words two of a card's facts may share, and the share of the shorter one's, before they read as one fact told twice. */
export const SAME_FACT = { words: 3, share: 0.5 } as const
/** Figures an example line may not carry: a price, a count or a time is tonight's material, not a voice. */
export const FIGURE = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|dozen)\b/i
/**
 * A voice described as a device to perform in each line rather than how someone sounds (writing issue 1, 2026-11-25):
 * "a turn at the end", "often fragments", "a joke for everything", "all exclamations", "prices first".
 */
export const VOICE_DEVICE = /\bat the end\b|\bfragments?\b|\bfor everything\b|\ball (?:exclamations|questions|jokes|riddles)\b|\btwists?\b|\b(?:riddles?|maxims?|aphorisms?|epigrams?|punchlines?|quips?|one-liners?)\b|\b(?:every|each) (?:line|sentence)\b|\b(?:prices|numbers|names|questions|jokes) first\b|\bquestions that are\b/i
/** "talk about A, B and C", "talk about A or B": a portrait sentence listing topics (two or more after "talk about"). */
export const TOPIC_LIST = /\btalk(?:s|ing)?\s+about\b[^.;]*?(?:,|\band\b|\bor\b)/i

const plain = (t: string): string[] => t.toLowerCase().replace(/[’‘]/g, "'").replace(/(\p{L})-(\p{L})/gu, '$1$2').replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean)
const stem = (w: string): string => {
  const x = w.toLowerCase().trim()
  return x.length > 4 && x.endsWith('es') && /(ch|sh|x|ss)es$/.test(x) ? x.slice(0, -2) : x.length > 3 && x.endsWith('s') && !x.endsWith('ss') ? x.slice(0, -1) : x
}
const ENDINGS = ['', 's', 'es', 'd', 'ed', 'ing', 'er', 'ers', 'ery', 'ry', 'y']
const clip = (t: string) => (t.length > 80 ? `${t.slice(0, 77)}…` : t)

/**
 * Whether a character card keeps its trade to one strand (2026-11-25, user), for authored and generated cards alike:
 * how they change (`voice.shifts`), how each feeling shows (`expression.display`), tells (their own and their
 * secrets'), example lines and portrait sentences may name the trade's words (`work.domain`, matched as word stems)
 * at most `TRADE_LIMITS` times each, and an example line may not carry `SAMPLE_FACT_WORDS` words in a row of what they
 * know, hide or hold toward someone, which the writer then recites; a portrait sentence may not list topics they'd talk about.
 * Since writing issue 2 (2026-11-25) an example line shows the voice only: no name from the world (`names`: people,
 * places, groups), no figure, and no run of `SAMPLE_FACT_WORDS` key words from one of the card's facts; and the card
 * tells each fact once, in its knowledge or in a note, not both (`SAME_FACT`), since a fact said twice was recited.
 * Since writing issue 1 the voice's rhythm and vocabulary say how they sound, never a device to perform (`VOICE_DEVICE`). A card with an occupation needs `work`. Each
 * problem names the field, the lines and the words, so a generator can be told what to change.
 */
export function cardShapeProblems(c: Character, names: readonly string[] = []): string[] {
  const problems: string[] = []
  if (c.occupation && !c.work) problems.push(`${c.id}: has an occupation ("${c.occupation}") but no work: give its domain words and when it comes up in talk`)
  if (c.work) {
    const stems = [...new Set(c.work.domain.flatMap((d) => plain(d)).map(stem))]
    // A stem and its endings only ("pump", "pumps", "pumping"), so "car" doesn't catch "careful".
    const trade = (t: string) => {
      const words = plain(t).map((w) => w.replace(/'s$/, ''))
      return stems.filter((s) => words.some((w) => w.startsWith(s) && ENDINGS.includes(w.slice(s.length))))
    }
    const field = (name: string, how: string, items: [string, string][], limit: number) => {
      const hits = items.flatMap(([k, t]) => {
        const words = trade(t)
        return words.length > 0 ? [`${k} "${clip(t)}" [${words.join(', ')}]`] : []
      })
      if (hits.length > limit) problems.push(`${c.id}: ${name}: ${hits.length} of ${items.length} are about their work (at most ${limit}): ${hits.join('; ')}. ${how}`)
    }
    const v = c.voice
    field('how they change', 'Say how they change through voice, body, silence and how they treat people, never through their work or a prop.', Object.entries(v.shifts).flatMap(([k, t]) => (t ? [[k, t] as [string, string]] : [])), TRADE_LIMITS.shifts)
    field('how each feeling shows', 'Show a feeling in the person: voice, body, silence, how they treat people.', Object.entries(c.expression?.display ?? {}), TRADE_LIMITS.display)
    field('tells', 'A tell is in the body or the voice.', [...c.tells, ...c.secrets.flatMap((s) => (s.tell ? [s.tell] : []))].map((t, i) => [`tell ${i + 1}`, t] as [string, string]), TRADE_LIMITS.tells)
    field('example lines', 'Show the voice across different situations; at most one about their work.', v.sampleLines.map((t, i) => [`line ${i + 1}`, t] as [string, string]), TRADE_LIMITS.sampleLines)
    const sentences = c.portrait.split(/(?<=[.!?])\s+/).filter((s) => s.trim())
    field('portrait', 'Describe how they are with people; their work in a sentence or two, as dispositions, not examples or topics to raise.', sentences.map((t, i) => [`sentence ${i + 1}`, t] as [string, string]), TRADE_LIMITS.portrait)
  }
  for (const field of ['rhythm', 'vocabulary'] as const) {
    const m = c.voice[field].match(VOICE_DEVICE)
    if (m) problems.push(`${c.id}: voice ${field} "${clip(c.voice[field])}" asks for a device in each line ("${m[0]}"): say how they sound (pace, length, how formal, how warm), never a device to perform`)
  }
  // A portrait listing what they'd talk about hands the writer topics to raise; each came back near verbatim (2026-11-25).
  c.portrait.split(/(?<=[.!?])\s+/).forEach((t, i) => {
    if (TOPIC_LIST.test(t)) problems.push(`${c.id}: portrait sentence ${i + 1} lists topics they'd talk about ("${t.trim().slice(0, 80)}"): say how they talk with people, never what about`)
  })
  // An example line about tonight's people, places, prices or facts was said as written (writing issue 2, 2026-11-25).
  const facts: [string, string][] = [
    ...c.knowledge.map((t, i): [string, string] => [`knowledge ${i + 1}`, t]),
    ...c.secrets.flatMap((s, i): [string, string][] => (s.text ? [[`secret ${i + 1}`, s.text]] : [])),
    ...c.relations.flatMap((r): [string, string][] => (r.note ? [[`the note on ${r.to}`, r.note]] : [])),
    ...(c.playerTie?.note ? [['the note on the player', c.playerTie.note] as [string, string]] : [])
  ]
  const named = names.filter((n) => n.trim().length > 2).map((n) => ({ n, w: wordsOf(n).join(' ') }))
  const skip = nameWords(names)
  const keyed = facts.map(([where, t]) => [where, keyWords(t, skip)] as const)
  const fix = 'An example line shows only how they sound, in an ordinary moment (greeting, refusing, being teased, dodging a question): no names, no figures, nothing the card says they know.'
  c.voice.sampleLines.forEach((line, i) => {
    const said = ` ${wordsOf(line).join(' ')} `
    const name = named.find((x) => said.includes(` ${x.w} `))?.n
    const figure = line.match(FIGURE)?.[0]
    const k = keyWords(line, skip)
    const fact = keyed.map(([where, f]) => [where, sharedRun(k, f, SAMPLE_FACT_WORDS)] as const).find(([, r]) => r)
    const why = [name && `names ${name}`, figure && `gives a figure ("${figure}")`, fact && `says ${fact[0]} ("${fact[1]}")`].filter(Boolean)
    if (why.length > 0) problems.push(`${c.id}: example line ${i + 1} "${clip(line)}" ${why.join(', ')}. ${fix}`)
  })
  // The same fact in two places on a card is said twice as often (a bartender's knowledge and his note on a regular both saying when she pays her tab).
  for (let i = 0; i < facts.length; i++)
    for (let j = i + 1; j < facts.length; j++) {
      if (facts[i]![0].startsWith('secret') || facts[j]![0].startsWith('secret')) continue
      const a = new Set(keyed[i]![1])
      const b = new Set(keyed[j]![1])
      const both = [...a].filter((w) => b.has(w))
      if (both.length >= SAME_FACT.words && both.length >= SAME_FACT.share * Math.min(a.size, b.size))
        problems.push(`${c.id}: ${facts[i]![0]} and ${facts[j]![0]} tell the same fact [${both.join(', ')}]: keep it in one place`)
    }
  return problems
}
