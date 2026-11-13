import { firstName } from '@engine/core'
import { shadeWords, type Feeling } from '@engine/characters'
import type { Ruleset } from '@engine/rules'
import { characterById, type Pack } from '@engine/pack'
import type { Aftermath, GameState } from './schema'

/**
 * Days before milestone 6's clock (milestone 4b; decided 2026-11-13): the game clock (`state.time`, minutes since the
 * start) is the only one. A day starts at the ruleset's `clock.morning`; the daily upkeep runs at each such rollover.
 */
export const MINUTES_PER_DAY = 24 * 60

/** Which in-game day a time falls on, counting from the morning rollover. */
export const dayOf = (r: Ruleset, time: number): number => Math.floor((time - r.clock.morning) / MINUTES_PER_DAY)

/** How old something is, in calendar days crossed (midnights), as prompts word it ("4 days ago"). */
export const daysSince = (from: number, now: number): number => Math.max(0, Math.floor(now / MINUTES_PER_DAY) - Math.floor(from / MINUTES_PER_DAY))

/** The first morning after a time: where Next day moves the clock. */
export function nextMorning(r: Ruleset, time: number): number {
  const today = Math.floor(time / MINUTES_PER_DAY) * MINUTES_PER_DAY + r.clock.morning
  return today > time ? today : today + MINUTES_PER_DAY
}

/** An aftermath entry's intensity on a day: it loses a point every `aftermath.fadeDays` since its last step; 0 means it has ended. */
export function intensityOn(r: Ruleset, a: Aftermath, day: number): number {
  return Math.max(0, a.intensity - Math.floor(Math.max(0, day - a.fadedOn) / r.people.aftermath.fadeDays))
}

/** "a few words ago", for prompts: "today", "1 day ago", "4 days ago". */
export const agoWords = (days: number): string => (days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`)

/** Who a feeling is toward, by name: the player's, or a character's first name. */
export function towardName(content: Pack, state: GameState, toward: string): string {
  return toward === 'player' ? state.player.name : firstName(characterById(content, toward)?.name ?? toward)
}

/**
 * The mood a character opens a scene with (npc design §7; decided 2026-11-13): the strongest of their active aftermath
 * and their feelings toward someone in the scene (the player always is), a feeling toward someone present winning a
 * tie; none, and the card's default stands.
 */
export function openingMood(content: Pack, state: GameState, id: string, cast: string[]): Feeling | undefined {
  const r = content.ruleset
  const day = dayOf(r, state.time)
  const here = (a: Aftermath) => !a.toward || a.toward === 'player' || cast.includes(a.toward)
  const best = state.aftermath
    .filter((a) => a.owner === id && here(a))
    .map((a) => ({ a, now: intensityOn(r, a, day) }))
    .filter((x) => x.now > 0)
    .sort((x, y) => y.now - x.now || Number(!!y.a.toward) - Number(!!x.a.toward))[0]
  if (!best) return undefined
  const { a, now } = best
  const reason = a.toward ? `toward ${towardName(content, state, a.toward)}${a.reason ? `: ${a.reason}` : ''}` : a.reason
  return { shade: a.shade, family: a.family, intensity: now, ...(reason && { reason }) }
}

/** A carried feeling in words for prompts: "sorrow, 3 of 5: his brother died (4 days ago)"; with `toward`, who it's toward first. */
export function aftermathWords(content: Pack, state: GameState, a: Aftermath): string {
  const r = content.ruleset
  const now = intensityOn(r, a, dayOf(r, state.time))
  const who = a.toward ? `toward ${towardName(content, state, a.toward)}: ` : ''
  return `${who}${shadeWords(r, a)}, ${now} of 5${a.reason ? `: ${a.reason}` : ''} (${agoWords(daysSince(a.since, state.time))})`
}

/**
 * What a character carries, in words (npc design §7): their general aftermath, and their feelings toward people (only
 * toward `people` when given). Faded ones are left out.
 */
export function carrying(content: Pack, state: GameState, id: string, people?: string[]): { general: string[]; toward: string[] } {
  const r = content.ruleset
  const day = dayOf(r, state.time)
  const active = state.aftermath.filter((a) => a.owner === id && intensityOn(r, a, day) > 0)
  return {
    general: active.filter((a) => !a.toward).map((a) => aftermathWords(content, state, a)),
    toward: active.filter((a) => a.toward && (!people || people.includes(a.toward))).map((a) => aftermathWords(content, state, a))
  }
}

/**
 * Noticing absence (npc design §7; decided 2026-11-13): for a character with a close tie to the player (the ruleset's
 * `absence` tags, or family), how long since they last shared a scene, in words; nothing under a day, or if never.
 * Context only: no rule makes a feeling from it before milestone 12.
 */
export function absenceWords(content: Pack, state: GameState, id: string): string | undefined {
  const r = content.ruleset
  const close = (state.playerTies[id]?.tags ?? []).some((t) => r.people.absence.tags.includes(t.tag) || (r.people.absence.family && r.ties.tags.find((x) => x.id === t.tag)?.family))
  const seen = state.lastSeen[id]
  if (!close || seen === undefined) return undefined
  const days = daysSince(seen, state.time)
  return days >= 1 ? `hadn't seen ${state.player.name} in ${days === 1 ? 'a day' : `${days} days`}` : undefined
}
