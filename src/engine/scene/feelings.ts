import { firstName } from '@engine/core'
import { shadeWords, type Character, type Feeling } from '@engine/characters'
import type { Ruleset } from '@engine/rules'
import type { GameState, Scene } from '@engine/state'
import { factionChain } from '@engine/world'
import { characterById, type Pack } from '@engine/pack'
import { feelingsToward } from './resolve'
import { presentCast, type BeatPlan, type PlannedCheck } from './planShape'

/**
 * Felt vs. shown (npc design §7, milestone 4b). The director decides what a character feels; the game works out how
 * much of it shows, from the card's masking and who is watching; the writer gets the result in words with the card's
 * display line, and the `EXPRESSION` tag puts it on the sprite. A reading check can see through the mask.
 */

/** The masking a character has for a family: the card's own word for it, else their masking axis's default (an unlisted axis counts as its middle stage). */
export function maskingOf(r: Ruleset, c: Character, family: string): string {
  const own = c.expression?.masking[family]
  if (own) return own
  const m = r.people.masking
  const axis = [...r.people.axes, ...r.people.attachment].find((a) => a.id === m.axis)
  const stage = c.layers?.axes[m.axis] ?? c.layers?.attachment[m.axis] ?? axis?.stages[Math.floor(axis.stages.length / 2)]
  return (stage && m.byStage[stage]) ?? m.levels[Math.floor(m.levels.length / 2)]!
}

/** A character's stage on the masking axis (Composure, in the design's terms), or its middle stage when the card doesn't list it. */
function maskingStage(r: Ruleset, c: Character): string | undefined {
  const m = r.people.masking
  const axis = [...r.people.axes, ...r.people.attachment].find((a) => a.id === m.axis)
  return c.layers?.axes[m.axis] ?? c.layers?.attachment[m.axis] ?? axis?.stages[Math.floor(axis.stages.length / 2)]
}

export interface Audience {
  /** The ruleset's `guarded` or `trusted` amount, or 0. */
  value: number
  /** Why, in words, for the trace. */
  why: string
}

/**
 * Who is watching (npc design §7; decided 2026-11-13): guarded when anyone present is a stranger to them (a character
 * with no saved relation and no tag, or a walk-on, who never has one), someone they hold a guarded tag toward, or a
 * member of a faction whose stance toward theirs is among the coldest; trusted when everyone present, the player
 * included, is above the ruleset's trust; otherwise neither. The player is never a stranger: every character holds
 * meters toward the player from the start.
 */
/**
 * The walk-ons watching: those on screen, with a line in an earlier turn or brought in by this turn's plan. One who is
 * only part of the location never shows up and watches no one (manual run of 2026-11-19, where a card player at the
 * next table, never written in, kept every feeling in the room a step down for the whole scene).
 */
export function watchingWalkOns(scene: Scene, plan?: Pick<BeatPlan, 'walk_ons'>): string[] {
  const seen = new Set(scene.turns.flatMap((t) => t.beats.flatMap((b) => (b.kind === 'dialogue' ? [b.speaker] : []))))
  for (const w of plan?.walk_ons ?? []) seen.add(w.id)
  return scene.walkOns.filter((id) => seen.has(id))
}

export function audienceOf(content: Pack, state: GameState, id: string, plan?: Pick<BeatPlan, 'walk_ons'>): Audience {
  const r = content.ruleset
  const v = r.people.visibility
  const scene = state.scene!
  const c = characterById(content, id)
  const others = presentCast(scene).filter((o) => o !== id)
  const guardedTag = (tags: { tag: string }[]) => tags.some((t) => v.guardedTags.includes(t.tag))
  const words = content.vocabulary.stanceWords
  const mine = c?.faction ? factionChain(content.setting, c.faction).map((f) => f.id) : []
  const hostile = (o: string) => {
    const theirs = characterById(content, o)?.faction
    if (!theirs || mine.length === 0 || words.length === 0) return false
    const chain = factionChain(content.setting, theirs).map((f) => f.id)
    return content.setting.stances.some((s) => chain.includes(s.from) && mine.includes(s.toward) && words.indexOf(s.stance) >= words.length - v.hostileStances)
  }
  const reasons: string[] = []
  if (watchingWalkOns(scene, plan).length > 0) reasons.push('walk-ons present')
  for (const o of others) {
    const rel = state.relations.find((x) => x.from === id && x.to === o)
    const name = firstName(characterById(content, o)?.name ?? o)
    if (!rel) reasons.push(`${name} is a stranger`)
    else if (guardedTag(rel.tags)) reasons.push(`guarded toward ${name}`)
    else if (hostile(o)) reasons.push(`${name}'s faction is hostile`)
  }
  if (guardedTag(state.playerTies[id]?.tags ?? [])) reasons.push('guarded toward the player')
  if (reasons.length > 0) return { value: v.guarded, why: reasons.join('; ') }
  const trusted = [...others, 'player'].every((o) => (feelingsToward(r, state, id, o)[v.trustMeter] ?? 0) > v.trust)
  return trusted ? { value: v.trusted, why: 'only people they trust' } : { value: 0, why: '' }
}

