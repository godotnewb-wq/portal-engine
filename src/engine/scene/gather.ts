import { knows, mentions, triggeredEntries, type CodexEntry } from '@engine/codex'
import { firstName } from '@engine/core'
import { tagWord, type Character } from '@engine/characters'
import { recall } from '@engine/memory'
import { modifier, rankOf } from '@engine/rules'
import { characterById, locationById, type Pack } from '@engine/pack'
import type { GameState } from '@engine/state'
import type { Briefs } from './brief'
import { buildBriefs } from './director'
import { canSay, sceneFacts, toldPlayer } from './facts'
import { knowerIn, turnLore, type TurnLore } from './lore'
import { presentCast } from './planShape'
import { statsOf } from './resolve'
import { secretDisplay, touchOf, type SecretScan } from './secrets'

/**
 * What the `scene` pipeline's game gathers before the director plans (scene system redesign §4 "The game", §5;
 * Milestone 5 plan, task 1). The game decides what could be live, so the director chooses among real options rather
 * than marking a secret in every slot (round 0: 96–100%), and it builds each character's short pool of facts, so the
 * director picks from what fits rather than scripting a fact per line.
 */

/** A fact a character may draw on this turn, marked by where it came from (decided 2026-11-20, user: one pool, marked). */
export interface PoolFact {
  /** Its id: a card fact `<character>.k<n>`, a memory's id, `lore.<entry>`, or `place.<n>`. */
  id: string
  text: string
  source: 'card' | 'memory' | 'lore' | 'place'
  /** The player hasn't been told it on screen this scene. */
  unheard: boolean
}

/** A secret that something just said touches, so its holder may play it live (Q5). */
export interface SecretOption {
  id: string
  text: string
  /** What touched it: one of its keywords, its subject, or someone it names who isn't here. */
  how: 'keyword' | 'subject' | 'person'
  /** The keyword, the subject's title or the person's name, as the game found it. */
  by: string
}

/** A relationship in play this turn: the other person is here, or was just named (Q5 default, confirmed 2026-11-20). */
export interface TieOption {
  /** A character id, or `player`. */
  with: string
  /** The tags in words ("sister, business partner"); empty for a tie that is only a note. */
  words: string
  note?: string
  how: 'present' | 'named'
}

/** Tonight's aim and how hard it presses now: the card's starting word until the director has moved it. */
export interface GoalOption {
  text: string
  strength: string
  /** The strength as an index into the ruleset's pressure words, weakest first. */
  level: number
}

export interface PressureOptions {
  goal: GoalOption
  secrets: SecretOption[]
  ties: TieOption[]
}

/** A pressure played live on a turn, as the state keeps it (`Turn.live`). */
export interface LiveRecord {
  who: string
  kind: 'goal' | 'secret' | 'tie'
  ref: string
}

/**
 * Someone present who could see through a holder's dodge or lie (Milestone 5 plan, task 2; criterion 8): they know the
 * holder (a tie or a history between them) and can roll the ruleset's reading skill. No run before Milestone 5 had a
 * companion read: the director was told to give the read to "someone present who could see through it" and never
 * told who that was, so it gave it to the player or to no one.
 */
export interface Reader {
  who: string
  /** Their reading bonus: the skill's attribute modifier plus their rank, as a roll would count it. */
  bonus: number
  /** What they are to the holder, in words: the tags, or the history note. */
  knows: string
}

/** Readers listed per holder, at most this many, best first. */
export const MAX_READERS = 2

export interface Gathered {
  /** What could be live for each character present, by id. */
  options: Record<string, PressureOptions>
  /** What was live for them in the ruleset's `scene.recentTurns` last turns, newest first. */
  recent: Record<string, LiveRecord[]>
  /** The facts each character present may draw on, best first, at most the ruleset's `scene.factPool`. */
  pools: Record<string, PoolFact[]>
  /** For each holder of a secret something just touched: who present could see through them, best first. */
  readers: Record<string, Reader[]>
}

/** The player's words and the last turn: where something must be said to touch a secret or name a person (Q5). */
export function justSaid(state: GameState, input: string): { texts: string[]; written: string[] } {
  const last = state.scene!.turns.at(-1)
  return { texts: [input, last?.player ?? ''].filter(Boolean), written: last?.beats.map((b) => b.text) ?? [] }
}

/** Everyone's names, which the codex scan leaves out (a person is not a topic), as the lore layers do. */
function peopleNames(content: Pack, state: GameState): string[] {
  const location = locationById(content, state.scene!.locationId)
  const people = [...content.characters.map((c) => c.name), state.player.name, ...(location?.walkOns.flatMap((w) => (w.name ? [w.name] : [])) ?? [])]
  return [...new Set([...people, ...people.map(firstName)])]
}

