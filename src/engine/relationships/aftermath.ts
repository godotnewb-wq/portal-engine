import { firstName } from '@engine/core'
import { moodOnly, readFeeling, type Feeling } from '@engine/characters'
import type { Ruleset } from '@engine/rules'
import { dayOf, intensityOn, nextMorning, type Aftermath, type EndedFeeling, type GameState, type Relation } from '@engine/state'
import type { Pack } from '@engine/pack'
import { fadeMemories } from '@engine/memory'

/**
 * Mood and aftermath across scenes (npc design §7, milestone 4b): what a character carries out of a scene, how it fades
 * over in-game days, and the repeat rule for feelings toward a person. All numbers are the ruleset's `aftermath`.
 */

/** A feeling as a summary writes it: a shade, its family when the shade has several, an intensity and why; `who` for a feeling toward someone. */
export interface WrittenFeeling {
  who?: string
  shade?: unknown
  family?: unknown
  intensity?: unknown
  reason?: unknown
}

/** Who a summary means: "player" or the player's name, else a character by id, full name or first name; never the owner. */
export function whoIs(content: Pack, state: GameState, owner: string, written: string): string | undefined {
  const asked = written.trim().toLowerCase()
  if (!asked) return undefined
  if (asked === 'player' || asked === 'you' || asked === state.player.name.toLowerCase()) return 'player'
  const c = content.characters.find((x) => x.id === asked || x.name.toLowerCase() === asked || firstName(x.name).toLowerCase() === asked)
  return c && c.id !== owner ? c.id : undefined
}

/** A summary's feeling, checked: one of the ruleset's shades, and never mood only (surprise isn't carried). */
export function carried(r: Ruleset, written: WrittenFeeling | undefined): Feeling | string | undefined {
  if (!written) return undefined
  const read = readFeeling(r, written)
  if ('problem' in read) return read.problem
  return moodOnly(r, read.feeling.family) ? `"${read.feeling.shade}" is felt in the moment only` : read.feeling
}

/** Ends what has faded by today and brings the rest up to date; ended feelings toward someone go into the history. Old history is dropped. */
export function fade(r: Ruleset, state: GameState): Pick<GameState, 'aftermath' | 'endedFeelings'> {
  const day = dayOf(r, state.time)
  const ended: EndedFeeling[] = []
  const aftermath = state.aftermath.flatMap((a) => {
    const now = intensityOn(r, a, day)
    if (now <= 0) {
      if (a.toward) ended.push({ owner: a.owner, toward: a.toward, family: a.family, at: state.time, how: 'faded' })
      return []
    }
    const steps = a.intensity - now
    return [steps > 0 ? { ...a, intensity: now, fadedOn: a.fadedOn + steps * r.people.aftermath.fadeDays } : a]
  })
  return { aftermath, endedFeelings: recent(r, state.time, [...state.endedFeelings, ...ended]) }
}

const recent = (r: Ruleset, now: number, ended: EndedFeeling[]) => ended.filter((e) => now - e.at <= r.people.aftermath.historyDays * 24 * 60)

/**
 * The daily upkeep (decided 2026-11-13): at each morning rollover, aftermath and feelings toward a person fade. Fading
 * is worked out from the days that passed, so running it again on the same day changes nothing. Milestone 12's world
 * turn calls the same step as its character upkeep. Memories fade here too (memory §6).
 */
export function dailyUpkeep(content: Pack, state: GameState): GameState {
  return { ...state, ...fade(content.ruleset, state), memories: fadeMemories(content.ruleset, state.memories, state.time) }
}

/** Next day (between scenes only): the clock moves to the next morning, and the daily upkeep runs. */
export function nextDay(content: Pack, state: GameState): GameState {
  if (state.scene) throw new Error('Next day only between scenes')
  return dailyUpkeep(content, { ...state, time: nextMorning(content.ruleset, state.time) })
}

/** What one witness's summary did to what they carry, for the report and the logs. */
export interface CarriedReport {
  /** General aftermath that began or was renewed. */
  aftermath?: Feeling
  toward: { toward: string; feeling: Feeling; renewed: boolean; repeat?: { count: number; meter: string; change: number } }[]
  resolved: string[]
  /** What was refused and why. */
  dropped: string[]
}

/** Moves one meter toward someone: the player's meters, or a relation (made at the ruleset's start if there is none). */
function nudge(r: Ruleset, meters: GameState['meters'], relations: Relation[], from: string, to: string, meter: string, change: number): { meters: GameState['meters']; relations: Relation[] } {
  const clamp = (n: number) => Math.max(r.meters.min, Math.min(r.meters.max, n))
  if (to === 'player') {
    const m = meters[from]!
    return { meters: { ...meters, [from]: { ...m, [meter]: clamp((m[meter] ?? r.meters.neutral) + change) } }, relations }
  }
  const existing = relations.find((x) => x.from === from && x.to === to)
  const base: Relation = existing ?? { from, to, tags: [], meters: { ...r.relations.start } }
  const next = { ...base, meters: { ...base.meters, [meter]: clamp((base.meters[meter] ?? r.meters.neutral) + change) } }
  return { meters, relations: existing ? relations.map((x) => (x === existing ? next : x)) : [...relations, next] }
}

