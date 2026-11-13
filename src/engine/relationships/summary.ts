import { caresAbout, feelingWords, shadeList, type Character, type Meters } from '@engine/characters'
import { meterWords, type Ruleset } from '@engine/rules'
import { absenceWords, agoWords, carrying, daysSince, tieWords, towardName, type GameState, type Memory, type Relation } from '@engine/state'
import { applyCarried, fade, type CarriedReport, type WrittenFeeling } from './aftermath'
import { characterById, locationById, type Pack } from '@engine/pack'
import type { Prompt } from '@engine/core'
import { recall } from '@engine/memory'
import { firstName } from '@engine/core'

/**
 * How much each of the ruleset's meters moves. The LLM judges changes in the ruleset's scale words; the ruleset maps
 * each word to a number.
 */
export type MeterDelta = Record<string, number>
const noChange = (r: Ruleset): MeterDelta => Object.fromEntries(r.meters.list.map((m) => [m.id, 0]))

/**
 * What a witness saw through to this scene (npc design §7, milestone 4b): the reading checks they won, latest per
 * person, so their memory can hold what someone really felt rather than what showed.
 */
function reads(state: GameState, id: string): { target: string; feeling: NonNullable<GameState['scene']>['moods'][string] }[] {
  const all = state.scene!.turns.flatMap((t) => t.reads ?? []).filter((x) => x.by === id)
  return [...new Map(all.map((x) => [x.target, x])).values()]
}

/** Everyone who saw the scene: those still here and those who left part-way. */
export function witnesses(state: GameState): string[] {
  const scene = state.scene!
  return [...new Set([...scene.cast, ...scene.departed])]
}

/** The whole scene as the summaries read it: what the player said, the beats, and the rolls. */
export function transcript(content: Pack, state: GameState): string {
  const scene = state.scene!
  const name = (id: string) => {
    const c = characterById(content, id)
    if (c) return firstName(c.name)
    const w = locationById(content, scene.locationId)?.walkOns.find((x) => x.id === id)
    return w?.name ?? w?.label ?? id
  }
  return scene.turns
    .map((t) =>
      [
        `${state.player.name}: ${t.player}`,
        ...t.checks.map((c) => `(${c.line})`),
        ...t.beats.map((b) => (b.kind === 'narration' ? b.text : `${name(b.speaker)}: ${b.text}`))
      ].join('\n')
    )
    .join('\n\n')
}

