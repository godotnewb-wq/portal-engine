import { firstName } from '@engine/core'
import { tagWord, type TieTag } from '@engine/characters'
import { characterById, type Pack } from '@engine/pack'
import type { GameState, Relation } from './schema'
import type { TieChange, TieEvent } from './scene'

/**
 * Relationship tags in play (relationships §3, milestone 4b): tags change only through story developments, as tie
 * changes from the director's plan (`set_tie`), quest outcomes and authored events. A tag that isn't one-sided changes
 * with its counterpart on the other side; the player holds none, so nothing is mirrored toward the player. A tag past
 * the ruleset's limit ends the oldest tag that isn't family (decided 2026-11-13); with only family tags it can't be added.
 */

/** A tag by its id or one of its words, as the director may write it. */
export function tagNamed(content: Pack, written: string | undefined): string | undefined {
  const asked = (written ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (!asked) return undefined
  return content.ruleset.ties.tags.find((t) => t.id === asked || t.words.some((w) => w.toLowerCase().replace(/\s+/g, '-') === asked))?.id
}

/** The tags `from` holds toward `to` now: toward the player, their tie to the player; toward a character, their relation. */
export function tagsToward(state: GameState, from: string, to: string): TieTag[] {
  return to === 'player' ? (state.playerTies[from]?.tags ?? []) : (state.relations.find((x) => x.from === from && x.to === to)?.tags ?? [])
}

/** Whether a tag with the player begins only with the player's agreement: the ruleset's `ties.agreement` list, and family. */
export function needsAgreement(content: Pack, tag: string): boolean {
  const t = content.ruleset.ties.tags.find((x) => x.id === tag)
  return !!t && !t.oneSided && (t.family || content.ruleset.ties.agreement.includes(tag))
}

/** One side's tags after a change: `end` removed, `add` appended (newest last), and past the limit the oldest non-family one dropped. */
function changed(content: Pack, tags: TieTag[], add: TieTag | undefined, end: string | undefined): { tags: TieTag[]; dropped?: string } | { problem: string } {
  const r = content.ruleset.ties
  let next = tags.filter((t) => t.tag !== end)
  if (!add || next.some((t) => t.tag === add.tag)) return { tags: next }
  next = [...next, add]
  if (next.length <= r.max) return { tags: next }
  const oldest = next.slice(0, -1).find((t) => !r.tags.find((x) => x.id === t.tag)?.family)
  if (!oldest) return { problem: `all ${r.max} of the tags already held are family` }
  return { tags: next.filter((t) => t !== oldest), dropped: oldest.tag }
}

/** What's wrong with a change before it is applied, or nothing: unknown tags, ending a tag not held, adding one held, or no room. */
export function tieProblem(content: Pack, state: GameState, c: TieChange): string | undefined {
  const r = content.ruleset.ties
  const def = (id?: string) => r.tags.find((t) => t.id === id)
  if (!c.add && !c.end) return 'it adds and ends nothing'
  // Ending a tag and adding it back changes nothing, so it isn't a story development (found by the end-of-Milestone-4
  // bench: a wedding planned as "end fiancé, add fiancé" counted as a tie event and forced two Core memories).
  if (c.add && c.add === c.end) return `it ends and adds "${c.add}", which changes nothing`
  if (c.add && !def(c.add)) return `no tag "${c.add}"`
  if (c.end && !def(c.end)) return `no tag "${c.end}"`
  const held = tagsToward(state, c.from, c.to)
  if (c.end && !held.some((t) => t.tag === c.end)) return `${c.from} doesn't hold "${c.end}" toward ${c.to}`
  if (c.add && held.some((t) => t.tag === c.add)) return `${c.from} already holds "${c.add}" toward ${c.to}`
  const mine = changed(content, held, c.add ? { tag: c.add } : undefined, c.end)
  if ('problem' in mine) return `${c.from} toward ${c.to}: ${mine.problem}`
  const back = c.to !== 'player' && c.add && !def(c.add)!.oneSided ? changed(content, tagsToward(state, c.to, c.from), { tag: def(c.add)!.counterpart }, c.end && !def(c.end)!.oneSided ? def(c.end)!.counterpart : undefined) : undefined
  if (back && 'problem' in back) return `${c.to} toward ${c.from}: ${back.problem}`
  return undefined
}

/**
 * Applies a checked tie change (`tieProblem` found nothing): both sides' tags, the counterpart's, a tag dropped at the
 * limit and its counterpart, and the reason as the new relationship note on both sides. Returns what happened.
 */
export function applyTie(content: Pack, state: GameState, c: TieChange, turn?: string): { state: GameState; event: TieEvent } {
  const r = content.ruleset
  const def = (id?: string) => r.ties.tags.find((t) => t.id === id)
  const tag = (id: string, word?: string): TieTag => ({ tag: id, ...(word && def(id)!.words.includes(word) && { word }) })
  let playerTies = state.playerTies
  let relations: Relation[] = state.relations
  const set = (from: string, to: string, tags: TieTag[]) => {
    if (to === 'player') {
      playerTies = { ...playerTies, [from]: { tags, note: c.reason || playerTies[from]?.note } }
      return
    }
    const existing = relations.find((x) => x.from === from && x.to === to)
    const next: Relation = { ...(existing ?? { from, to, meters: { ...r.relations.start } }), tags, ...((c.reason || existing?.note) && { note: c.reason || existing?.note }) }
    relations = existing ? relations.map((x) => (x === existing ? next : x)) : [...relations, next]
  }
  const view = () => ({ ...state, playerTies, relations })
  const added: string[] = []
  const ended: string[] = []

  const mine = changed(content, tagsToward(state, c.from, c.to), c.add ? tag(c.add, c.word) : undefined, c.end)
  if ('problem' in mine) throw new Error(mine.problem)
  set(c.from, c.to, mine.tags)
  if (c.add) added.push(c.add)
  if (c.end) ended.push(c.end)
  if (mine.dropped) ended.push(mine.dropped)

  if (c.to !== 'player') {
    // The other side: the counterpart of what began and of what ended (one-sided tags have none).
    const mirror = (id?: string) => (id && !def(id)!.oneSided ? def(id)!.counterpart : undefined)
    const endBack = [mirror(c.end), mirror(mine.dropped)].filter((x): x is string => !!x)
    let theirs = tagsToward(view(), c.to, c.from).filter((t) => !endBack.includes(t.tag))
    const addBack = mirror(c.add)
    if (addBack) {
      const back = changed(content, theirs, tag(addBack, c.backWord), undefined)
      if ('problem' in back) throw new Error(back.problem)
      theirs = back.tags
      // A tag the other side dropped at the limit ends on this side too.
      const echo = back.dropped && mirror(back.dropped)
      if (echo) set(c.from, c.to, tagsToward(view(), c.from, c.to).filter((t) => t.tag !== echo))
    }
    set(c.to, c.from, theirs)
  }
  return { state: view(), event: { from: c.from, to: c.to, added, ended, ...(c.word && { word: c.word }), reason: c.reason, ...(turn && { turn }) } }
}

/**
 * A change in words: "Ben becomes Ada's partner", "Ben is no longer Ada's friend". `toPlayer`: said to the player, so a
 * change toward them reads "you become Ada's partner".
 */
export function tieWords(content: Pack, state: GameState, c: TieChange, toPlayer = false): string {
  const r = content.ruleset
  const name = (id: string) => (id === 'player' ? state.player.name : firstName(characterById(content, id)?.name ?? id))
  const whose = `${name(c.from)}'s`
  const you = toPlayer && c.to === 'player'
  const subject = you ? 'you' : name(c.to)
  const parts = [
    c.add && `${subject} ${you ? 'become' : 'becomes'} ${whose} ${tagWord(r, { tag: c.add, ...(c.word && { word: c.word }) })}`,
    c.end && `${subject} ${you ? 'are' : 'is'} no longer ${whose} ${tagWord(r, { tag: c.end })}`
  ].filter(Boolean)
  return parts.join(', and ')
}

/**
 * The player's answer to a pending tie change (relationships §3: an arrangement with the player needs their agreement;
 * decided 2026-11-13: a confirm prompt). Yes applies it, if it still can be, as part of the turn that proposed it; either
 * answer is passed to the director's next turn.
 */
export function answerTie(content: Pack, state: GameState, index: number, accepted: boolean): GameState {
  const scene = state.scene
  const change = scene?.pendingTies[index]
  if (!scene || !change) throw new Error('No such tie change waiting for an answer')
  const rest = scene.pendingTies.filter((_, i) => i !== index)
  const ok = accepted && !tieProblem(content, state, change)
  const applied = ok ? applyTie(content, state, change, scene.turns.at(-1)?.id) : undefined
  const next = applied?.state ?? state
  return {
    ...next,
    scene: { ...scene, pendingTies: rest, answered: [...scene.answered, { ...change, accepted: ok }], tieEvents: applied ? [...scene.tieEvents, applied.event] : scene.tieEvents }
  }
}

/** What the player is asked about a pending change: "Become Ada's partner?", or "Become Ada's spouse, no longer Ada's fiancé?" */
export function tieQuestion(content: Pack, c: TieChange): string {
  const r = content.ruleset
  const who = firstName(characterById(content, c.from)?.name ?? c.from)
  const word = (tag: string, w?: string) => tagWord(r, { tag, ...(w && { word: w }) })
  if (!c.add) return `Stop being ${who}'s ${word(c.end!)}?`
  return `Become ${who}'s ${word(c.add, c.word)}${c.end ? `, no longer ${who}'s ${word(c.end)}` : ''}?`
}