const named = (texts: string[], c: Character) => [c.name, firstName(c.name)].find((n) => texts.some((t) => mentions(t, n)))

/**
 * The secrets something just said touches, for each holder present. Only what is held from someone present counts
 * (one everyone here knows is off, as on the sheet); a dormant secret wakes when its keywords come up, as on the sheet.
 * A person a secret names counts only when they aren't here: someone present is named all the time, which would keep
 * their secret in play every turn (decided in code, task 1).
 */
function secretOptions(content: Pack, state: GameState, input: string): Record<string, SecretOption[]> {
  const { texts, written } = justSaid(state, input)
  const all = [...texts, ...written]
  const ignore = peopleNames(content, state)
  const scan: SecretScan = { texts: all, mentioned: new Set(triggeredEntries(content.codex, texts, ignore, written).map((e) => e.id)) }
  const present = new Set(presentCast(state.scene!))
  const out: Record<string, SecretOption[]> = {}
  for (const shown of secretDisplay(content, state, scan)) {
    if (shown.form === 'off') continue
    const c = characterById(content, shown.holder)!
    const s = c.secrets.find((x) => `${c.id}.${x.id}` === shown.id)!
    const touch = touchOf(content, s, scan)
    const person = touch ? undefined : content.characters.filter((o) => o.id !== c.id && !present.has(o.id) && mentions(s.text, firstName(o.name))).map((o) => named(all, o)).find(Boolean)
    const option: SecretOption | undefined = touch ? { id: shown.id, text: s.text, how: touch.how === 'keyword' ? 'keyword' : 'subject', by: touch.words } : person ? { id: shown.id, text: s.text, how: 'person', by: person } : undefined
    if (option) (out[c.id] ??= []).push(option)
  }
  return out
}

/** Each relationship of `c` in play: toward the player, toward someone here, or toward someone just named. */
function tieOptions(content: Pack, state: GameState, c: Character, input: string): TieOption[] {
  const r = content.ruleset
  const { texts, written } = justSaid(state, input)
  const present = new Set(presentCast(state.scene!))
  const words = (tags: Parameters<typeof tagWord>[1][]) =>
    tags
      .filter((t) => !t.private)
      .map((t) => tagWord(r, t))
      .join(', ')
  const out: TieOption[] = []
  const toPlayer = state.playerTies[c.id]
  if (toPlayer && (toPlayer.tags.length > 0 || toPlayer.note)) out.push({ with: 'player', words: words(toPlayer.tags), ...(toPlayer.note && { note: toPlayer.note }), how: 'present' })
  for (const x of state.relations.filter((x) => x.from === c.id)) {
    const o = characterById(content, x.to)
    if (!o || (x.tags.length === 0 && !x.note)) continue
    const how = present.has(o.id) ? 'present' : named([...texts, ...written], o) ? 'named' : undefined
    if (how) out.push({ with: o.id, words: words(x.tags), ...(x.note && { note: x.note }), how })
  }
  return out
}

/**
 * Who present could see through `holder`: anyone but the holder who knows them (a tie or a history note toward them),
 * best reader first, then the order they're present in. The player isn't listed: the player reads only when trying to
 * (milestone 4d), and the plan says so in `player_action.reading`.
 */
export function readersOf(content: Pack, state: GameState, holder: string): Reader[] {
  const r = content.ruleset
  const skill = r.skills.find((x) => x.id === r.people.reading.skill)
  if (!skill) return []
  const present = presentCast(state.scene!)
  return present
    .filter((id) => id !== holder)
    .flatMap((id): Reader[] => {
      const c = characterById(content, id)
      const tie = state.relations.find((x) => x.from === id && x.to === holder)
      if (!c || !tie || (tie.tags.length === 0 && !tie.note)) return []
      const stats = statsOf(r, c)
      const knows = tie.tags.filter((t) => !t.private).map((t) => tagWord(r, t)).join(', ') || tie.note!
      return [{ who: id, bonus: modifier(r, stats.attributes[skill.attribute] ?? r.attributes.average) + rankOf(stats, skill.id), knows }]
    })
    .sort((a, b) => b.bonus - a.bonus || present.indexOf(a.who) - present.indexOf(b.who))
    .slice(0, MAX_READERS)
}

/** Tonight's aim at its current strength: where the director left it this scene, else the card's word, else the weakest. */
export function goalOption(content: Pack, state: GameState, c: Character): GoalOption {
  const words = content.ruleset.pressures
  const start = c.agenda.pressure ? Math.max(0, words.indexOf(c.agenda.pressure)) : 0
  const level = state.scene!.pressures[c.id] ?? start
  return { text: c.agenda.current, strength: words[level]!, level }
}

