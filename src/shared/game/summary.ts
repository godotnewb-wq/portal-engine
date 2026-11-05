import { METERS, type Character, type GameState, type Memory, type Meters, type Relation } from '../model'
import { characterById, locationById, type Content } from './content'
import type { Prompt } from './directorPrompt'
import { recall } from './memory'
import { firstName } from './names'

/** The words a summary judges each meter's change in, worst to best. The LLM writes them; config maps them to numbers. */
export const SCENE_CHANGES = ['much less', 'less', 'a little less', 'unchanged', 'a little more', 'more', 'much more'] as const
export type SceneChange = (typeof SCENE_CHANGES)[number]

/** What each word moves a meter by (Breedhaven's table, tune). Meters run 0–100. */
export const SCENE_CHANGE_VALUES: Record<SceneChange, number> = {
  'much less': -8,
  less: -4,
  'a little less': -1,
  unchanged: 0,
  'a little more': 1,
  more: 4,
  'much more': 8
}

export type MeterDelta = Record<(typeof METERS)[number], number>
const NO_CHANGE: MeterDelta = { approval: 0, trust: 0, attraction: 0 }

/** Everyone who saw the scene: those still here and those who left part-way. */
export function witnesses(state: GameState): string[] {
  const scene = state.scene!
  return [...new Set([...scene.cast, ...scene.departed])]
}

/** The whole scene as the summaries read it: what the player said, the beats, and the rolls. */
export function transcript(content: Content, state: GameState): string {
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

const words = SCENE_CHANGES.map((w) => `"${w}"`).join(', ')

function task(state: GameState, c: Character, others: Character[]): string {
  const player = state.player.name
  const me = firstName(c.name)
  return `You judge what one character takes away from a scene in an adult visual-novel RPG. Write ${me}'s memory of the scene and how it changed what ${me} feels.

Reply with only a JSON object:
{"memory": "...", "level": "core|normal|fleeting", "reason": "...", "approval": "...", "trust": "...", "attraction": "...", "learned": [], "others": [{"with": "id", "approval": "...", "trust": "...", "attraction": "...", "reason": "..."}]}

- memory: one or two sentences, past tense, third person, from ${me}'s point of view: what ${me} said, did, noticed and felt, and how ${player} treated ${me}. End on what stayed with ${me} most.
- level: "core" for a moment that defines them (a confession, a betrayal, a first kiss, a promise made or broken; rare), "normal" for time that meant something, "fleeting" when little happened.
- approval, trust, attraction: how each CHANGED toward ${player} because of this scene, each one of: ${words}. Meters move slowly; nothing is owed for turning up. Approval is regard and liking; trust is whether ${me} can rely on ${player} and be honest with them; attraction is wanting them, and can rise while trust falls.
- Judge as ${me}: by ${me}'s values, agenda and how things stood before. Values ${me} likes, shown by ${player}, raise approval; values ${me} dislikes lower it.
- reason: one short sentence on what moved ${me}, and which way.
- learned: ids of ${me}'s own secrets that ${player} truly found out in this scene (said or plainly shown); [] if none.${others.length > 0 ? `\n- others: how ${me}'s feelings toward ${others.map((o) => `${firstName(o.name)} [${o.id}]`).join(', ')} changed in this scene, same words; leave someone out if nothing changed.` : '\n- others: [].'}`
}

function about(state: GameState, c: Character, others: Character[]): string {
  const me = firstName(c.name)
  const meters = state.meters[c.id]!
  const memories = recall(state, c)
  const relations = others.flatMap((o) => {
    const r = state.relations.find((x) => x.from === c.id && x.to === o.id)
    return r ? [`- Toward ${firstName(o.name)}: ${r.label}; approval ${r.meters.approval}, trust ${r.meters.trust}, attraction ${r.meters.attraction}`] : []
  })
  const scene = state.scene!
  return [
    `About ${me} (${c.species}, ${c.pronouns}):`,
    `- ${c.personality}`,
    `- Wants: ${c.agenda.longTerm.join('; ')}. Tonight: ${c.agenda.current}`,
    c.values.length > 0 && `- Values: ${c.values.map((v) => `${v.stance} ${v.value}`).join(', ')}`,
    ...c.secrets.map((s) => `- Secret [${s.id}]: ${s.text}`),
    `- Before this scene, toward ${state.player.name}: approval ${meters.approval}, trust ${meters.trust}, attraction ${meters.attraction} (of 100)`,
    ...relations,
    memories.length > 0 && `- Remembers: ${memories.map((m) => m.text).join(' ')}`,
    `- Mood at the end: ${scene.moods[c.id] ?? c.mood}; comfort ${scene.comfort[c.id] ?? 3}/5.`,
    scene.departed.includes(c.id) && `- ${me} left before the scene was over; the memory ends with leaving.`
  ]
    .filter(Boolean)
    .join('\n')
}

/** The prompt for one witness's end-of-scene summary (outside the turn budget; one per witness, in parallel). */
export function buildSummaryPrompt(content: Content, state: GameState, id: string): Prompt {
  const c = characterById(content, id)!
  const others = witnesses(state).filter((x) => x !== id).map((x) => characterById(content, x)!)
  const location = locationById(content, state.scene!.locationId)!
  return {
    system: task(state, c, others),
    user: [about(state, c, others), `Place: ${location.name}, ${location.district}.`, `The scene:\n${transcript(content, state) || '(Nothing much was said.)'}`].join('\n\n')
  }
}

const word = (value: unknown): number => {
  if (typeof value !== 'string') return 0
  const step = SCENE_CHANGES.find((w) => w === value.trim().toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' '))
  return step ? SCENE_CHANGE_VALUES[step] : 0
}

