import { firstName, traced, type CallTrace, type Prompt } from '@engine/core'
import { tagWord } from '@engine/characters'
import { characterById, locationById, type Pack } from '@engine/pack'
import { applyTie, needsAgreement, tagNamed, tagsToward, tieProblem, type GameState, type TieChange, type TieEvent } from '@engine/state'
import type { Summarize } from './endScene'
import { witnesses } from './summary'

/**
 * Relationship changes at the end of a scene (relationships §3; decided 2026-11-15, user, replacing task 4's
 * "the director plans"): one call reads the whole scene and proposes the tags that began or ended on screen; the game
 * checks each one as before (`tieProblem`) and applies it, or holds an arrangement with the player for their yes. It
 * runs before the summaries, so the forced Core memories and the player's answers are in place when they are written.
 * The director no longer plans tie changes, and the summaries never change tags.
 */

/** A proposal as the call wrote it. */
export interface WrittenTie {
  turn?: number
  from: string
  to: string
  add?: string
  end?: string
  word?: string
  back_word?: string
  reason: string
}

/** What the check did, for the logs: what was proposed, what applied, what waits for the player, what was refused and why. */
export interface TieCheckTrace {
  sceneId: string
  at: string
  callId: string
  proposed: WrittenTie[]
  applied: TieEvent[]
  pending: TieChange[]
  refused: string[]
  /** The call failed or its reply wasn't readable: nothing changed. */
  error?: string
  calls: CallTrace[]
}

const norm = (s: string) => s.trim().toLowerCase()

/** The scene's turns, numbered, as the check reads them. */
function numbered(content: Pack, state: GameState): string {
  const scene = state.scene!
  const name = (id: string) => {
    const c = characterById(content, id)
    if (c) return firstName(c.name)
    const w = locationById(content, scene.locationId)?.walkOns.find((x) => x.id === id)
    return w?.name ?? w?.label ?? id
  }
  return scene.turns
    .map((t, i) => [`## Turn ${i + 1}`, `${state.player.name}: ${t.player}`, ...t.checks.map((c) => `(${c.line})`), ...t.beats.map((b) => (b.kind === 'narration' ? b.text : `${name(b.speaker)}: ${b.text}`))].join('\n'))
    .join('\n\n')
}

export function buildTiePrompt(content: Pack, state: GameState): Prompt {
  const r = content.ruleset.ties
  const player = state.player
  const people = witnesses(state).flatMap((id) => {
    const c = characterById(content, id)
    return c ? [c] : []
  })
  const ids = new Set(people.map((c) => c.id))
  const label = (id: string) => (id === 'player' ? player.name : firstName(characterById(content, id)?.name ?? id))
  const held = [
    ...state.relations.filter((x) => ids.has(x.from) && ids.has(x.to) && x.tags.length > 0).map((x) => ({ from: x.from, to: x.to, tags: x.tags })),
    ...people.flatMap((c) => (state.playerTies[c.id]?.tags.length ? [{ from: c.id, to: 'player', tags: state.playerTies[c.id]!.tags }] : []))
  ]
  const tags = r.tags.map((t) => `${t.id} (${t.words.join('/')})${t.oneSided ? ', one-sided' : t.counterpart !== t.id ? ` ↔ ${t.counterpart}` : ''}`).join('; ')
  return {
    system: `You read a finished scene from a visual-novel RPG and say whether a relationship between the people in it began or ended on screen. ${player.name} is the player (${player.pronouns}). Reply with only a JSON object:
{"ties": [{"turn": 1, "from": "id", "to": "id", "add": "tag", "end": "tag", "word": "...", "back_word": "...", "reason": "..."}]}

- Most scenes change no relationship: then reply {"ties": []}.
- Only what happened on screen and was carried through in this scene: vows made, a breakup said and meant, a job taken or quit, a betrayal that ends a friendship. Not what was only talked about, joked about, offered and left open, or felt: feelings are not ties.
- A tie is what both would still call each other next week. Letting someone help once, giving them an order in the moment, or one favor is not a tie: no boss for one task.
- turn: the number of the turn it happened on.
- from: someone who was in the scene, by id. to: someone else who was, or "player" for ${player.name}; ${player.name} is never from.
- add: the tag to becomes for from; end: the tag to stops being for from: read it as "to becomes from's add". Example: when Ada hires Ben for a job, from is ada, to is ben, add "contractor" (Ben becomes Ada's contractor), not "client". Tag ids from the list below. To replace a tag (an engagement becoming a marriage), end the old one and add the new one. Never end and add the same tag.
- word: one of the added tag's words, for what from calls to; back_word: one of the counterpart's words, for what to calls from. Mind each person's pronouns. Example: when Ada (she/her) marries Ben (he/him), from is ada, to is ben, end is the engagement tag, add the marriage tag, word "husband" and back_word "wife".
- The other side changes with it: list each change once, from one side.
- reason: what happened, in a few words; it becomes the note on the relationship.
- A tie with ${player.name} that is an arrangement is asked of the player before it holds.

Tags (id (words), ↔ counterpart): ${tags}.`,
    user: [
      `# Who was in the scene\n${[...people.map((c) => `- ${firstName(c.name)} [${c.id}], ${c.pronouns}`), `- ${player.name} [player], ${player.pronouns}`].join('\n')}`,
      `# Their tags now\n${held.length > 0 ? held.map((h) => `- ${label(h.from)} → ${label(h.to)}: ${h.tags.map((t) => `${t.tag} ("${tagWord(content.ruleset, t)}")`).join(', ')}`).join('\n') : '(none)'}`,
      `# The scene\n${numbered(content, state) || '(Nothing much was said.)'}`
    ].join('\n\n')
  }
}

