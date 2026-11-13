import type { Beat, GameState, RolledCheck, Turn } from '@engine/state'
import type { Tags } from './beats'
import type { Pack } from '@engine/pack'
import { RECENT_TURNS, turnText } from './director'
import { presentCast, type BeatPlan } from './plan'

/** In-game minutes a turn of talk takes (tune). */
export const MINUTES_PER_TURN = 3
/** The running summary keeps its most recent part; older detail lives in end-of-scene memories. */
export const SUMMARY_CHARS = 2000

export interface TurnWritten {
  id: string
  log?: string
  input: string
  plan: BeatPlan
  beats: Beat[]
  tags: Tags
  /** The dice's state after the plan's checks were rolled. */
  dice: number
}

export function rolledChecks(plan: BeatPlan): RolledCheck[] {
  return plan.checks.flatMap((c) =>
    c.result && c.line
      ? [{ id: c.id, who: c.who, skill: c.skill, difficulty: c.difficulty, stakes: c.stakes, natural: c.result.natural, total: c.result.total, dc: c.result.dc, degree: c.result.degree, line: c.line }]
      : []
  )
}

/**
 * Applies a finished turn to the state. Tags only touch characters who are present, a departure the plan didn't call
 * for still happens if the writer tagged it (people may walk out), but only the plan can end the scene.
 */
export function applyTurn(content: Pack, state: GameState, written: TurnWritten): GameState {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const present = new Set(presentCast(scene))
  const only = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => present.has(id)))

  const turn: Turn = {
    id: written.id,
    ...(written.log && { log: written.log }),
    player: written.input,
    beats: written.beats,
    checks: rolledChecks(written.plan),
    speakers: written.plan.speakers.map((s) => s.id),
    texture: written.plan.texture
  }
  const kept = written.plan.speakers.flatMap((s) => s.kept ?? [])
  if (kept.length > 0) turn.kept = kept
  const plannedMoods = Object.fromEntries(written.plan.speakers.filter((s) => s.mood.trim()).map((s) => [s.id, s.mood]))
  const comfort = Object.fromEntries(Object.entries(only(written.tags.comfort)).map(([id, c]) => [id, c.level]))
  const leaving = [...new Set([...written.plan.leaves, ...written.tags.leaves])].filter((id) => present.has(id))

  // The turn that drops out of the prompts' verbatim window goes into the running summary.
  const turns = [...scene.turns, turn]
  const dropped = turns.length > RECENT_TURNS ? turns[turns.length - RECENT_TURNS - 1] : undefined
  const summary = dropped ? `${scene.summary}\n\n${turnText(content, state.player.name, dropped)}`.trim().slice(-SUMMARY_CHARS) : scene.summary

  // What was said on screen joins the scene's common ground: a fact is introduced the first time, and anyone present
  // can repeat it after. Only moves whose speaker actually had a line count, in case the writer or salvage dropped one.
  const voiced = new Set(written.beats.flatMap((b) => (b.kind === 'dialogue' ? [b.speaker] : [])))
  const said = (written.plan.moves ?? []).filter((m) => voiced.has(m.who))
  const told = [...new Set([...scene.told, ...said.flatMap((m) => m.says.flatMap((s) => (s.id ? [s.id] : [])))])]
  const newFacts = [...scene.newFacts]
  for (const m of said)
    for (const s of m.says)
      if (!s.id && !newFacts.some((f) => f.text === s.text)) newFacts.push({ id: `said.${newFacts.length + 1}`, text: s.text, by: m.who })

  // How hard each speaker's aim pressed this turn, so the next can move it only a step; and which secrets' tells have shown.
  const pressures = { ...scene.pressures }
  for (const s of written.plan.speakers) {
    const level = s.pressure ? content.ruleset.pressures.indexOf(s.pressure) : -1
    if (level >= 0) pressures[s.id] = level
  }
  const tells = [...new Set([...scene.tells, ...written.plan.speakers.flatMap((s) => (s.tell && s.kept ? s.kept : []))])]

  return {
    ...state,
    time: state.time + MINUTES_PER_TURN,
    dice: written.dice,
    scene: {
      ...scene,
      turns,
      summary,
      moods: { ...scene.moods, ...only(plannedMoods), ...only(written.tags.moods) },
      comfort: { ...scene.comfort, ...comfort },
      expressions: { ...scene.expressions, ...only(written.tags.expressions) },
      departed: [...scene.departed, ...leaving],
      ended: scene.ended || written.plan.end_scene,
      told,
      newFacts,
      pressures,
      tells
    }
  }
}