/** What was live for each character present in the last turns, from `Turn.live`, and from `kept` in turns `situation` made. */
export function recentlyLive(content: Pack, state: GameState): Record<string, LiveRecord[]> {
  const turns = state.scene!.turns.slice(-content.ruleset.scene.recentTurns).reverse()
  const out: Record<string, LiveRecord[]> = {}
  for (const who of presentCast(state.scene!)) {
    const records = turns.flatMap((t): LiveRecord[] => [...(t.live ?? []).filter((x) => x.who === who), ...(t.live ? [] : (t.kept ?? []).filter((id) => id.startsWith(`${who}.`)).map((ref) => ({ who, kind: 'secret' as const, ref })))])
    if (records.length > 0) out[who] = records
  }
  return out
}

/**
 * One character's pool, best first (Q6: the game builds the candidates by relevance and ownership; the director picks):
 * 1. what the director's brief brought in for them this turn by rule (milestone 4a): knowledge and memories the
 *    conversation reached, in the brief's order of relevance;
 * 2. lore that what was just said names (the player's words or the last turn, as for secrets) and that they know,
 *    whichever layer carries it: talk about a faction someone here belongs to still brings it in. Not the scene's
 *    background as such (the place's chain, the factions and peoples of those present): on a full-sized codex it
 *    filled half of every pool (task 1, checked on the bar scene), and the director has it as context;
 * 3. their memories recalled for the scene;
 * 4. the place's current news.
 * A fact the player has already been told comes back only when the player's words or the last turn ask about it
 * (the brief's "answer" rank). Never a secret: a secret is a pressure, and the bookkeeper and the who-knows-what notes
 * guard it.
 */
function poolOf(content: Pack, state: GameState, c: Character, briefs: Briefs, brought: CodexEntry[]): PoolFact[] {
  const scene = state.scene!
  const facts = new Map(sceneFacts(content, state).map((f) => [f.id, f]))
  const pool: PoolFact[] = []
  const add = (f: PoolFact) => {
    if (!pool.some((x) => x.id === f.id)) pool.push(f)
  }
  const told = (id: string) => scene.told.includes(id)
  for (const d of briefs.details.filter((x) => x.owner === c.id)) {
    if (d.kind === 'knows') {
      const f = facts.get(d.id)
      if (f && f.kind === 'knows' && canSay(scene, f, c.id) && (!told(f.id) || d.rank === 'answer')) add({ id: f.id, text: f.text, source: 'card', unheard: !toldPlayer(scene, f) })
    } else if (d.kind === 'memory') {
      const m = state.memories.find((x) => x.id === d.id)
      if (m) add({ id: m.id, text: m.text, source: 'memory', unheard: true })
    }
  }
  const knower = knowerIn(state, c)
  for (const entry of brought) if (entry.knowledge !== 'secret' && knows(content.setting, entry, knower)) add({ id: `lore.${entry.id}`, text: entry.summary, source: 'lore', unheard: true })
  for (const m of recall(content.ruleset, state, c)) add({ id: m.id, text: m.text, source: 'memory', unheard: true })
  for (const f of facts.values()) if (f.kind === 'place' && !told(f.id)) add({ id: f.id, text: f.text, source: 'place', unheard: !toldPlayer(scene, f) })
  return pool.slice(0, content.ruleset.scene.factPool)
}

/** Everything the `scene` pipeline's director chooses from this turn, for everyone present. */
export function gatherScene(content: Pack, state: GameState, input: string, lore: TurnLore = turnLore(content, state, input), briefs: Briefs = buildBriefs(content, state, input, lore)): Gathered {
  const secrets = secretOptions(content, state, input)
  const { texts, written } = justSaid(state, input)
  const brought = triggeredEntries(content.codex, texts, peopleNames(content, state), written)
  const options: Gathered['options'] = {}
  const pools: Gathered['pools'] = {}
  for (const id of presentCast(state.scene!)) {
    const c = characterById(content, id)
    if (!c) continue
    options[id] = { goal: goalOption(content, state, c), secrets: secrets[id] ?? [], ties: tieOptions(content, state, c, input) }
    pools[id] = poolOf(content, state, c, briefs, brought)
  }
  const readers = Object.fromEntries(Object.keys(secrets).map((holder) => [holder, readersOf(content, state, holder)]).filter(([, r]) => r!.length > 0))
  return { options, recent: recentlyLive(content, state), pools, readers }
}