/** Reads the proposals from a reply: a JSON object's `ties`. Undefined when the reply isn't readable. */
export function parseTies(reply: string): WrittenTie[] | undefined {
  const body = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < start) return undefined
  try {
    const raw = JSON.parse(body.slice(start, end + 1)) as { ties?: unknown }
    if (!Array.isArray(raw.ties)) return undefined
    const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : undefined)
    return raw.ties.flatMap((t): WrittenTie[] => {
      if (typeof t !== 'object' || t === null) return []
      const o = t as Record<string, unknown>
      const from = str(o['from'])
      const to = str(o['to'])
      if (!from || !to) return []
      const turn = typeof o['turn'] === 'number' ? o['turn'] : Number(str(o['turn']) ?? NaN)
      const [add, endTag, word, back] = [str(o['add']), str(o['end']), str(o['word']), str(o['back_word'])]
      return [{ ...(Number.isInteger(turn) && { turn }), from, to, ...(add && { add }), ...(endTag && { end: endTag }), ...(word && { word }), ...(back && { back_word: back }), reason: str(o['reason']) ?? '' }]
    })
  } catch {
    return undefined
  }
}

/**
 * Checks and applies the proposals in order, each against the state the ones before it left: both people must have
 * been in the scene (the player as `to` only); tags by id or word; the usual rules (`tieProblem`), including that ending
 * and re-adding one tag changes nothing. An arrangement with the player waits in `pendingTies` for their answer; the
 * rest apply now as tie events, each forcing a Core memory for both in the summaries. A word that isn't one of the
 * tag's words is left out, and the tag's own word shows. Once all are settled, a tag that ended with nothing begun in
 * its place becomes its `endsAs` tag (partner → ex) on both sides, as part of the same event, unless the pair still
 * holds a tag of its group (decided 2026-11-16, user).
 */
