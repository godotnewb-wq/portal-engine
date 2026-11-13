import { mentions, tokensOf } from '@engine/codex'
import { firstName } from '@engine/core'
import { caresAbout, nature, tagWord, type Character, type TieTag } from '@engine/characters'
import { characterById, locationById, type Pack } from '@engine/pack'
import { meterWords, type Ruleset } from '@engine/rules'
import type { GameState, Relation } from '@engine/state'
import { presentCast, type BeatPlan } from './planShape'

/**
 * The director's briefs (director writer §7, milestone 4a). Every character present gets a compact, always-on brief:
 * who they are, a portrayal cue, their nature and what they care about in a line each, tonight's concern, mood, held
 * secrets (milestone 3.5's display, unchanged), feelings and ties toward the player and the others here, and, for a
 * Major Character, a close-ties line. Everything else on the card is optional detail, chosen by rule for this turn:
 * knowledge, long-term goals, contradictions, history notes, ties to people who aren't here and motives. Candidates
 * are ranked across the whole scene and share one token budget (the ruleset's `briefs.detailTokens`). No model call.
 */

/** What an optional detail is. Knowledge keeps its fact id (`<character>.k<n>`), which moves cite in `uses`. */
export type DetailKind = 'knows' | 'goal' | 'contradiction' | 'note' | 'absent' | 'motive'

/**
 * Why a detail made the brief, strongest first: it helps answer or understand the player's action; it could change
 * someone's immediate choice; it is relevant texture.
 */
export const DETAIL_RANKS = ['answer', 'choice', 'texture'] as const
export type DetailRank = (typeof DETAIL_RANKS)[number]

export interface BriefDetail {
  id: string
  /** The character whose brief it goes in. */
  owner: string
  kind: DetailKind
  /** The line as the brief shows it. */
  text: string
  rank: DetailRank
  /** What brought it in, in a few words, for the trace ("player's words: route", "named: Ada", "carried"). */
  trigger: string
  /** Estimated tokens of its line. */
  tokens: number
}

/** What the briefs carried this turn, for the trace and the bench (milestone 4a acceptance 9). */
export interface BriefTrace {
  /** The shared budget for optional detail, and what the selected detail cost. */
  budget: number
  used: number
  /** Estimated tokens of each character's always-on brief, apart from optional detail. */
  recurring: Record<string, number>
  selected: Omit<BriefDetail, 'text'>[]
  /** Details that qualified but didn't fit the budget, or were over a cap on people who aren't here. */
  cut: (Omit<BriefDetail, 'text'> & { why: 'budget' | 'absent cap' })[]
  /** Details carried from last turn that a clear change of topic let go. */
  dropped: string[]
}

export interface Briefs {
  /** Each present character's brief as the director reads it. */
  sheets: Record<string, string>
  details: BriefDetail[]
  trace: BriefTrace
}

/** Words that say nothing about what a line is about. */
const STOP = new Set(
  'about above across after again against also always another anyone anything around because been before being better between both cannot could does doing down during each either else enough even ever every from going gone have having here hers herself himself into just know knows like little long make many maybe might mine more most much must myself need never next nobody none nothing often once only other others ours over own quite rather really right said same says should since some someone something still such sure take tell than that thats their theirs them then there these they thing things think this those though through tonight under until upon very want wants were what when where whether which while whom whose will with without would your yours yourself yeah okay well tell asks asked onto into upon toward towards keep kept gets got make made'
    .split(' ')
)