/** How a feeling shows: the number, the ruleset's band for it, and the card's line for how it looks when it shows. */
export interface Shown {
  id: string
  feeling: Feeling
  masking: string
  audience: Audience
  visibility: number
  band: string
  /** The band as a sentence, for the writer ("It shows only in small tells"). */
  shows: string
  /** How it looks on them when it shows: the card's line for the shade, else for its family. None when hidden. */
  display?: string
}

/** visibility = intensity − masking + audience (npc design §7). Masking is the level's position in the ruleset's list. */
export function shown(content: Pack, state: GameState, id: string, feeling: Feeling, plan?: Pick<BeatPlan, 'walk_ons'>): Shown | undefined {
  const r = content.ruleset
  const c = characterById(content, id)
  if (!c) return undefined
  const masking = maskingOf(r, c, feeling.family)
  const audience = audienceOf(content, state, id, plan)
  const visibility = feeling.intensity - Math.max(0, r.people.masking.levels.indexOf(masking)) + audience.value
  const bands = r.people.visibility.bands
  const band = bands.find((b) => b.max !== undefined && visibility <= b.max) ?? bands.at(-1)!
  const display = band === bands[0] ? undefined : (c.expression?.shades[feeling.shade] ?? c.expression?.display[feeling.family])
  return { id, feeling, masking, audience, visibility, band: band.word, shows: band.shows, ...(display && { display }) }
}

/** What each character present feels once this turn's plan applies: the plan's `feels` for speakers and reactions, else what carries. */
export function feelingsNow(state: GameState, plan: Pick<BeatPlan, 'speakers' | 'reactions'>): Record<string, Feeling> {
  const now: Record<string, Feeling> = { ...state.scene!.moods }
  for (const s of plan.speakers) if (s.feels) now[s.id] = s.feels
  for (const x of plan.reactions) if (x.feels) now[x.id] = x.feels
  return now
}

/**
 * A reading check's difficulty (npc design §7; decided 2026-11-13): the ruleset's word for the target's masking of
 * what they feel, one step harder for the masking-axis stages it names (Composure *masked*), and never past the
 * hardest. The director's own word doesn't count.
 */
export function readingDifficulty(r: Ruleset, target: Character, feeling: Feeling | undefined): string {
  const masking = feeling ? maskingOf(r, target, feeling.family) : maskingOf(r, target, '')
  const base = r.people.reading.difficulty[masking] ?? r.difficulties[0]!.word
  const stage = maskingStage(r, target)
  if (!stage || !r.people.reading.harder.includes(stage)) return base
  const i = r.difficulties.findIndex((d) => d.word === base)
  return r.difficulties[Math.min(i + 1, r.difficulties.length - 1)]!.word
}

/** Whether a check reads someone: the ruleset's reading skill, with a target. */
export const isReading = (r: Ruleset, c: Pick<PlannedCheck, 'skill' | 'target'>): boolean => c.skill === r.people.reading.skill && !!c.target

/** A feeling as the writer reads it: the shade (with its family when it has several) and why, never a number. */
export function feltWords(r: Ruleset, f: Feeling): string {
  return `${shadeWords(r, f)}${f.reason ? `: ${f.reason.replace(/[.\s]+$/, '')}` : ''}`
}

/** How much shows, for the writer: the band's sentence, then the card's display line when it shows. */
export function shownWords(s: Shown): string {
  return `${s.shows}${s.display ? `: ${s.display.replace(/[.\s]+$/, '')}` : ''}`
}
