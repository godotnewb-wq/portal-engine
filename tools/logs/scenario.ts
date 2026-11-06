import type { Turn } from '@engine/state'
import { currentFlags } from '@engine/review'
import type { SessionLog, TurnRecord } from '@platform/logs'
import type { Scenario } from '../bench/scenario'
import { sceneLocation } from './load'

/** A logged turn as the state keeps it, for a scenario's history. */
const asTurn = (t: TurnRecord): Turn => ({
  id: t.turnId,
  player: t.input,
  beats: t.beats.map((b) => b.beat),
  checks: t.checks.map((c) => ({ id: c.id, who: c.who, skill: c.skill, difficulty: c.difficulty, stakes: c.stakes, natural: c.natural, total: c.total, dc: c.dc, degree: c.degree, line: c.line })),
  speakers: t.director.plan.speakers.map((s) => s.id),
  texture: t.director.plan.texture
})

/**
 * A logged turn as a bench scenario (milestone 2, A4): the scene as it stood (cast, moods, comfort, meters toward
 * the player, the turns before it and the dice), and the player's input, so a bad turn from play can be replayed
 * against changed prompts. `watchFor` is filled from the turn's flags and notes. Not carried over: memories from
 * earlier scenes and relations between characters, which the logs don't hold; the scenario uses the pack's.
 */
export function toScenario(log: SessionLog, n: number, flags = log.flags): Scenario {
  const turn = log.turns[n - 1]
  if (!turn) throw new Error(`${log.session.id} has ${log.turns.length} turns; there is no turn ${n}.`)
  const location = sceneLocation(log, turn.sceneId)
  if (!location) throw new Error(`Turn ${n}'s scene has no recorded location.`)
  const before = log.turns.filter((t) => t.sceneId === turn.sceneId && t.turn < turn.turn)
  const present = turn.cast.before.filter((c) => !c.departed)
  const notes = [...currentFlags(flags.filter((f) => f.turnSession === log.session.id && f.turnId === turn.turnId)).values()].map(
    (f) => `${f.beat !== undefined ? `Beat ${f.beat}` : 'The turn'} was flagged ${f.flag.rating}${f.flag.reasons.length ? ` (${f.flag.reasons.join(', ')})` : ''}${f.flag.note ? `: ${f.flag.note}` : ''}.`
  )
  return {
    id: `${log.session.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-t${n}`.replace(/^-+|-+$/g, ''),
    title: `From play: ${log.session.id}, turn ${n}`,
    watchFor: [`Replays turn ${n} of ${log.session.id}: "${turn.input}".`, ...notes].join(' '),
    location,
    cast: present.map((c) => c.id),
    // The dice as they stood, so the turn's checks roll as they did in play (if the plan asks for the same ones).
    seed: turn.dice.before,
    meters: Object.fromEntries(present.flatMap((c) => (c.meters ? [[c.id, c.meters]] : []))),
    moods: Object.fromEntries(present.map((c) => [c.id, c.mood])),
    comfort: Object.fromEntries(present.map((c) => [c.id, c.comfort])),
    history: before.map(asTurn),
    turns: [turn.input],
    summaries: false
  }
}
