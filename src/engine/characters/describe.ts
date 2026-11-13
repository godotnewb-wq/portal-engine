import type { Ruleset } from '@engine/rules'
import type { Character, TieTag } from './schema'

/**
 * A card's layers and ties in plain words, from the pack's vocabularies (npc design §4, relationships §3): for the
 * director's brief and the end-of-scene summary. Never for the writer, which sees no layer labels.
 */

/** A tag as the card words it ("stepbrother"), or the ruleset's first word for it. */
export const tagWord = (r: Ruleset, t: TieTag): string => t.word ?? r.ties.tags.find((x) => x.id === t.tag)?.words[0] ?? t.tag

/** The axis stages that set a character apart: listed stages other than an axis's middle one. */
export function nature(r: Ruleset, c: Character): string {
  if (!c.layers) return ''
  const words = (axes: Ruleset['people']['axes'], set: Record<string, string>) =>
    axes.flatMap((a) => {
      const stage = set[a.id]
      return stage && stage !== a.stages[Math.floor(a.stages.length / 2)] ? [stage] : []
    })
  return [...new Set([...words(r.people.axes, c.layers.axes), ...words(r.people.attachment, c.layers.attachment)])].join(', ')
}

/** What they care about, strongest first, in their own words where the card has them; then what they hold sacred. */
export function caresAbout(r: Ruleset, c: Character): string {
  if (!c.layers) return ''
  const strengths = r.people.values.strengths
  const name = (v: { value: string; personal?: string }) => v.personal ?? (r.people.values.list.find((x) => x.id === v.value)?.name ?? v.value).toLowerCase()
  const values = [...c.layers.values].sort((a, b) => strengths.indexOf(b.strength) - strengths.indexOf(a.strength))
  const likes = values.filter((v) => v.stance === 'likes').map((v) => `${name(v)} (${v.strength})`)
  const dislikes = values.filter((v) => v.stance === 'dislikes').map(name)
  const top = r.people.foundations.sensitivities.at(-1)
  const sacred = Object.entries(c.layers.foundations)
    .filter(([, s]) => s === top)
    .map(([id]) => r.people.foundations.list.find((f) => f.id === id)?.name.toLowerCase() ?? id)
  return [likes.length > 0 && likes.join('; '), dislikes.length > 0 && `against: ${dislikes.join('; ')}`, sacred.length > 0 && `${top}: ${sacred.join(', ')}`].filter(Boolean).join(' · ')
}