export function settleTies(content: Pack, state: GameState, written: WrittenTie[]): { state: GameState; applied: TieEvent[]; pending: TieChange[]; refused: string[] } {
  const scene = state.scene!
  const here = witnesses(state)
  const who = (w: string): string | undefined =>
    here.find((id) => {
      const c = characterById(content, id)
      return id === norm(w) || (!!c && (norm(c.name) === norm(w) || norm(firstName(c.name)) === norm(w)))
    })
  const def = (id?: string) => content.ruleset.ties.tags.find((x) => x.id === id)
  const wordOf = (id: string | undefined, w: string | undefined) => (id && w && def(id)!.words.includes(w) ? w : undefined)
  let next = state
  const applied: TieEvent[] = []
  const pending: TieChange[] = []
  const refused: string[] = []
  written.forEach((t, i) => {
    const n = i + 1
    const isPlayer = (w: string) => norm(w) === 'player' || norm(w) === norm(state.player.name)
    // The player holds no tags, so a change written from the player's side is turned around (decided 2026-11-16, user,
    // after the end-of-Milestone-4 bench run 2: a player paying off a debt was written from their side, refused, and the debt stood).
    if (isPlayer(t.from) && !isPlayer(t.to)) {
      // A one-sided tag (rival, enemy) says how one person sees the other, so it has no other side to turn to.
      if ([t.add, t.end].some((x) => def(tagNamed(content, x))?.oneSided)) return refused.push(`${n}: ${state.player.name} holds no tags, and a one-sided tag can't be turned around`)
      const back = (tag?: string) => (tag && tagNamed(content, tag) ? def(tagNamed(content, tag))!.counterpart : tag)
      t = { ...t, from: t.to, to: 'player', ...(t.add && { add: back(t.add) }), ...(t.end && { end: back(t.end) }), word: t.back_word, back_word: t.word }
    }
    const from = who(t.from)
    const to = isPlayer(t.to) ? 'player' : who(t.to)
    if (!from) return refused.push(isPlayer(t.from) ? `${n}: a change can't be between ${state.player.name} and themselves` : `${n}: "${t.from}" wasn't in the scene`)
    if (!to || to === from) return refused.push(`${n}: "${t.to}" wasn't someone else in the scene`)
    const add = tagNamed(content, t.add)
    const end = tagNamed(content, t.end)
    if (t.add && !add) return refused.push(`${n}: no tag "${t.add}"`)
    if (t.end && !end) return refused.push(`${n}: no tag "${t.end}"`)
    const word = wordOf(add, t.word ?? (t.add && add !== t.add ? t.add : undefined))
    const backWord = wordOf(def(add)?.counterpart, t.back_word)
    const change: TieChange = { from, to, ...(add && { add }), ...(word && { word }), ...(backWord && { backWord }), ...(end && { end }), reason: t.reason }
    const problem = tieProblem(content, next, change)
    if (problem) return refused.push(`${n}: ${problem}`)
    if (to === 'player' && add && needsAgreement(content, add)) return void pending.push(change)
    const turn = t.turn !== undefined ? scene.turns[t.turn - 1]?.id : undefined
    const done = applyTie(content, next, change, turn ?? scene.turns.at(-1)?.id)
    next = done.state
    applied.push(done.event)
  })
  applied.forEach((ev, i) => {
    if (ev.added.length > 0) return
    for (const end of ev.ended) {
      const after = def(def(end)?.endsAs)
      if (!after || tagsToward(next, ev.from, ev.to).some((t) => def(t.tag)?.group === def(end)!.group)) continue
      const change: TieChange = { from: ev.from, to: ev.to, add: after.id, reason: ev.reason }
      if (tieProblem(content, next, change)) continue
      next = applyTie(content, next, change, ev.turn).state
      applied[i] = { ...applied[i]!, added: [...applied[i]!.added, after.id] }
    }
  })
  const s = next.scene!
  return { state: { ...next, scene: { ...s, tieEvents: [...s.tieEvents, ...applied], pendingTies: [...s.pendingTies, ...pending] } }, applied, pending, refused }
}

/**
 * The end-of-scene tie check: one call on the summary model, then `settleTies`. A failed call or an unreadable reply
 * changes nothing and is recorded, so the scene still ends. A scene with no turns isn't checked.
 */
export async function checkTies(content: Pack, state: GameState, call: Summarize, now: () => number = Date.now): Promise<{ state: GameState; trace: TieCheckTrace }> {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const callId = `${scene.id}:ties`
  const calls: CallTrace[] = []
  const trace: TieCheckTrace = { sceneId: scene.id, at: new Date(now()).toISOString(), callId, proposed: [], applied: [], pending: [], refused: [], calls }
  if (scene.turns.length === 0) return { state, trace }
  let reply: string
  try {
    const prompt = buildTiePrompt(content, state)
    reply = await traced(calls, { id: callId, role: 'ties', sceneId: scene.id }, prompt, now, () => call(prompt))
  } catch (error) {
    return { state, trace: { ...trace, error: (error as Error).message } }
  }
  const written = parseTies(reply)
  if (!written) return { state, trace: { ...trace, error: 'the reply had no "ties" list' } }
  const settled = settleTies(content, state, written)
  return { state: settled.state, trace: { ...trace, proposed: written, applied: settled.applied, pending: settled.pending, refused: settled.refused } }
}
