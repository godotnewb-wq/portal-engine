import type { Beat } from '@engine/state'
import type { ParsedReply, Speaker } from './beats'
import type { BeatPlan } from './plan'
import { BEATS, OVERUSED_PHRASES } from './style'

export type ProblemKind = 'player-voice' | 'player-action' | 'unplanned-speaker' | 'unknown-speaker' | 'overused-phrase' | 'beat-count' | 'beat-length'

export interface Problem {
  kind: ProblemKind
  /** Said to the writer in the rewrite, so it is an instruction. */
  fix: string
  /** Which beat, where it is one. */
  beat?: number
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
      if (who?.kind === 'player') problems.push({ kind: 'player-voice', beat: n, fix: `Beat ${n} gives the player a line. Remove it; never speak for the player.` })
      else if (!who) problems.push({ kind: 'unknown-speaker', beat: n, fix: `Beat ${n} is spoken by "${beat.speaker}", who is not in the scene. Use narration instead.` })
      else if (!planned.has(beat.speaker)) problems.push({ kind: 'unplanned-speaker', beat: n, fix: `Beat ${n}: ${nameOf(beat.speaker)} was not planned to speak. Show them only through a reaction in narration.` })
    }
    const text = beat.text
    // Only narration can act for the player: a character saying "you laugh" to them is just talk.
    if (beat.kind === 'narration' && PLAYER_QUOTED.test(text)) {
      problems.push({ kind: 'player-voice', beat: n, fix: `Beat ${n} puts words in the player's mouth. Remove them.` })
    } else if (beat.kind === 'narration') {
      for (const m of text.matchAll(PLAYER_DOES)) {
        if (!playerAllows(input, m[1]!)) {
          problems.push({ kind: 'player-action', beat: n, fix: `Beat ${n} has the player ${m[1]!.toLowerCase()} ("${m[0]}"), which their input did not say. Remove it.` })
          break
        }
      }
    }
    if (words(text) > BEATS.maxWords) problems.push({ kind: 'beat-length', beat: n, fix: `Beat ${n} is ${words(text)} words. Keep each beat under ${BEATS.targetWords}.` })
    const lower = text.toLowerCase()
    for (const phrase of [...OVERUSED_PHRASES, ...phrases, ...plan.avoid]) {
      if (phrase.trim().length >= 4 && lower.includes(phrase.toLowerCase())) {
        problems.push({ kind: 'overused-phrase', beat: n, fix: `Beat ${n} uses "${phrase}". Say it another, specific way.` })
      }
    }
  })

  const count = parsed.beats.length
  if (count < BEATS.min || count > BEATS.max) problems.push({ kind: 'beat-count', fix: `Write ${BEATS.target} beats; there are ${count}.` })
  return problems
}

/**
 * When the rewrite still fails, the game keeps what it can rather than spend a fourth call: beats that speak for the
 * player or come from someone not planned are dropped, and the turn is cut to the beat budget. Other problems (a
 * stale phrase, a long beat) are tolerated.
 */
export function salvage(beats: Beat[], problems: Problem[]): Beat[] {
  const drop = new Set(problems.filter((p) => p.beat && ['player-voice', 'player-action', 'unplanned-speaker', 'unknown-speaker'].includes(p.kind)).map((p) => p.beat! - 1))
  return beats.filter((_, i) => !drop.has(i)).slice(0, BEATS.max)
}