const stem = (w: string) => w.replace(/'s$/, '').replace(/(?<=.{4})(?:ing|ed|es|s)$/, '')

/**
 * The words of a text that could say what it's about: four letters or more, lower case, roughly stemmed. Names are
 * left out (`skip`): a named person is matched as a name, so a name never counts twice.
 */
export function contentWords(text: string, skip: Set<string> = new Set()): Set<string> {
  const words = text.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z][a-z'-]{3,}/g) ?? []
  return new Set(words.map((w) => stem(w.replace(/['-]+$/, ''))).filter((w) => w.length >= 4 && !STOP.has(w) && !skip.has(w)))
}

/** Every name word in the pack's cast and the player's, lower case, for `contentWords` to skip. */
const nameWords = (content: Pack, state: GameState) =>
  new Set([...content.characters.map((c) => c.name), state.player.name].flatMap((n) => n.toLowerCase().split(/\s+/)).map(stem))

/**
 * The words two texts share, when they say the texts are about the same thing. Against the player's few words one
 * longer word is enough; against a whole turn of dialogue, which shares a common word with almost anything, it takes
 * two, one of them longer.
 */
function shared(a: Set<string>, b: Set<string>, strict = false): string[] {
  const both = [...a].filter((w) => b.has(w))
  return (strict ? both.length >= 2 && both.some((w) => w.length >= 5) : both.length >= 1) ? both : []
}

/** What the turn's selection reads: the player's words, the last turn, the running summary, and who was addressed. */
interface Signals {
  input: string
  inputWords: Set<string>
  recent: string
  recentWords: Set<string>
  summaryWords: Set<string>
  /** Present characters the player named. */
  addressed: Set<string>
  /** Who had a line last turn. */
  spokeLast: Set<string>
  /** The player's words carry on from the last exchange ("Why?", "And then?") rather than change the subject. */
  followUp: boolean
}

const namesOf = (c: Character) => [c.name, firstName(c.name)]

function signals(content: Pack, state: GameState, input: string): Signals {
  const scene = state.scene!
  const last = scene.turns.at(-1)
  const recent = last ? [last.player, ...last.beats.map((b) => b.text)].join('\n') : ''
  const skip = nameWords(content, state)
  const inputWords = contentWords(input, skip)
  const recentWords = contentWords(recent, skip)
  const addressed = new Set(presentCast(scene).filter((id) => namesOf(characterById(content, id)!).some((n) => mentions(input, n))))
  // A short reply depends on what came before; so does one that picks up its words.
  const followUp = !!last && (inputWords.size < 2 || [...inputWords].some((w) => recentWords.has(w)))
  return { input, inputWords, recent, recentWords, summaryWords: contentWords(scene.summary, skip), addressed, spokeLast: new Set(last?.speakers ?? []), followUp }
}

/** Tags in words, for the director: a private one says so. */
const tagsForDirector = (r: Ruleset, tags: TieTag[]) => tags.map((t) => `${tagWord(r, t)}${t.private ? ' (private)' : ''}`).join(', ')

const firstSentence = (t: string) => t.trim().match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? t.trim()

/** Every optional detail a present character's brief could carry, with what it is about (for matching). */
interface Candidate {
  id: string
  owner: string
  kind: DetailKind
  text: string
  /** Words it is about, and the first names of the people it names. */
  words: Set<string>
  names: string[]
  /** Another character it concerns (a note or a tie). */
  other?: string
}

function candidates(content: Pack, state: GameState): Candidate[] {
  const r = content.ruleset
  const present = presentCast(state.scene!)
  const skip = nameWords(content, state)
  const words = (text: string) => contentWords(text, skip)
  const named = (text: string) => content.characters.filter((c) => namesOf(c).some((n) => mentions(text, n))).map((c) => firstName(c.name))
  // Matched on the line's own words, never its fact id: "[ada.k2]" would name Ada.
  const of = (owner: string, id: string, kind: DetailKind, text: string, about = text): Candidate => ({ id, owner, kind, text, words: words(about), names: named(about) })
  return present.flatMap((who) => {
    const c = characterById(content, who)
    if (!c) return []
    const ties = state.relations.filter((x) => x.from === c.id)
    const tie = (x: Relation) => {
      const o = characterById(content, x.to)
      if (!o) return undefined
      const tags = x.tags.filter((t) => !t.private)
      return { o, tags }
    }
    return [
      ...c.knowledge.map((k, i) => of(c.id, `${c.id}.k${i + 1}`, 'knows', `[${c.id}.k${i + 1}] ${k}`, k)),
      ...c.agenda.longTerm.map((g, i) => of(c.id, `${c.id}.goal${i + 1}`, 'goal', `Wants: ${g}`)),
      ...c.contradictions.map((x, i) => of(c.id, `${c.id}.torn${i + 1}`, 'contradiction', `Torn: ${x}`)),
      ...c.motives.map((m, i) => of(c.id, `${c.id}.motive${i + 1}`, 'motive', `Bound to the player (${m.type}, ${m.strength}): ${m.reason}`)),
      ...ties.flatMap((x) => {
        const t = tie(x)
        if (!t || !x.note) return []
        // Matched on the person's name and the history, not the tag word: "the client" isn't about any one client.
        if (present.includes(x.to)) {
          return [{ ...of(c.id, `note.${c.id}.${x.to}`, 'note', `With ${firstName(t.o.name)}: ${x.note}`), names: [firstName(t.o.name)], other: x.to, words: words(x.note) }]
        }
        const tags = tagsForDirector(r, x.tags)
        return [{ ...of(c.id, `tie.${c.id}.${x.to}`, 'absent', `Not here: ${t.o.name}${tags ? ` (${tags})` : ''}: ${x.note}`), names: [firstName(t.o.name)], other: x.to, words: words(x.note) }]
      })
    ]
  })
}

/** Ranks one candidate for this turn, or leaves it out. */
function rankOf(content: Pack, state: GameState, s: Signals, x: Candidate, carried: Set<string>): { rank: DetailRank; trigger: string; score: number } | undefined {
  const inInput = shared(x.words, s.inputWords)
  const namedNow = x.names.filter((n) => mentions(s.input, n))
  const roleWord = x.kind === 'absent' || x.kind === 'note' ? tieWordsSaid(content, state, x, s.input) : []
  if (inInput.length > 0 || namedNow.length > 0 || roleWord.length > 0) {
    const why = [...namedNow.map((n) => `named: ${n}`), ...roleWord.map((w) => `said: ${w}`), ...(inInput.length > 0 ? [`player's words: ${inInput.join(', ')}`] : [])]
    return { rank: 'answer', trigger: why.join('; '), score: inInput.length + 2 * namedNow.length + 2 * roleWord.length }
  }
  // A pair speaking to each other, or both in last turn's exchange: their history shapes what they say next.
  if (x.kind === 'note' && x.other && s.spokeLast.has(x.owner) && s.spokeLast.has(x.other)) return { rank: 'choice', trigger: 'the pair spoke last turn', score: 1 }
  if (x.kind === 'motive' && s.addressed.has(x.owner)) return { rank: 'choice', trigger: 'addressed', score: 1 }
  const inRecent = shared(x.words, s.recentWords, true)
  const namedRecent = x.names.filter((n) => mentions(s.recent, n))
  if (x.kind !== 'note' && (inRecent.length > 0 || (x.kind === 'absent' && namedRecent.length > 0))) {
    return { rank: 'choice', trigger: inRecent.length > 0 ? `last turn: ${inRecent.join(', ')}` : `named last turn: ${namedRecent.join(', ')}`, score: inRecent.length + namedRecent.length }
  }
  if (carried.has(x.id)) return { rank: 'choice', trigger: 'carried', score: 0 }
  if (x.kind === 'absent' && x.other && hauntsHere(content, state, x.other)) return { rank: 'texture', trigger: 'a haunt of theirs', score: 0 }
  const inSummary = shared(x.words, s.summaryWords, true)
  if (inSummary.length > 0 && x.kind !== 'note') return { rank: 'texture', trigger: `earlier in the scene: ${inSummary.join(', ')}`, score: inSummary.length }
  return undefined
}

/**
 * Tag words for the other person said about the owner (relationships §3: "your sister" matches a sibling tag). The word
 * has to belong to someone, "your", "his", "their" or a name's "'s", so a passing "the client" doesn't count.
 */
function tieWordsSaid(content: Pack, state: GameState, x: Candidate, text: string): string[] {
  const rel = state.relations.find((y) => y.from === x.owner && y.to === x.other)
  const owner = characterById(content, x.owner)
  const whose = ['your', 'his', 'her', 'their', ...(owner ? namesOf(owner).map((n) => `${n}'s`) : [])]
  return (rel?.tags ?? [])
    .filter((t) => !t.private)
    .map((t) => tagWord(content.ruleset, t))
    .filter((w) => whose.some((p) => mentions(text, `${p} ${w}`)))
}

/** Whether the scene's place is one of a character's haunts. */
function hauntsHere(content: Pack, state: GameState, id: string): boolean {
  const location = locationById(content, state.scene!.locationId)
  const codexId = location?.parent ? `${location.parent}.${location.id}` : location?.id
  return !!characterById(content, id)?.haunts.some((h) => h.location === codexId)
}

const RANK = { answer: 0, choice: 1, texture: 2 } as const

/** Chooses this turn's optional detail for everyone present, within the shared budget. */
export function selectDetails(content: Pack, state: GameState, input: string): { details: BriefDetail[]; trace: Omit<BriefTrace, 'recurring'> } {
  const r = content.ruleset
  const s = signals(content, state, input)
  const last = state.scene!.turns.at(-1)
  const carriedIn = new Set(last?.details ?? [])
  // A clear change of topic lets carried detail go; a follow-up or a direct match keeps it.
  const carried = s.followUp ? carriedIn : new Set<string>()
  const ranked = candidates(content, state).flatMap((x) => {
    const how = rankOf(content, state, s, x, carried)
    return how ? [{ ...x, ...how }] : []
  })
  ranked.sort(
    (a, b) =>
      RANK[a.rank] - RANK[b.rank] ||
      Number(s.addressed.has(b.owner)) - Number(s.addressed.has(a.owner)) ||
      b.score - a.score ||
      Number(carried.has(b.id)) - Number(carried.has(a.id)) ||
      a.id.localeCompare(b.id)
  )
  const budget = r.briefs.detailTokens
  let left = budget
  const absentBy = new Map<string, number>()
  let absentAll = 0
  const details: BriefDetail[] = []
  const cut: BriefTrace['cut'] = []
  for (const x of ranked) {
    const detail: BriefDetail = { id: x.id, owner: x.owner, kind: x.kind, text: x.text, rank: x.rank, trigger: x.trigger, tokens: tokensOf(x.text) }
    const { text: _text, ...traced } = detail
    if (x.kind === 'absent' && ((absentBy.get(x.owner) ?? 0) >= r.briefs.absentPerCharacter || absentAll >= r.briefs.absentPerScene)) {
      cut.push({ ...traced, why: 'absent cap' })
      continue
    }
    if (detail.tokens > left) {
      cut.push({ ...traced, why: 'budget' })
      continue
    }
    left -= detail.tokens
    if (x.kind === 'absent') {
      absentBy.set(x.owner, (absentBy.get(x.owner) ?? 0) + 1)
      absentAll++
    }
    details.push(detail)
  }
  const kept = new Set(details.map((d) => d.id))
  return {
    details,
    trace: {
      budget,
      used: budget - left,
      selected: details.map(({ text: _text, ...d }) => d),
      cut,
      dropped: [...carriedIn].filter((id) => !kept.has(id) && !s.followUp)
    }
  }
}

/**
 * Every optional detail as a full card would carry it, for comparing full cards with selected briefs on the same
 * scene (milestone 4a acceptance 9) and for the bench. Not used in play.
 */
export function fullDetails(content: Pack, state: GameState): BriefDetail[] {
  return candidates(content, state).map((x) => ({ id: x.id, owner: x.owner, kind: x.kind, text: x.text, rank: 'texture', trigger: 'full card', tokens: tokensOf(x.text) }))
}

/** Move kinds that leave something open for the next turn: a question, an offer or a challenge waiting on an answer. */
const OPEN_MOVES = new Set(['ask', 'offer', 'push back', 'dodge', 'refuse'])

/**
 * Which of this turn's details go forward to the next (director writer §7): those a move used, and those that answered
 * the player's action when the exchange ended on something still open. Having been in the prompt alone isn't enough.
 */
export function carryDetails(details: BriefDetail[], plan: BeatPlan): string[] {
  const used = new Set((plan.moves ?? []).flatMap((m) => m.says.flatMap((x) => (x.id ? [x.id] : []))))
  const open = OPEN_MOVES.has(plan.moves?.at(-1)?.move ?? '')
  return details.filter((d) => used.has(d.id) || (open && d.rank === 'answer')).map((d) => d.id)
}

/** The close-ties line (relationships §3, Major Characters only): up to the ruleset's count of people not here, family first. */
export function closeTies(content: Pack, state: GameState, c: Character): string {
  const r = content.ruleset
  if (c.tier !== 'major') return ''
  const present = new Set(presentCast(state.scene!))
  const family = new Set(r.ties.tags.filter((t) => t.family).map((t) => t.id))
  return state.relations
    .filter((x) => x.from === c.id && !present.has(x.to) && x.tags.some((t) => !t.private))
    .map((x, i) => ({ x, i, family: x.tags.some((t) => family.has(t.tag)) }))
    .sort((a, b) => Number(b.family) - Number(a.family) || a.i - b.i)
    .slice(0, r.briefs.closeTies)
    .map(({ x }) => `${x.tags.filter((t) => !t.private).map((t) => tagWord(r, t)).join(', ')}: ${firstName(characterById(content, x.to)?.name ?? x.to)}`)
    .join(' · ')
}

/** The always-on part of a brief, before any optional detail. */
export function recurringLines(content: Pack, state: GameState, c: Character, tierWords: string): string[] {
  const r = content.ruleset
  const scene = state.scene!
  const present = presentCast(scene)
  const meters = state.meters[c.id]
  const playerTie = state.playerTies[c.id]
  const others = state.relations
    .filter((x) => x.from === c.id && present.includes(x.to))
    .map((x) => `${firstName(characterById(content, x.to)?.name ?? x.to)}: ${[x.tags.length > 0 && tagsForDirector(r, x.tags), meterWords(r, x.meters)].filter(Boolean).join(' · ')}`)
  const ties = closeTies(content, state, c)
  const natureLine = nature(r, c)
  const cares = caresAbout(r, c)
  return [
    `## ${c.name} [id: ${c.id}] — ${tierWords}${state.party.includes(c.id) ? ", in the player's party" : ''}${c.age && r.people.ages.minors.includes(c.age) ? `, ${c.age}` : ''}, ${c.species}, ${c.pronouns}`,
    `Who: ${c.role}`,
    `Cue: ${firstSentence(c.portrait)}`,
    natureLine && `Nature: ${natureLine}`,
    cares && `Cares about: ${cares}`,
    `Tonight: ${c.agenda.current}`,
    `Mood now: ${scene.moods[c.id] ?? c.mood}. Comfort ${scene.comfort[c.id] ?? 3}/5.`,
    meters && `Toward the player: ${meterWords(r, meters)}${playerTie ? ` · ${[tagsForDirector(r, playerTie.tags), playerTie.note].filter(Boolean).join(': ')}` : ''}`,
    others.length > 0 && `Toward others here: ${others.join('; ')}`,
    ties && `Close ties, not here: ${ties}`
  ].filter((x): x is string => !!x)
}
