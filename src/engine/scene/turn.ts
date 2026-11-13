import type { Beat, GameState, RolledCheck, Turn } from '@engine/state'
import type { Tags } from './beats'
import { characterById, type Pack } from '@engine/pack'
import { firstName } from '@engine/core'
import { RECENT_TURNS, turnText } from './director'
import { presentCast, type BeatPlan } from './planShape'

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

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The cast who appear in these beats: a line of their own, or narration that names them. */
export function appearing(content: Pack, beats: Beat[]): Set<string> {
  const ids = new Set<string>()
  for (const b of beats) if (b.kind === 'dialogue') ids.add(b.speaker)
  const narration = beats.flatMap((b) => (b.kind === 'narration' ? [b.text] : [])).join('\n')
  for (const c of content.characters) {
    if (new RegExp(`\\b(?:${[c.name, firstName(c.name)].map(escape).join('|')})\\b`, 'i').test(narration)) ids.add(c.id)
  }
  return ids
}

/**
 * Which of the writer's tags count (milestone 3.6, task 6; decided 2026-11-12). Departures come only from the plan:
 * a `[LEAVES: Name]` tag moves no one, and one for someone the plan didn't send away is reported. When salvage cut
 * every beat a character appeared in, their `EXPRESSION`, `MOOD` and `COMFORT` tags are dropped too: they describe
 * prose the player never sees. Tags about someone who was never in the prose apply as on any turn. `[END SCENE]` has
 * no effect either way: only the plan ends a scene. Returns the tags to apply and each one set aside, with why.
 */
export function acceptTags(content: Pack, plan: BeatPlan, tags: Tags, written: Beat[], kept: Beat[]): { tags: Tags; rejected: string[] } {
  const name = (id: string) => firstName(characterById(content, id)?.name ?? id)
  const rejected: string[] = []
  for (const id of tags.leaves) if (!plan.leaves.includes(id)) rejected.push(`[LEAVES: ${name(id)}] (not in the plan)`)
  const shown = appearing(content, kept)
  const cut = new Set([...appearing(content, written)].filter((id) => !shown.has(id)))
  const keep = <T>(kind: string, record: Record<string, T>, text: (value: T) => string) =>
    Object.fromEntries(
      Object.entries(record).filter(([id, value]) => {
        if (!cut.has(id)) return true
        rejected.push(`[${name(id)}: ${kind} ${text(value)}] (salvage cut their lines)`)
        return false
      })
    )
  return {
    tags: {
      expressions: keep('EXPRESSION', tags.expressions, (v) => v),
      moods: keep('MOOD', tags.moods, (v) => v),
      comfort: keep('COMFORT', tags.comfort, (v) => `${v.level} ${v.reason}`.trim()),
      leaves: tags.leaves.filter((id) => plan.leaves.includes(id)),
      ended: tags.ended
    },
    rejected
  }
}

/**
 * A planned departure the kept prose doesn't show gets one narration beat in the pack's words (the ruleset's
 * `narration.departure`), so a character never vanishes without a word on screen (milestone 3.6, task 6a). "Shows"
 * can only mean the character is in the kept beats, with a line or named in narration: code can't tell whether the
 * prose has them walk out, which is why the writer is told who leaves.
 */
export function showDepartures(content: Pack, plan: BeatPlan, beats: Beat[]): { beats: Beat[]; added: { id: string; beat: Beat }[] } {
  const shown = appearing(content, beats)
  const added = plan.leaves
    .filter((id) => !shown.has(id))
    .map((id) => ({ id, beat: { kind: 'narration' as const, text: content.ruleset.narration.departure.replaceAll('{name}', firstName(characterById(content, id)?.name ?? id)) } }))
  return { beats: [...beats, ...added.map((a) => a.beat)], added }
}

/**
 * Applies a finished turn to the state. Tags only touch characters who are present; departures and the scene's end
 * come from the plan alone (see `acceptTags` for which tags count).
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
  const leaving = [...new Set(written.plan.leaves)].filter((id) => present.has(id))

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
