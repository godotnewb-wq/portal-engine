import type { Beat, GameState } from '@engine/state'
import { checkNames, nameIndex, withProseNames, type NameIndex } from '@engine/codex'
import type { Pack } from '@engine/pack'
import type { ParsedReply, Speaker } from './beats'
import type { BeatPlan } from './plan'
import { BEATS, OVERUSED_PHRASES } from './style'

export type ProblemKind =
  | 'player-voice'
  | 'player-action'
  | 'unplanned-speaker'
  | 'unknown-speaker'
  | 'speech-in-narration'
  | 'overused-phrase'
  | 'repeated'
  | 'beat-count'
  | 'beat-length'
  | 'wrong-name'
  | 'invented-name'

export interface Problem {
  kind: ProblemKind
  /** Said to the writer in the rewrite, so it is an instruction. */
  fix: string
  /** Which beat, where it is one. */
  beat?: number
  /** The words that tripped the check, for the logs. */
  text?: string
}

/**
 * Things the writer may only do if the player's input said so: "you nod" is fine when the player wrote "I nod".
 * Verbs of speaking and deciding, and the gestures models most like to put on the player.
 */
const PLAYER_VERBS = [
  'say', 'said', 'says', 'reply', 'replied', 'replies', 'answer', 'answered', 'answers', 'ask', 'asked', 'asks', 'tell', 'told', 'tells',
  'agree', 'agreed', 'agrees', 'decide', 'decided', 'decides', 'accept', 'accepted', 'accepts', 'refuse', 'refused', 'refuses',
  'promise', 'promised', 'promises', 'nod', 'nodded', 'nods', 'shrug', 'shrugged', 'shrugs', 'laugh', 'laughed', 'laughs',
  'smile', 'smiled', 'smiles', 'grin', 'grinned', 'grins', 'sigh', 'sighed', 'sighs', 'whisper', 'whispered', 'whispers'
]
const IRREGULAR: Record<string, string> = { said: 'say', says: 'say', told: 'tell' }
const stem = (verb: string) => IRREGULAR[verb] ?? verb.replace(/(?:ing|ed|es|e|s|d)$/, '').replace(/(.)\1$/, '$1')
const PLAYER_DOES = new RegExp(`\\byou\\s+(?:\\w+ly\\s+)?(${PLAYER_VERBS.join('|')})\\b`, 'gi')

