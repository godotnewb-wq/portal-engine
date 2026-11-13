import type { Character, Meters } from '@engine/characters'
import { meterWords, type Ruleset } from '@engine/rules'
import { type GameState, type Memory, type Relation } from '@engine/state'
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
{"memory": "...", "level": "core|normal|fleeting", "reason": "...", ${meterFields}, "learned": [], "others": [{"with": "id", ${meterFields}, "reason": "..."}]}

- memory: one or two sentences, past tense, third person, from ${me}'s point of view: what ${me} said, did, noticed and felt, and how ${player} treated ${me}. End on what stayed with ${me} most.
- level: "core" for a moment that defines them (a confession, a betrayal, a first kiss, a promise made or broken; rare), "normal" for time that meant something, "fleeting" when little happened.
- ${meterNames}: how each CHANGED toward ${player} because of this scene, each one of: ${words}. Meters move slowly; nothing is owed for turning up. Toward someone, ${meaning}.
- Judge as ${me}: by ${me}'s values, agenda and how things stood before. Values ${me} likes, shown by ${player}, raise regard; values ${me} dislikes lower it.
- reason: one short sentence on what moved ${me}, and which way.
- learned: ids of ${me}'s own secrets that ${player} truly found out in this scene (said or plainly shown); [] if none.${others.length > 0 ? `\n- others: how ${me}'s feelings toward ${others.map((o) => `${firstName(o.name)} [${o.id}]`).join(', ')} changed in this scene, same words; leave someone out if nothing changed.` : '\n- others: [].'}`
}

function about(r: Ruleset, state: GameState, c: Character, others: Character[]): string {
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
    `- ${c.personality}`,
    `- Wants: ${c.agenda.longTerm.join('; ')}. Tonight: ${c.agenda.current}`,
    c.values.length > 0 && `- Values: ${c.values.map((v) => `${v.stance} ${v.value}`).join(', ')}`,
    ...c.secrets.map((s) => `- Secret [${s.id}]: ${s.text}`),
    `- Before this scene, toward ${state.player.name}: ${meterWords(r, meters)}`,
    ...relations,
    memories.length > 0 && `- Remembers: ${memories.map((m) => m.text).join(' ')}`,
    `- Mood at the end: ${scene.moods[c.id] ?? c.mood}; comfort ${scene.comfort[c.id] ?? 3}/5.`,
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
    user: [about(content.ruleset, state, c, others), `Place: ${location.name}, ${location.district}.`, `The scene:\n${transcript(content, state) || '(Nothing much was said.)'}`].join('\n\n')
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
    return { memory, level: 'normal', reason: '', delta: noChange(r), learned: [], others: [] }
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
      : []
  }
}

/** When a witness's summary can't be had, the game writes a plain memory and changes nothing. */
export function plainSummary(content: Pack, state: GameState, id: string): Summary {
  const c = characterById(content, id)!
  const location = locationById(content, state.scene!.locationId)!
  return { memory: `${firstName(c.name)} spent time with ${state.player.name} at ${location.name}.`, level: 'fleeting', reason: '', delta: noChange(content.ruleset), learned: [], others: [] }
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
  /** Set when the summary call failed and the game wrote a plain memory. */
  error?: string
}

/**
 * Closes the scene: each witness's memory is stored, their meters toward the player and toward the other witnesses
 * move by the words they chose (kept within the ruleset's range), secrets that truly came out become facts the player knows, and the
 * scene is cleared. Only secrets the character actually has and only witnesses who were there are accepted.
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

  for (const { id, summary, error } of summaries) {
    const c = characterById(content, id)
    if (!c || !present.includes(id)) continue
    const before = scene.baseline[id] ?? meters[id]!
    const after = addMeters(r, meters[id]!, summary.delta)
    meters = { ...meters, [id]: after }

    const learnedSecrets = c.secrets.filter((s) => summary.learned.some((l) => l.toLowerCase() === s.id))
    if (learnedSecrets.length > 0) facts[id] = [...new Set([...(facts[id] ?? []), ...learnedSecrets.map((s) => s.text)])]

    if (summary.memory) memories.push({ owner: id, text: summary.memory, level: summary.level, at: state.time, about: ['player', ...present.filter((x) => x !== id)] })

    const others: WitnessReport['others'] = []
    for (const o of summary.others) {
      const other = present.find((x) => x !== id && (x === o.with.toLowerCase() || characterById(content, x)?.name.toLowerCase().startsWith(o.with.toLowerCase())))
      if (!other) continue
      const existing = relations.find((r) => r.from === id && r.to === other)
      // Relations are created where there's a reason; sharing a scene is one.
      const fresh = { ...r.relations.start }
      const start: Relation = existing ?? { from: id, to: other, meters: fresh }
      const moved = addMeters(r, start.meters, o.delta)
      const next = { ...start, meters: moved }
      relations = existing ? relations.map((r) => (r === existing ? next : r)) : [...relations, next]
      others.push({ with: other, before: start.meters, after: moved, reason: o.reason })
    }

    reports.push({ id, memory: summary.memory, level: summary.level, reason: summary.reason, before, after, learned: learnedSecrets.map((s) => s.text), others, ...(error && { error }) })
  }

  return { state: { ...state, meters, relations, facts, memories, scene: null }, reports }
}
