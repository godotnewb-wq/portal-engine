import { firstName, traced, type CallTrace, type Prompt } from '@engine/core'
import { shadeList, type Character } from '@engine/characters'
import { characterById, locationById, type Pack } from '@engine/pack'
import type { GameState, Judgment, TieChange, TieEvent } from '@engine/state'
import type { WrittenFeeling } from './aftermath'
import type { Summarize } from './endScene'
import { about, deltaOf, isObject, meterTask, transcript, witnesses, type MeterDelta } from './summary'
import { settleTies, type StatedTie, type WrittenTie } from './ties'

/**
 * The relationship call (milestone 4c; decided 2026-11-16, user): the first of a witness's two end-of-scene calls. It
 * judges how the scene moved their meters and what feelings it left, and says, in the first person, what someone here
 * became to them or stopped being ("Ada is now my client"). The game settles those statements across all the witnesses
 * (`settleTies`), the player answers any arrangement offered to them, and only then does each witness's memory call
 * run, told what changed. The meters move when the scene closes, with the memories.
 */

/** What a witness's relationship call said. */
export interface Relationship {
  /** What moved their meters. */
  reason: string
  delta: MeterDelta
  others: { with: string; delta: MeterDelta; reason: string }[]
  /** How they feel as the scene ends, when it isn't about one person. */
  feels?: WrittenFeeling
  /** Feelings toward a person this scene left them with. */
  toward: WrittenFeeling[]
  /** Who a feeling they carry was settled with in this scene. */
  resolved: string[]
  /** What someone became to them or stopped being, with the line that shows it. */
  ties: WrittenTie[]
}

/** What the relationship calls and the settling of ties did, for the logs. */
export interface RelationshipTrace {
  sceneId: string
  at: string
  /** Each witness's call: what it said, or why it couldn't be had (then nothing changes for them). */
  witnesses: { id: string; callId: string; relationship?: Relationship; error?: string }[]
  /** Every tie a witness stated. */
  stated: StatedTie[]
  applied: TieEvent[]
  pending: TieChange[]
  refused: string[]
  /** Tags one side reported beginning and the other didn't: nothing changed. */
  alone: string[]
  calls: CallTrace[]
}