const deltaOf = (given: Record<string, unknown>): MeterDelta => ({ approval: word(given['approval']), trust: word(given['trust']), attraction: word(given['attraction']) })

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
export function parseSummary(reply: string): Summary {
  const body = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  let raw: unknown
  try {
    raw = start < 0 || end < start ? undefined : JSON.parse(body.slice(start, end + 1))
  } catch {
    raw = undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { memory: body.trim(), level: 'normal', reason: '', delta: NO_CHANGE, learned: [], others: [] }
  const given = raw as Record<string, unknown>
  return {
    memory: text(given['memory']),
    level: LEVELS.find((l) => l === text(given['level']).toLowerCase()) ?? 'normal',
    reason: text(given['reason']),
    delta: deltaOf(given),
    learned: Array.isArray(given['learned']) ? given['learned'].filter((x): x is string => typeof x === 'string').map((x) => x.trim()) : [],
    others: Array.isArray(given['others'])
      ? given['others'].flatMap((o) => {
          if (typeof o !== 'object' || o === null || typeof (o as { with?: unknown }).with !== 'string') return []
          const entry = o as Record<string, unknown>
          return [{ with: text(entry['with']), delta: deltaOf(entry), reason: text(entry['reason']) }]
        })
      : []
  }
}

/** When a witness's summary can't be had, the game writes a plain memory and changes nothing. */
export function plainSummary(content: Content, state: GameState, id: string): Summary {
  const c = characterById(content, id)!
  const location = locationById(content, state.scene!.locationId)!
  return { memory: `${firstName(c.name)} spent time with ${state.player.name} at ${location.name}.`, level: 'fleeting', reason: '', delta: NO_CHANGE, learned: [], others: [] }
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))
const add = (m: Meters, d: MeterDelta): Meters => ({ approval: clamp(m.approval + d.approval), trust: clamp(m.trust + d.trust), attraction: clamp(m.attraction + d.attraction) })

/** A relation's band, from its meters. A seeded label is kept until the meters move it into another band. */
export function bandOf(m: Meters): string {
  if (m.approval <= 15 && m.trust <= 20) return 'enemies'
  if (m.approval <= 30) return 'rivals'
  if (m.approval >= 65 && m.trust >= 60) return 'friends'
  return 'acquaintances'
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
  others: { with: string; before: Meters; after: Meters; label: string; reason: string }[]
  /** Set when the summary call failed and the game wrote a plain memory. */
  error?: string
}

/**
 * Closes the scene: each witness's memory is stored, their meters toward the player and toward the other witnesses
 * move by the words they chose (clamped 0–100), secrets that truly came out become facts the player knows, and the
 * scene is cleared. Only secrets the character actually has and only witnesses who were there are accepted.
 */
export function applySummaries(content: Content, state: GameState, summaries: { id: string; summary: Summary; error?: string }[]): { state: GameState; reports: WitnessReport[] } {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const present = witnesses(state)
  let meters = { ...state.meters }
  let relations: Relation[] = [...state.relations]
  const facts = { ...state.facts }
  const memories: Memory[] = [...state.memories]
  const reports: WitnessReport[] = []

  for (const { id, summary, error } of summaries) {
    const c = characterById(content, id)
    if (!c || !present.includes(id)) continue
    const before = scene.baseline[id] ?? meters[id]!
    const after = add(meters[id]!, summary.delta)
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
      const start: Relation = existing ?? { from: id, to: other, label: 'acquaintances', meters: { approval: 50, trust: 40, attraction: 10 } }
      const moved = add(start.meters, o.delta)
      const label = bandOf(moved) !== bandOf(start.meters) ? bandOf(moved) : start.label
      const next = { ...start, meters: moved, label }
      relations = existing ? relations.map((r) => (r === existing ? next : r)) : [...relations, next]
      others.push({ with: other, before: start.meters, after: moved, label, reason: o.reason })
    }

    reports.push({ id, memory: summary.memory, level: summary.level, reason: summary.reason, before, after, learned: learnedSecrets.map((s) => s.text), others, ...(error && { error }) })
  }

  return { state: { ...state, meters, relations, facts, memories, scene: null }, reports }
}