function task(r: Ruleset, state: GameState, c: Character, others: Character[]): string {
  const player = state.player.name
  const me = firstName(c.name)
  const words = r.wordScale.map((w) => `"${w.word}"`).join(', ')
  const meterFields = r.meters.list.map((m) => `"${m.id}": "..."`).join(', ')
  const meterNames = r.meters.list.map((m) => m.id).join(', ')
  const meaning = r.meters.list.map((m) => `${m.id} is ${m.description}`).join('; ')
  return `You judge what one character takes away from a scene in a visual-novel RPG. Write ${me}'s memory of the scene and how it changed what ${me} feels.

Reply with only a JSON object:
{"memory": "...", "level": "core|normal|fleeting", "reason": "...", ${meterFields}, "learned": [], "others": [{"with": "id", ${meterFields}, "reason": "..."}], "feels": {"shade": "...", "family": "...", "intensity": 1, "reason": "..."}, "toward": [{"who": "id", "shade": "...", "family": "...", "intensity": 1, "reason": "..."}], "resolved": []}

- memory: one or two sentences, past tense, third person, from ${me}'s point of view: what ${me} said, did, noticed and felt, and how ${player} treated ${me}. End on what stayed with ${me} most.
- level: "core" for a moment that changed something lasting for them (a first betrayal or first real job, a loss, a secret of theirs coming out, a promise made or broken, real danger to their life; rare), "normal" for time that meant something, "fleeting" when little happened.
- ${meterNames}: how each CHANGED toward ${player} because of this scene, each one of: ${words}. Meters move slowly; nothing is owed for turning up. Toward someone, ${meaning}.
- Judge as ${me}: by ${me}'s values, agenda and how things stood before. Values ${me} likes, shown by ${player}, raise regard; values ${me} dislikes lower it.
- reason: one short sentence on what moved ${me}, and which way.
- learned: ids of ${me}'s own secrets that ${player} truly found out in this scene (said or plainly shown); [] if none.${others.length > 0 ? `\n- others: how ${me}'s feelings toward ${others.map((o) => `${firstName(o.name)} [${o.id}]`).join(', ')} changed in this scene, same words; leave someone out if nothing changed.` : '\n- others: [].'}
- feels: how ${me} feels as the scene ends, when it isn't about one person: a shade from the list below, family only when the shade is listed under more than one, intensity 1 to 5, and why in a few words. Leave it out if nothing much.
- toward: feelings this scene left ${me} with toward one person (who: ${[...others.map((o) => `"${o.id}"`), `or "player" for ${player}`].join(', ')}): what happened between them, not how ${me} feels about them overall, which the meters hold. A shade, intensity and why ("forgot our anniversary"). They pass in days. [] if none.
- resolved: the people (as ids) toward whom a feeling ${me} already carries was settled in this scene (an apology accepted, a fear put to rest); [] if none.
- Shades by family (usual intensity): ${shadeList(r)}.`
}

/**
 * What a witness carries into the summary (npc design §7, milestone 4b): their aftermath and feelings toward people,
 * the feelings toward people here that ended within the history window (so a repeat is seen as one), and how long it
 * had been since they saw the player when that is something they would notice.
 */
function carriedLines(content: Pack, state: GameState, c: Character, others: Character[]): string[] {
  const me = firstName(c.name)
  const { general, toward } = carrying(content, state, c.id)
  const people = [...others.map((o) => o.id), 'player']
  const ended = new Map<string, { count: number; last: number }>()
  for (const e of state.endedFeelings.filter((x) => x.owner === c.id && people.includes(x.toward))) {
    const key = `${e.family} toward ${towardName(content, state, e.toward)}`
    const was = ended.get(key)
    ended.set(key, { count: (was?.count ?? 0) + 1, last: was ? Math.max(was.last, e.at) : e.at })
  }
  const absence = absenceWords(content, state, c.id)
  return [
    general.length > 0 && `- Carrying from before: ${general.join('; ')}.`,
    toward.length > 0 && `- Feelings toward people, from before: ${toward.join('; ')}.`,
    ended.size > 0 && `- Earlier feelings toward people here that have passed: ${[...ended].map(([k, v]) => `${k}, ${v.count === 1 ? 'once' : `${v.count} times`} (last ${agoWords(daysSince(v.last, state.time))})`).join('; ')}.`,
    absence && `- Before this scene, ${me} ${absence}.`
  ].filter((x): x is string => !!x)
}

/** Tie changes this scene that involve them (relationships §3): each is a Core memory, which the summary is told. */
function tieLines(content: Pack, state: GameState, c: Character): string[] {
  const events = tieEventsFor(state, c.id)
  return events.length > 0 ? [`- What changed between people this scene (a Core memory for ${firstName(c.name)}): ${events.map((e) => `${tieWords(content, state, { from: e.from, to: e.to, ...(e.added[0] && { add: e.added[0] }), ...(e.word && { word: e.word }), ...(e.ended[0] && { end: e.ended[0] }), reason: e.reason })}${e.reason ? ` (${e.reason})` : ''}`).join('; ')}.`] : []
}

/** The scene's tie changes a character is part of, either side. */
const tieEventsFor = (state: GameState, id: string) => state.scene!.tieEvents.filter((e) => e.from === id || e.to === id)

function about(content: Pack, state: GameState, c: Character, others: Character[]): string {
  const r = content.ruleset
  const me = firstName(c.name)
  const meters = state.meters[c.id]!
  const memories = recall(r, state, c)
  const relations = others.flatMap((o) => {
    const rel = state.relations.find((x) => x.from === c.id && x.to === o.id)
    return rel ? [`- Toward ${firstName(o.name)}: ${meterWords(r, rel.meters)}${rel.note ? ` (${rel.note})` : ''}`] : []
  })
  const scene = state.scene!
  return [
    `About ${me} (${c.species}, ${c.pronouns}):`,
    `- ${c.portrait}`,
    `- Wants: ${c.agenda.longTerm.join('; ')}. Tonight: ${c.agenda.current}`,
    caresAbout(r, c) && `- Values: ${caresAbout(r, c)}`,
    ...c.secrets.map((s) => `- Secret [${s.id}]: ${s.text}`),
    `- Before this scene, toward ${state.player.name}: ${meterWords(r, meters)}`,
    ...relations,
    memories.length > 0 && `- Remembers: ${memories.map((m) => m.text).join(' ')}`,
    ...carriedLines(content, state, c, others),
    ...tieLines(content, state, c),
    `- Mood at the end: ${feelingWords(r, scene.moods[c.id])}; comfort ${scene.comfort[c.id] ?? 3}/5.`,
    ...reads(state, c.id).map((x) => `- ${me} saw through to what ${firstName(others.find((o) => o.id === x.target)?.name ?? x.target)} really felt: ${feelingWords(r, x.feeling)}.`),
    scene.departed.includes(c.id) && `- ${me} left before the scene was over; the memory ends with leaving.`
  ]
    .filter(Boolean)
    .join('\n')
}

/** The prompt for one witness's end-of-scene summary (outside the turn budget; one per witness, in parallel). */
export function buildSummaryPrompt(content: Pack, state: GameState, id: string): Prompt {
  const c = characterById(content, id)!
  const others = witnesses(state).filter((x) => x !== id).map((x) => characterById(content, x)!)
  const location = locationById(content, state.scene!.locationId)!
  return {
    system: task(content.ruleset, state, c, others),
    user: [about(content, state, c, others), `Place: ${location.name}, ${location.district}.`, `The scene:\n${transcript(content, state) || '(Nothing much was said.)'}`].join('\n\n')
  }
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ')

/** What a written scale word moves a meter by; a word not on the scale moves nothing. */
const word = (r: Ruleset, value: unknown): number => {
  if (typeof value !== 'string') return 0
  return r.wordScale.find((w) => normalize(w.word) === normalize(value))?.value ?? 0
}

const deltaOf = (r: Ruleset, given: Record<string, unknown>): MeterDelta => Object.fromEntries(r.meters.list.map((m) => [m.id, word(r, given[m.id])]))

export interface Summary {
  memory: string
  level: Memory['level']
  reason: string
  delta: MeterDelta
  learned: string[]
  others: { with: string; delta: MeterDelta; reason: string }[]
  /** How they feel as the scene ends, when it isn't about one person (milestone 4b). */
  feels?: WrittenFeeling
  /** Feelings toward a person this scene left them with (milestone 4b). */
  toward: WrittenFeeling[]
  /** Who a feeling they carry was settled with in this scene (milestone 4b). */
  resolved: string[]
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const LEVELS: Memory['level'][] = ['core', 'normal', 'fleeting']

/** Reads a witness's summary. A word not on the scale changes nothing; a reply that isn't JSON is taken as the memory alone. */
export function parseSummary(r: Ruleset, reply: string): Summary {
  const body = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  let raw: unknown
  try {
    raw = start < 0 || end < start ? undefined : JSON.parse(body.slice(start, end + 1))
  } catch {
    raw = undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    // A reply cut off mid-JSON (a thinking model out of tokens, session 2026-11-07_1955_cdd1) is not a memory: keep its
    // memory field if it got that far, otherwise leave it empty so the plain memory is used. Plain prose is kept.
    const cut = body.trim().startsWith('{')
    const field = cut ? body.match(/"memory"\s*:\s*"((?:[^"\\]|\\.)*)"/) : null
    let memory = cut ? '' : body.trim()
    if (field) {
      try {
        memory = JSON.parse(`"${field[1]}"`) as string
      } catch {
        memory = ''
      }
    }
    return { memory, level: 'normal', reason: '', delta: noChange(r), learned: [], others: [], toward: [], resolved: [] }
  }
  const given = raw as Record<string, unknown>
  return {
    memory: text(given['memory']),
    level: LEVELS.find((l) => l === text(given['level']).toLowerCase()) ?? 'normal',
    reason: text(given['reason']),
    delta: deltaOf(r, given),
    learned: Array.isArray(given['learned']) ? given['learned'].filter((x): x is string => typeof x === 'string').map((x) => x.trim()) : [],
    others: Array.isArray(given['others'])
      ? given['others'].flatMap((o) => {
          if (typeof o !== 'object' || o === null || typeof (o as { with?: unknown }).with !== 'string') return []
          const entry = o as Record<string, unknown>
          return [{ with: text(entry['with']), delta: deltaOf(r, entry), reason: text(entry['reason']) }]
        })
      : [],
    ...(isObject(given['feels']) && { feels: given['feels'] as WrittenFeeling }),
    toward: Array.isArray(given['toward']) ? given['toward'].filter(isObject).map((x) => x as WrittenFeeling) : [],
    resolved: Array.isArray(given['resolved']) ? given['resolved'].filter((x): x is string => typeof x === 'string') : []
  }
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** When a witness's summary can't be had, the game writes a plain memory and changes nothing. */
export function plainSummary(content: Pack, state: GameState, id: string): Summary {
  const c = characterById(content, id)!
  const location = locationById(content, state.scene!.locationId)!
  return { memory: `${firstName(c.name)} spent time with ${state.player.name} at ${location.name}.`, level: 'fleeting', reason: '', delta: noChange(content.ruleset), learned: [], others: [], toward: [], resolved: [] }
}

/** Moves each meter by its change, kept within the ruleset's range. */
export function addMeters(r: Ruleset, m: Meters, d: MeterDelta): Meters {
  const clamp = (n: number) => Math.max(r.meters.min, Math.min(r.meters.max, n))
  return Object.fromEntries(r.meters.list.map((x) => [x.id, clamp((m[x.id] ?? r.meters.neutral) + (d[x.id] ?? 0))]))
}

/** What one witness took from the scene, as the summary screen shows it. */
export interface WitnessReport {
  id: string
  memory: string
  level: Memory['level']
  reason: string
  before: Meters
  after: Meters
  /** Secrets the player learned, as text. */
  learned: string[]
  others: { with: string; before: Meters; after: Meters; reason: string }[]
  /** What they carry out of the scene: aftermath, feelings toward people, what was resolved (milestone 4b). Not shown to the player. */
  carried?: CarriedReport
  /** Set when the summary call failed and the game wrote a plain memory. */
  error?: string
}

/**
 * Closes the scene: each witness's memory is stored, their meters toward the player and toward the other witnesses
 * move by the words they chose (kept within the ruleset's range), secrets that truly came out become facts the player knows, and the
 * scene is cleared. Only secrets the character actually has and only witnesses who were there are accepted. What each
 * witness carries out of the scene (aftermath, feelings toward a person) is applied after the meters (`applyCarried`),
 * and everyone who was there has now seen the player (`lastSeen`).
 */
export function applySummaries(content: Pack, state: GameState, summaries: { id: string; summary: Summary; error?: string }[]): { state: GameState; reports: WitnessReport[] } {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const present = witnesses(state)
  let meters = { ...state.meters }
  let relations: Relation[] = [...state.relations]
  const facts = { ...state.facts }
  const memories: Memory[] = [...state.memories]
  const reports: WitnessReport[] = []
  const r = content.ruleset
  // Whatever faded since the last upkeep ends first, so a repeat is counted against the history as it stands.
  let { aftermath, endedFeelings } = fade(r, state)

  for (const { id, summary, error } of summaries) {
    const c = characterById(content, id)
    if (!c || !present.includes(id)) continue
    const before = scene.baseline[id] ?? meters[id]!
    const after = addMeters(r, meters[id]!, summary.delta)
    meters = { ...meters, [id]: after }

    const learnedSecrets = c.secrets.filter((s) => summary.learned.some((l) => l.toLowerCase() === s.id))
    if (learnedSecrets.length > 0) facts[id] = [...new Set([...(facts[id] ?? []), ...learnedSecrets.map((s) => s.text)])]

    // A tag beginning or ending is a game-forced Core memory for both sides (memory §4; relationships §3), whatever the call chose.
    const level = tieEventsFor(state, id).length > 0 ? 'core' : summary.level
    if (summary.memory) memories.push({ owner: id, text: summary.memory, level, at: state.time, about: ['player', ...present.filter((x) => x !== id)] })

    const others: WitnessReport['others'] = []
    for (const o of summary.others) {
      const other = present.find((x) => x !== id && (x === o.with.toLowerCase() || characterById(content, x)?.name.toLowerCase().startsWith(o.with.toLowerCase())))
      if (!other) continue
      const existing = relations.find((r) => r.from === id && r.to === other)
      // Relations are created where there's a reason; sharing a scene is one.
      const fresh = { ...r.relations.start }
      const start: Relation = existing ?? { from: id, to: other, tags: [], meters: fresh }
      const moved = addMeters(r, start.meters, o.delta)
      const next = { ...start, meters: moved }
      relations = existing ? relations.map((r) => (r === existing ? next : r)) : [...relations, next]
      others.push({ with: other, before: start.meters, after: moved, reason: o.reason })
    }

    const applied = applyCarried(content, state, { aftermath, endedFeelings, meters, relations }, id, { ...summary, level }, scene.id)
    ;({ aftermath, endedFeelings, meters, relations } = applied.world)
    // A repeat moved a meter after the summary's words did: the report shows where things ended up.
    const othersAfter = others.map((o) => ({ ...o, after: relations.find((x) => x.from === id && x.to === o.with)?.meters ?? o.after }))
    reports.push({ id, memory: summary.memory, level, reason: summary.reason, before, after: meters[id]!, learned: learnedSecrets.map((s) => s.text), others: othersAfter, carried: applied.report, ...(error && { error }) })
  }

  const lastSeen = { ...state.lastSeen, ...Object.fromEntries(present.map((id) => [id, state.time])) }
  return { state: { ...state, meters, relations, facts, memories, aftermath, endedFeelings, lastSeen, scene: null }, reports }
}
