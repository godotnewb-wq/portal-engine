import { firstName } from '@engine/core'
import { tagWord } from '@engine/characters'
import { characterById, type Pack } from '@engine/pack'
import { applyTie, needsAgreement, tagNamed, tagsToward, tieProblem, type GameState, type TieChange, type TieEvent } from '@engine/state'
import { witnesses } from './summary'

/**
 * Relationship changes at the end of a scene (relationships §3; milestone 4c, decided 2026-11-16, user, replacing the
 * tie check that read the pair from outside and got the direction wrong). Each witness says, in their own relationship
 * call, what someone here became to them or stopped being, with the line that shows it; the game settles what they
 * said:
 * - a tag that isn't one-sided **begins** only when both people's calls say it, a tag on one side and its counterpart
 *   on the other; one side alone changes nothing and is noted;
 * - a tag **ends** on one call: a breakup takes one person;
 * - the quoted line must be in the scene (`findLine`), or the statement is refused;
 * - a tie with the player needs the character's call alone (the player has none), and an arrangement waits for the
 *   player's answer as before.
 * The design leans toward missing a real change over recording a false one.
 */

/** What a witness's call said about one person: what they are now, what they are no longer, and the line that shows it. */
export interface WrittenTie {
  with: string
  now?: string
  no_longer?: string
  line: string
}

/** A statement with the witness who made it. */
export interface StatedTie extends WrittenTie {
  by: string
}

export interface SettledTies {
  state: GameState
  applied: TieEvent[]
  pending: TieChange[]
  /** Statements the game could not use, with why. */
  refused: string[]
  /** Tags one side reported beginning and the other didn't: nothing changed. */
  alone: string[]
}

const norm = (s: string) => s.trim().toLowerCase()

/** Letters and digits only, lower case, single spaces: how a quoted line and the scene are compared. */
const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** A quoted line needs at least this many words to be looked for; "Yes." is in every scene. */
const LINE_MIN_WORDS = 2
/** A line that isn't in the scene word for word still counts when it is long enough and this share of its words is in one turn (tune). */
const LINE_LOOSE_WORDS = 4
const LINE_LOOSE_SHARE = 0.8

/**
 * The turn a quoted line is in, by index, or undefined when it isn't in the scene. Forgiving about punctuation, case
 * and a speaker's name in front; a line with a few words off still counts when most of its words are in one turn.
 * Reads the player's words too: a breakup the player said is the player's line.
 */