function task(content: Pack, state: GameState, c: Character, others: Character[]): string {
  const r = content.ruleset
  const player = state.player.name
  const me = firstName(c.name)
  const m = meterTask(r)
  const people = [...others.map((o) => `"${o.id}"`), `or "player" for ${player}`].join(', ')
  const groups = r.ties.groups.map((g) => `${g.name}: ${r.ties.tags.filter((t) => t.group === g.id).map((t) => t.words.join('/')).join(', ')}`).join('. ')
  return `You judge how one scene in a visual-novel RPG changed what one character feels about the people in it, and what those people are to them. Answer for ${me}, as ${me} would. ${player} is the player (${state.player.pronouns}).

Reply with only a JSON object:
{"reason": "...", ${m.fields}, "others": [{"with": "id", ${m.fields}, "reason": "..."}], "feels": {"shade": "...", "family": "...", "intensity": 1, "reason": "..."}, "toward": [{"who": "id", "shade": "...", "family": "...", "intensity": 1, "reason": "..."}], "resolved": [], "ties": [{"with": "id", "now": "...", "no_longer": "...", "line": "..."}]}

- ${m.names}: how each CHANGED toward ${player} because of this scene, each one of: ${m.words}. Meters move slowly; nothing is owed for turning up. Toward someone, ${m.meaning}.
- Judge as ${me}: by ${me}'s values, agenda and how things stood before. Values ${me} likes, shown by ${player}, raise regard; values ${me} dislikes lower it.
- reason: one short sentence on what moved ${me}, and which way.${others.length > 0 ? `\n- others: how ${me}'s feelings toward ${others.map((o) => `${firstName(o.name)} [${o.id}]`).join(', ')} changed in this scene, same words; leave someone out if nothing changed.` : '\n- others: [].'}
- feels: how ${me} feels as the scene ends, when it isn't about one person: a shade from the list below, family only when the shade is listed under more than one, intensity 1 to 5, and why in a few words. Leave it out if nothing much.
- toward: feelings this scene left ${me} with toward one person (who: ${people}): what happened between them, not how ${me} feels about them overall, which the meters hold. Only for something between them that will still be felt tomorrow, at intensity ${r.people.aftermath.towardMin} or more; a pleasant chat or a small slight is none. A shade, intensity and why ("forgot our anniversary"). They pass in days. Most scenes leave none: [].
- resolved: the people (as ids) toward whom a feeling ${me} already carries was settled in this scene (an apology accepted, a fear put to rest); [] if none.
- ties: what someone here became to ${me} in this scene, or stopped being, as ${me} would say it. "Ada is now my client" is {"with": "ada", "now": "client", "line": "..."}; "Ben is no longer my partner" is {"with": "ben", "no_longer": "partner", "line": "..."}. with: ${people}. now, no_longer: one of the words under "What someone can be to ${me}" below, the one ${me} would use for them. line: the words from the scene that show it, copied exactly.
- A tie is only what happened on screen and was carried through: vows made, a breakup said and meant, steady work taken on or quit, a debt paid off. Not what was only talked about, joked about, offered and left open, or felt: feelings are not ties. It is what ${me} would still call them next week: one job hired for or offered, an order given once, one favor or help with one task is not a tie.
- Go through what each person here already is to ${me} (listed with them below): did this scene make, end or change it? Vows exchanged turn a fiancé into a spouse; a breakup said and meant ends a partner or lover and makes them an ex. Give each such change, even when nothing else between them changed. Most scenes change none: [].
- Shades by family (usual intensity): ${shadeList(r)}.
- What someone can be to ${me}: ${groups}.`
}

/** The prompt for one witness's relationship call (outside the turn budget; one per witness, in parallel). */
export function buildRelationshipPrompt(content: Pack, state: GameState, id: string): Prompt {
  const c = characterById(content, id)!
  const others = witnesses(state).filter((x) => x !== id).map((x) => characterById(content, x)!)
  const location = locationById(content, state.scene!.locationId)!
  return {
    system: task(content, state, c, others),
    user: [about(content, state, c, others, 'relationship'), `Place: ${location.name}, ${location.district}.`, `The scene:\n${transcript(content, state) || '(Nothing much was said.)'}`].join('\n\n')
  }
}

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '')

/** Reads a relationship call's reply. A word not on the scale changes nothing; undefined when the reply isn't a JSON object. */
export function parseRelationship(content: Pack, reply: string): Relationship | undefined {
  const r = content.ruleset
  const body = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  let raw: unknown
  try {
    raw = start < 0 || end < start ? undefined : JSON.parse(body.slice(start, end + 1))
  } catch {
    raw = undefined
  }
  if (!isObject(raw)) return undefined
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : [])
  return {
    reason: str(raw['reason']),
    delta: deltaOf(r, raw),
    others: Array.isArray(raw['others']) ? raw['others'].filter(isObject).flatMap((o) => (str(o['with']) ? [{ with: str(o['with']), delta: deltaOf(r, o), reason: str(o['reason']) }] : [])) : [],
    ...(isObject(raw['feels']) && { feels: raw['feels'] as WrittenFeeling }),
    toward: Array.isArray(raw['toward']) ? raw['toward'].filter(isObject).map((x) => x as WrittenFeeling) : [],
    resolved: strings(raw['resolved']),
    ties: Array.isArray(raw['ties'])
      ? raw['ties'].filter(isObject).flatMap((t): WrittenTie[] => {
          const [who, now, gone] = [str(t['with']), str(t['now']), str(t['no_longer'])]
          return who && (now || gone) ? [{ with: who, ...(now && { now }), ...(gone && { no_longer: gone }), line: str(t['line']) }] : []
        })
      : []
  }
}

/** A witness's answers as the scene keeps them until it closes: everything but the ties, which are settled now. */
const judgment = ({ ties: _ties, ...rest }: Relationship): Judgment => rest

/**
 * The first half of a scene's end: every witness's relationship call at once, then the ties they stated are settled.
 * A witness whose call fails or can't be read changes nothing: no meters, no feelings, no ties from their side. The
 * scene keeps each witness's answers (`judged`) for the memory calls and the close.
 */
export async function judgeScene(content: Pack, state: GameState, call: Summarize, now: () => number = Date.now): Promise<{ state: GameState; trace: RelationshipTrace }> {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const calls: CallTrace[] = []
  const trace: RelationshipTrace = { sceneId: scene.id, at: new Date(now()).toISOString(), witnesses: [], stated: [], applied: [], pending: [], refused: [], alone: [], calls }
  const ids = witnesses(state).filter((id) => characterById(content, id))
  const asked = await Promise.all(
    ids.map(async (id): Promise<RelationshipTrace['witnesses'][number]> => {
      const callId = `${scene.id}:relationship:${id}`
      const prompt = buildRelationshipPrompt(content, state, id)
      try {
        const reply = await traced(calls, { id: callId, role: 'relationship', sceneId: scene.id }, prompt, now, () => call(prompt))
        const relationship = parseRelationship(content, reply)
        return relationship ? { id, callId, relationship } : { id, callId, error: 'the reply was not a JSON object' }
      } catch (error) {
        return { id, callId, error: (error as Error).message }
      }
    })
  )
  const stated = asked.flatMap((w) => (w.relationship?.ties ?? []).map((t): StatedTie => ({ by: w.id, ...t })))
  const settled = settleTies(content, state, stated)
  const judged = Object.fromEntries(asked.map((w): [string, Judgment] => [w.id, w.relationship ? judgment(w.relationship) : { reason: '', delta: {}, others: [], toward: [], resolved: [], error: w.error ?? 'failed' }]))
  return {
    state: { ...settled.state, scene: { ...settled.state.scene!, judged } },
    // Parallel calls finish in any order; the log reads better in witness order.
    trace: { ...trace, witnesses: asked, stated, applied: settled.applied, pending: settled.pending, refused: settled.refused, alone: settled.alone, calls: ids.flatMap((id) => calls.filter((c) => c.id === `${scene.id}:relationship:${id}`)) }
  }
}