/**
 * Applies one witness's feelings from their summary (npc design §7; decided 2026-11-13):
 * - `resolved`: their feelings toward those people end, as resolved.
 * - `toward`: each becomes a feeling toward that person; one in a family already active toward them renews it. A new one
 *   in a family that ended toward them within the history window is a repeat: the game adds the ruleset's growing
 *   change to the meter the family maps to. More than `towardMax` toward one person: the weakest is replaced.
 * - `feels` (or, without it, their mood as the scene ends) lingers as general aftermath when it is at least
 *   `minIntensity` or the scene gave them a Core memory; one in a family they already carry renews it; more than `max`:
 *   the weakest goes.
 * Tags never change here. A single incident moves meters only through the summary's own meter words.
 */
export function applyCarried(
  content: Pack,
  state: GameState,
  world: { aftermath: Aftermath[]; endedFeelings: EndedFeeling[]; meters: GameState['meters']; relations: Relation[] },
  owner: string,
  summary: { feels?: WrittenFeeling; toward: WrittenFeeling[]; resolved: string[]; level: string },
  sceneId: string
): { world: typeof world; report: CarriedReport } {
  const r = content.ruleset
  const A = r.people.aftermath
  const now = state.time
  const day = dayOf(r, now)
  let { aftermath, endedFeelings, meters, relations } = world
  const report: CarriedReport = { toward: [], resolved: [], dropped: [] }
  const strength = (a: Aftermath) => intensityOn(r, a, day)
  const end = (a: Aftermath, how: EndedFeeling['how']) => {
    aftermath = aftermath.filter((x) => x !== a)
    if (a.toward) endedFeelings = [...endedFeelings, { owner, toward: a.toward, family: a.family, at: now, how }]
  }
  const entry = (f: Feeling, toward?: string): Aftermath => ({ owner, ...(toward && { toward }), shade: f.shade, family: f.family, intensity: f.intensity, reason: f.reason ?? '', since: now, scene: sceneId, fadedOn: day })

  for (const written of summary.resolved) {
    const who = whoIs(content, state, owner, written)
    const theirs = aftermath.filter((a) => a.owner === owner && a.toward === who)
    if (!who || theirs.length === 0) {
      report.dropped.push(`resolved "${written}": no feeling toward them`)
      continue
    }
    for (const a of theirs) end(a, 'resolved')
    report.resolved.push(who)
  }

  for (const written of summary.toward) {
    const who = typeof written.who === 'string' ? whoIs(content, state, owner, written.who) : undefined
    const f = carried(r, written)
    if (!who) {
      report.dropped.push(`toward "${String(written.who ?? '')}": not someone they could feel toward`)
      continue
    }
    if (!f || typeof f === 'string') {
      report.dropped.push(`toward ${who}: ${f ?? 'no feeling'}`)
      continue
    }
    const same = aftermath.find((a) => a.owner === owner && a.toward === who && a.family === f.family)
    if (same) {
      aftermath = aftermath.map((a) => (a === same ? entry(f, who) : a))
      report.toward.push({ toward: who, feeling: f, renewed: true })
      continue
    }
    // A repeat: the same family came back toward the same person after an earlier one ended (npc design §7).
    const count = endedFeelings.filter((e) => e.owner === owner && e.toward === who && e.family === f.family && now - e.at <= A.historyDays * 24 * 60).length
    const map = A.meters[f.family]
    let repeat: CarriedReport['toward'][number]['repeat']
    if (count > 0 && map) {
      const change = A.repeat[Math.min(count, A.repeat.length) - 1]! * map.sign
      ;({ meters, relations } = nudge(r, meters, relations, owner, who, map.meter, change))
      repeat = { count, meter: map.meter, change }
    }
    aftermath = [...aftermath, entry(f, who)]
    const toward = aftermath.filter((a) => a.owner === owner && a.toward === who)
    if (toward.length > A.towardMax) end([...toward].sort((x, y) => strength(x) - strength(y) || x.since - y.since)[0]!, 'replaced')
    report.toward.push({ toward: who, feeling: f, renewed: false, ...(repeat && { repeat }) })
  }

  const written = carried(r, summary.feels)
  if (typeof written === 'string') report.dropped.push(`feels: ${written}`)
  const mood = state.scene?.moods[owner]
  const felt = written && typeof written !== 'string' ? written : mood && !moodOnly(r, mood.family) ? { shade: mood.shade, family: mood.family, intensity: mood.intensity, ...(mood.reason && { reason: mood.reason }) } : undefined
  if (felt && (felt.intensity >= A.minIntensity || summary.level === 'core')) {
    const same = aftermath.find((a) => a.owner === owner && !a.toward && a.family === felt.family)
    aftermath = same ? aftermath.map((a) => (a === same ? entry(felt) : a)) : [...aftermath, entry(felt)]
    const general = aftermath.filter((a) => a.owner === owner && !a.toward)
    if (general.length > A.max) end([...general].sort((x, y) => strength(x) - strength(y) || x.since - y.since)[0]!, 'replaced')
    report.aftermath = felt
  }
  return { world: { aftermath, endedFeelings, meters, relations }, report }
}