export function findLine(state: GameState, line: string): number | undefined {
  const scene = state.scene!
  const asked = plain(line.replace(/^\s*[\p{L}' -]{1,30}:\s*(?=\S)/u, ''))
  const words = asked.split(' ').filter(Boolean)
  if (words.length < LINE_MIN_WORDS) return undefined
  const texts = scene.turns.map((t) => [t.player, ...t.beats.map((b) => b.text)].map(plain))
  const exact = texts.findIndex((parts) => parts.some((p) => ` ${p} `.includes(` ${asked} `)))
  if (exact >= 0) return exact
  if (words.length < LINE_LOOSE_WORDS) return undefined
  const loose = texts.findIndex((parts) => {
    const said = new Set(parts.join(' ').split(' '))
    return words.filter((w) => said.has(w)).length / words.length >= LINE_LOOSE_SHARE
  })
  return loose >= 0 ? loose : undefined
}

/** One statement, read: who it is about, the tag that began with its word, the tag that ended, and the turn of its line. */
interface Claim {
  by: string
  to: string
  add?: string
  word?: string
  end?: string
  line: string
  turn?: string
  /** Its counterpart on the other side was found, or it was applied. */
  used?: boolean
}

/**
 * Settles what the witnesses said, each change checked against the state the ones before it left (`tieProblem`). Tags
 * that begin are settled first, then tags that end on their own: a tag already ended by one that began (a group that
 * holds one at a time), or by the other side's own statement, is not ended twice. Once all are settled, a tag that
 * ended with nothing begun in its place becomes its `endsAs` tag (partner → ex) on both sides, as part of the same
 * event, unless the pair still holds a tag of its group (decided 2026-11-16, user).
 */
export function settleTies(content: Pack, state: GameState, stated: StatedTie[]): SettledTies {
  const scene = state.scene!
  const r = content.ruleset
  const here = witnesses(state)
  const def = (id?: string) => r.ties.tags.find((x) => x.id === id)
  const name = (id: string) => (id === 'player' ? state.player.name : firstName(characterById(content, id)?.name ?? id))
  const isPlayer = (w: string) => norm(w) === 'player' || norm(w) === norm(state.player.name)
  const who = (w: string): string | undefined =>
    here.find((id) => {
      const c = characterById(content, id)
      return id === norm(w) || (!!c && (norm(c.name) === norm(w) || norm(firstName(c.name)) === norm(w)))
    })
  /** The word a witness used, when it is one of the tag's own words: it becomes that side's word. */
  const wordOf = (tag: string, written: string) => def(tag)!.words.find((w) => norm(w) === norm(written))
  const words = (tag: string, word?: string) => tagWord(r, { tag, ...(word && { word }) })

  const refused: string[] = []
  const alone: string[] = []
  const claims: Claim[] = []
  for (const t of stated) {
    const by = who(t.by)
    if (!by) continue
    const to = isPlayer(t.with) ? 'player' : who(t.with)
    const about = `${name(by)}, about ${to ? name(to) : `"${t.with}"`}`
    if (!to || to === by) {
      refused.push(`${about}: they weren't someone else in the scene`)
      continue
    }
    // A tag by its id or one of its words, or by the word this witness's own tie to them already uses (a card's "rival").
    const named = (written?: string) => tagNamed(content, written) ?? (written ? tagsToward(state, by, to).find((x) => x.word && norm(x.word) === norm(written))?.tag : undefined)
    const add = named(t.now)
    const end = named(t.no_longer)
    if (t.now && !add) {
      refused.push(`${about}: no tag "${t.now}"`)
      continue
    }
    if (t.no_longer && !end) {
      refused.push(`${about}: no tag "${t.no_longer}"`)
      continue
    }
    if (!add && !end) {
      refused.push(`${about}: it says nothing began or ended`)
      continue
    }
    const at = findLine(state, t.line)
    if (at === undefined) {
      refused.push(`${about}: the line isn't in the scene (${t.line.trim() ? `"${t.line.trim()}"` : 'none given'})`)
      continue
    }
    const word = add && t.now ? wordOf(add, t.now) : undefined
    claims.push({ by, to, ...(add && { add }), ...(word && { word }), ...(end && { end }), line: t.line.trim(), turn: scene.turns[at]!.id })
  }

  let next = state
  const applied: TieEvent[] = []
  const pending: TieChange[] = []
  const apply = (c: Claim, change: TieChange): void => {
    const problem = tieProblem(content, next, change)
    if (problem) return void refused.push(`${name(c.by)}, about ${name(c.to)}: ${problem}`)
    if (c.to === 'player' && change.add && needsAgreement(content, change.add)) return void pending.push(change)
    const done = applyTie(content, next, change, c.turn)
    next = done.state
    applied.push(done.event)
  }

  // Tags that begin. A statement that also ends a tag (no longer my fiancé, now my husband) carries the ending with it,
  // so an ending never applies when the beginning it belongs to doesn't.
  for (const c of claims) {
    if (!c.add || c.used) continue
    c.used = true
    const tag = def(c.add)!
    const change: TieChange = { from: c.by, to: c.to, add: c.add, ...(c.word && { word: c.word }), ...(c.end && { end: c.end }), reason: '', line: c.line }
    if (c.to === 'player' || tag.oneSided) {
      apply(c, change)
      continue
    }
    const other = claims.find((x) => !x.used && x.by === c.to && x.to === c.by && x.add === tag.counterpart)
    if (!other) {
      alone.push(`${name(c.by)} says ${name(c.to)} is now ${name(c.by)}'s ${words(c.add, c.word)}; ${name(c.to)} doesn't say ${name(c.by)} is now ${name(c.to)}'s ${words(tag.counterpart)}`)
      continue
    }
    other.used = true
    apply(c, { ...change, ...(other.word && { backWord: other.word }) })
    // The other side's own ending, if its statement carried one, stands on its own below.
    if (other.end) claims.push({ by: other.by, to: other.to, end: other.end, line: other.line, ...(other.turn && { turn: other.turn }) })
  }

  // Tags that end on their own: one call is enough.
  for (const c of claims) {
    if (c.add || !c.end) continue
    const back = def(c.end)!.oneSided ? undefined : def(c.end)!.counterpart
    const done = applied.some((e) => (e.from === c.by && e.to === c.to && e.ended.includes(c.end!)) || (!!back && e.from === c.to && e.to === c.by && e.ended.includes(back)))
    if (done && !tagsToward(next, c.by, c.to).some((t) => t.tag === c.end)) continue
    apply(c, { from: c.by, to: c.to, end: c.end, reason: '', line: c.line })
  }

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
  return { state: { ...next, scene: { ...s, tieEvents: [...s.tieEvents, ...applied], pendingTies: [...s.pendingTies, ...pending] } }, applied, pending, refused, alone }
}