/** "you say, "…"" or "you tell her, "…"" — words in quotes put in the player's mouth. */
const PLAYER_QUOTED = /\byou\s+(?:\w+\s+){0,3}?(?:say|said|reply|replied|tell|told|ask|asked|answer|answered|murmur|murmured|whisper|whispered)\b[^.!?\n]{0,40}["“]/i

function playerAllows(input: string, verb: string): boolean {
  const asked = stem(verb.toLowerCase())
  return input
    .toLowerCase()
    .split(/[^a-z']+/)
    .some((word) => word.length > 1 && stem(word) === asked)
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length

/**
 * Words in quotes inside narration, three or more of them: someone speaking without a line of their own (session
 * 2026-11-07_0039_e46a, t2b5). Fewer words is a word being pointed at (at the word "surveyors"), not speech.
 */
const SPOKEN = /["“]([^"”\n]+)["”]/g
const spokenIn = (text: string): string | undefined => [...text.matchAll(SPOKEN)].find((m) => words(m[1]!) >= 3)?.[0]

/** Narration with the spoken words taken out, for salvage: the action stays, the speech goes. */
export function withoutSpeech(text: string): string {
  return text
    .replace(SPOKEN, (m, said: string) => (words(said) >= 3 ? '' : m))
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Everything wrong with a reply that one rewrite should fix (narrator-scene-engine §3, code checks). `phrases` are the
 * pack's own over-used phrases, checked with the engine's.
 */
export function checkReply(parsed: ParsedReply, plan: BeatPlan, speakers: Speaker[], input: string, phrases: string[] = []): Problem[] {
  const problems: Problem[] = []
  const planned = new Set([...plan.speakers.map((s) => s.id), ...plan.walk_ons.map((w) => w.id)])
  const byId = new Map(speakers.map((s) => [s.id, s]))
  const nameOf = (id: string) => byId.get(id)?.names[2] ?? byId.get(id)?.names[1] ?? id

  parsed.beats.forEach((beat: Beat, i) => {
    const n = i + 1
    if (beat.kind === 'dialogue') {
      const who = byId.get(beat.speaker)
      if (who?.kind === 'player') problems.push({ kind: 'player-voice', beat: n, text: beat.text, fix: `Beat ${n} gives the player a line. Remove it; never speak for the player.` })
      else if (!who) problems.push({ kind: 'unknown-speaker', beat: n, text: beat.speaker, fix: `Beat ${n} is spoken by "${beat.speaker}", who is not in the scene. Use narration instead.` })
      else if (!planned.has(beat.speaker)) problems.push({ kind: 'unplanned-speaker', beat: n, text: beat.text, fix: `Beat ${n}: ${nameOf(beat.speaker)} was not planned to speak. Show them only through a reaction in narration.` })
    }
    const text = beat.text
    // Only narration can act for the player: a character saying "you laugh" to them is just talk.
    const quoted = beat.kind === 'narration' ? text.match(PLAYER_QUOTED) : null
    // Words put in the player's mouth are the graver problem, and its fix covers the speech too.
    const spoken = beat.kind === 'narration' && !quoted ? spokenIn(text) : undefined
    if (spoken) problems.push({ kind: 'speech-in-narration', beat: n, text: spoken, fix: `Beat ${n} puts spoken words in narration (${spoken}). Give them to a planned speaker as a dialogue beat, or cut them: reactions are silent.` })
    if (quoted) {
      problems.push({ kind: 'player-voice', beat: n, text: quoted[0], fix: `Beat ${n} puts words in the player's mouth. Remove them.` })
    } else if (beat.kind === 'narration') {
      for (const m of text.matchAll(PLAYER_DOES)) {
        if (!playerAllows(input, m[1]!)) {
          problems.push({ kind: 'player-action', beat: n, text: m[0], fix: `Beat ${n} has the player ${m[1]!.toLowerCase()} ("${m[0]}"), which their input did not say. Remove it.` })
          break
        }
      }
    }
    if (words(text) > BEATS.maxWords) problems.push({ kind: 'beat-length', beat: n, text: `${words(text)} words`, fix: `Beat ${n} is ${words(text)} words. Keep each beat under ${BEATS.targetWords}.` })
    const lower = text.toLowerCase()
    for (const phrase of [...OVERUSED_PHRASES, ...phrases, ...plan.avoid]) {
      if (phrase.trim().length >= 4 && lower.includes(phrase.toLowerCase())) {
        problems.push({ kind: 'overused-phrase', beat: n, text: phrase, fix: `Beat ${n} uses "${phrase}". Say it another, specific way.` })
      }
    }
  })

  const count = parsed.beats.length
  if (count < BEATS.min || count > BEATS.max) problems.push({ kind: 'beat-count', fix: `Write ${BEATS.target} beats; there are ${count}.` })
  return problems
}

/**
 * When the rewrite still fails, the game keeps what it can rather than spend a fourth call: beats that speak for the
 * player or come from someone not planned are dropped, spoken words are cut out of narration (`withoutSpeech`, in
 * `runTurn`), and the turn is cut to the beat budget. Other problems (a
 * stale phrase, a long beat) are tolerated.
 */
export function salvage(beats: Beat[], problems: Problem[]): Beat[] {
  return salvaged(beats.length, problems).map((i) => beats[i]!)
}

/** Which beats salvage keeps, by index into the rewrite's beats, so the logs can say what was dropped and cut. */
export function salvaged(count: number, problems: Problem[]): number[] {
  const drop = new Set(droppedBeats(problems).map((n) => n - 1))
  return [...Array(count).keys()].filter((i) => !drop.has(i)).slice(0, BEATS.max)
}

const SALVAGE_DROPS: ProblemKind[] = ['player-voice', 'player-action', 'unplanned-speaker', 'unknown-speaker']

const indexes = new WeakMap<Pack, NameIndex>()
/** The pack's canon names and its people, built once per pack. */
export function packNames(content: Pack, extraPeople: string[] = []): NameIndex {
  let index = indexes.get(content)
  if (!index) {
    const people = [...content.characters.map((c) => c.name), content.player.name, ...content.locations.flatMap((l) => l.walkOns.flatMap((w) => (w.name ? [w.name] : [])))]
    const prose = [
      ...content.codex.flatMap((e) => [e.summary, e.full]),
      ...content.locations.flatMap((l) => [l.description, ...Object.values(l.texture).flat(), ...l.extras])
    ]
    index = withProseNames(nameIndex(content.codex, content.setting, people, content.vocabulary.genericWords), prose)
    indexes.set(content, index)
  }
  if (extraPeople.length === 0) return index
  return { ...index, people: new Set([...index.people, ...extraPeople.map((p) => p.toLowerCase())]) }
}

/**
 * The lore checks on a reply (claude/lore-injection.md §11): names of groups and places that aren't canon (a near
 * miss is told the right name; anything else new is told to use a description). There is no secret-leak check
 * (removed 2026-11-12): the writer sees a secret only when its holder keeps it, and what the story establishes about
 * secrets otherwise is the lore audit's to sort out at scene end (milestone 8).
 */
export function loreProblems(content: Pack, state: GameState, parsed: ParsedReply): Problem[] {
  if (content.codex.length === 0) return []
  const problems: Problem[] = []
  const index = packNames(content, [state.player.name])
  parsed.beats.forEach((beat, i) => {
    const n = i + 1
    for (const f of checkNames(beat.text, index)) {
      if (f.kind === 'wrong-name') problems.push({ kind: 'wrong-name', beat: n, text: f.name, fix: `Beat ${n} calls something "${f.name}", which isn't its name. Use ${f.canon.map((c) => `"${c}"`).join(' or ')}, or describe it.` })
      else problems.push({ kind: 'invented-name', beat: n, text: f.name, fix: `Beat ${n} names "${f.name}", which doesn't exist. Use an existing name or a plain description.` })
    }
  })
  return problems
}

/** The beats (1-based) salvage drops for these problems, before the cut to the budget. */
export const droppedBeats = (problems: Problem[]): number[] => [...new Set(problems.filter((p) => p.beat && SALVAGE_DROPS.includes(p.kind)).map((p) => p.beat!))].sort((a, b) => a - b)
