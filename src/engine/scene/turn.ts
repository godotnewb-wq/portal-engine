import type { Beat, GameState, RolledCheck, Turn } from '@engine/state'
import type { Tags } from './beats'
import { characterById, type Pack } from '@engine/pack'
import { entryById, mentions } from '@engine/codex'
import { firstName } from '@engine/core'
import { RECENT_TURNS, turnText } from './director'
import { presentCast, type BeatPlan, type Move } from './planShape'

/** In-game minutes a turn of talk takes (tune). */
export const MINUTES_PER_TURN = 3
/** The running summary keeps its most recent part; older detail lives in end-of-scene memories. */
export const SUMMARY_CHARS = 2000

export interface TurnWritten {
  id: string
  log?: string
  input: string
  plan: BeatPlan
  beats: Beat[]
  tags: Tags
  /** The dice's state after the plan's checks were rolled. */
  dice: number
  /** Brief detail to carry into the next turn (`carryDetails`). */
  details?: string[]
  /** Memories the briefs brought in as optional detail this turn (milestone 4b). */
  memories?: string[]
  /** Codex entries the conversation brought up this turn (the triggered layer), for tagging memories (milestone 4b). */
  topics?: string[]
  /** Held secrets that were active this turn, for dormancy (milestone 4b): kept, shown in full, or brought up. */
  secrets?: { id: string; how: 'kept' | 'full' | 'keyword' | 'context' }[]
}

export function rolledChecks(plan: BeatPlan): RolledCheck[] {
  return plan.checks.flatMap((c) =>
    c.result && c.line
      ? [{ id: c.id, who: c.who, skill: c.skill, difficulty: c.difficulty, stakes: c.stakes, natural: c.result.natural, total: c.result.total, dc: c.result.dc, degree: c.result.degree, line: c.line }]
      : []
  )
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The cast who appear in these beats: a line of their own, or narration that names them. */
export function appearing(content: Pack, beats: Beat[]): Set<string> {
  const ids = new Set<string>()
  for (const b of beats) if (b.kind === 'dialogue') ids.add(b.speaker)
  const narration = beats.flatMap((b) => (b.kind === 'narration' ? [b.text] : [])).join('\n')
  for (const c of content.characters) {
    if (new RegExp(`\\b(?:${[c.name, firstName(c.name)].map(escape).join('|')})\\b`, 'i').test(narration)) ids.add(c.id)
  }
  return ids
}

/**
 * Which of the writer's tags count (milestone 3.6, task 6; decided 2026-11-12). Departures come only from the plan:
 * a `[LEAVES: Name]` tag moves no one, and one for someone the plan didn't send away is reported. When salvage cut
 * every beat a character appeared in, their `EXPRESSION` and `COMFORT` tags are dropped too: they describe
 * prose the player never sees. Tags about someone who was never in the prose apply as on any turn. `[END SCENE]` has
 * no effect either way: only the plan ends a scene. Returns the tags to apply and each one set aside, with why.
 */
export function acceptTags(content: Pack, plan: BeatPlan, tags: Tags, written: Beat[], kept: Beat[]): { tags: Tags; rejected: string[] } {
  const name = (id: string) => firstName(characterById(content, id)?.name ?? id)
  const rejected: string[] = []
  for (const id of tags.leaves) if (!plan.leaves.includes(id)) rejected.push(`[LEAVES: ${name(id)}] (not in the plan)`)
  const shown = appearing(content, kept)
  const cut = new Set([...appearing(content, written)].filter((id) => !shown.has(id)))
  const keep = <T>(kind: string, record: Record<string, T>, text: (value: T) => string) =>
    Object.fromEntries(
      Object.entries(record).filter(([id, value]) => {
        if (!cut.has(id)) return true
        rejected.push(`[${name(id)}: ${kind} ${text(value)}] (salvage cut their lines)`)
        return false
      })
    )
  return {
    tags: {
      expressions: keep('EXPRESSION', tags.expressions, (v) => v),
      comfort: keep('COMFORT', tags.comfort, (v) => `${v.level} ${v.reason}`.trim()),
      leaves: tags.leaves.filter((id) => plan.leaves.includes(id)),
      ended: tags.ended
    },
    rejected
  }
}

/**
 * A planned departure the kept prose doesn't show gets one narration beat in the pack's words (the ruleset's
 * `narration.departure`), so a character never vanishes without a word on screen (milestone 3.6, task 6a). "Shows"
 * can only mean the character is in the kept beats, with a line or named in narration: code can't tell whether the
 * prose has them walk out, which is why the writer is told who leaves.
 */
export function showDepartures(content: Pack, plan: BeatPlan, beats: Beat[]): { beats: Beat[]; added: { id: string; beat: Beat }[] } {
  const shown = appearing(content, beats)
  const added = plan.leaves
    .filter((id) => !shown.has(id))
    .map((id) => ({ id, beat: { kind: 'narration' as const, text: content.ruleset.narration.departure.replaceAll('{name}', firstName(characterById(content, id)?.name ?? id)) } }))
  return { beats: [...beats, ...added.map((a) => a.beat)], added }
}

/** A character's secret by its fact id (`<holder>.<secret>`), with its holder and the words that name it. */
function secretOf(content: Pack, id: string): { holder: string; keywords: string[] } | undefined {
  const dot = id.indexOf('.')
  const c = dot > 0 ? characterById(content, id.slice(0, dot)) : undefined
  const s = c?.secrets.find((x) => `${c.id}.${x.id}` === id)
  if (!c || !s) return undefined
  const entry = s.codex ? entryById(content.codex, s.codex) : undefined
  return { holder: c.id, keywords: entry ? entry.keywords : (s.keywords ?? []) }
}

/**
 * Whether a voiced move gives away a fact it drew on (decided 2026-11-16, user, after the end-of-Milestone-4 bench run
 * 2: a dodge that drew on a character's secret counted as telling it, forced them a Core memory and taught it to the
 * friend who heard the dodge). A move's
 * `uses` is a pool it may draw on, not what was said, so a secret needs more than being listed:
 * - the holder's own secret comes out on a **reveal** or **concede**, or on an **answer** whose spoken line names it by
 *   its keywords, and never while the holder keeps it that turn by lying or deflecting (keeping it with a partial truth
 *   still gives part of it away);
 * - someone else's secret (a learner telling it) comes out on any move but a **dodge** or **refuse**.
 * Other facts are said whenever a voiced move draws on them, as before.
 */
export function givesAway(content: Pack, written: Pick<TurnWritten, 'plan' | 'beats'>, m: Move, id: string): boolean {
  const secret = secretOf(content, id)
  if (!secret) return true
  if (m.who !== secret.holder) return m.move !== 'dodge' && m.move !== 'refuse'
  const hiding = written.plan.speakers.some((s) => s.id === m.who && (s.kept ?? []).includes(id) && s.approach !== 'partial truth')
  if (hiding) return false
  if (m.move === 'reveal' || m.move === 'concede') return true
  if (m.move !== 'answer') return false
  const spoken = written.beats.flatMap((b) => (b.kind === 'dialogue' && b.speaker === m.who ? [b.text] : [])).join(' ')
  return secret.keywords.some((k) => mentions(spoken, k))
}

/**
 * Secrets that came out on screen this turn, and who they came out in front of (milestone 4b; decided 2026-11-13): a
 * move whose speaker had a line gave one away (`givesAway`), in front of everyone present but its holder; or a reading check saw through
 * someone keeping one, for the reader (the player keeps no memories, so a player's read records nothing). Given the
 * state and the player's words, also a secret the player knows (learned, or said on screen) that their words bring up
 * by its keywords, in front of everyone present but its holder (decided 2026-11-15, user: you can only spread what you
 * know). Whether a listener took it in is the summary's call, as for the others.
 */
export function exposures(content: Pack, scene: NonNullable<GameState['scene']>, written: Pick<TurnWritten, 'plan' | 'beats'>, player?: { state: GameState; input: string }): NonNullable<Turn['exposed']> {
  const present = presentCast(scene)
  const voiced = new Set(written.beats.flatMap((b) => (b.kind === 'dialogue' ? [b.speaker] : [])))
  const out = new Map<string, Set<string>>()
  const add = (secret: string, to: string[]) => out.set(secret, new Set([...(out.get(secret) ?? []), ...to]))
  for (const m of written.plan.moves ?? []) {
    if (!voiced.has(m.who)) continue
    for (const s of m.says) {
      const holder = s.id ? secretOf(content, s.id)?.holder : undefined
      if (holder && givesAway(content, written, m, s.id!)) add(s.id!, present.filter((x) => x !== holder))
    }
  }
  for (const read of written.plan.reads ?? []) {
    if (read.by === 'player') continue
    for (const id of written.plan.speakers.find((x) => x.id === read.target)?.kept ?? []) add(id, [read.by])
  }
  if (player) {
    for (const id of present) {
      const c = characterById(content, id)
      for (const s of c?.secrets ?? []) {
        const secret = `${id}.${s.id}`
        const entry = s.codex ? entryById(content.codex, s.codex) : undefined
        const keywords = entry ? entry.keywords : (s.keywords ?? [])
        if (!keywords.some((k) => mentions(player.input, k))) continue
        const knows = (player.state.facts[id] ?? []).includes(s.text) || !!player.state.scene?.told.includes(secret)
        if (knows) add(secret, present.filter((x) => x !== id))
      }
    }
  }
  return [...out].flatMap(([secret, to]) => (to.size > 0 ? [{ secret, to: [...to] }] : []))
}

/**
 * Applies a finished turn to the state. Felt moods come from the plan's `feels`; tags only touch characters who are
 * present; departures and the scene's end
 * come from the plan alone (see `acceptTags` for which tags count).
 */
export function applyTurn(content: Pack, state: GameState, written: TurnWritten): GameState {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const present = new Set(presentCast(scene))
  const only = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => present.has(id)))

  const turn: Turn = {
    id: written.id,
    ...(written.log && { log: written.log }),
    player: written.input,
    beats: written.beats,
    checks: rolledChecks(written.plan),
    speakers: written.plan.speakers.map((s) => s.id),
    texture: written.plan.texture
  }
  const kept = written.plan.speakers.flatMap((s) => s.kept ?? [])
  if (kept.length > 0) turn.kept = kept
  if (written.details && written.details.length > 0) turn.details = written.details
  if (written.plan.reads && written.plan.reads.length > 0) turn.reads = written.plan.reads
  if (written.memories && written.memories.length > 0) turn.memories = written.memories
  const exposed = exposures(content, scene, written, { state, input: written.input })
  if (exposed.length > 0) turn.exposed = exposed
  const topics = [...new Set([...(written.topics ?? []), ...exposed.map((e) => e.secret)])]
  if (topics.length > 0) turn.topics = topics
  // What the director says they feel becomes their mood (milestone 4b); anyone it says nothing about keeps theirs.
  const felt = Object.fromEntries([...written.plan.speakers, ...written.plan.reactions].flatMap((s) => (s.feels ? [[s.id, s.feels]] : [])))
  // The strongest each felt, for the memory over-grading guard at the scene's end.
  const peaks = { ...scene.peaks }
  for (const [id, f] of Object.entries(felt)) if (present.has(id)) peaks[id] = Math.max(peaks[id] ?? 0, f.intensity)
  const comfort = Object.fromEntries(Object.entries(only(written.tags.comfort)).map(([id, c]) => [id, c.level]))
  const leaving = [...new Set(written.plan.leaves)].filter((id) => present.has(id))

  // The turn that drops out of the prompts' verbatim window goes into the running summary.
  const turns = [...scene.turns, turn]
  const dropped = turns.length > RECENT_TURNS ? turns[turns.length - RECENT_TURNS - 1] : undefined
  const summary = dropped ? `${scene.summary}\n\n${turnText(content, state.player.name, dropped)}`.trim().slice(-SUMMARY_CHARS) : scene.summary

  // What was said on screen joins the scene's common ground: a fact is introduced the first time, and anyone present
  // can repeat it after. Only moves whose speaker actually had a line count, in case the writer or salvage dropped one,
  // and a secret only when the move gave it away (`givesAway`): this list also forces the holder's Core memory and
  // tells the game the player knows it.
  const voiced = new Set(written.beats.flatMap((b) => (b.kind === 'dialogue' ? [b.speaker] : [])))
  const said = (written.plan.moves ?? []).filter((m) => voiced.has(m.who))
  const told = [...new Set([...scene.told, ...said.flatMap((m) => m.says.flatMap((s) => (s.id && givesAway(content, written, m, s.id) ? [s.id] : [])))])]
  const newFacts = [...scene.newFacts]
  for (const m of said)
    for (const s of m.says)
      if (!s.id && !newFacts.some((f) => f.text === s.text)) newFacts.push({ id: `said.${newFacts.length + 1}`, text: s.text, by: m.who })

  // How hard each speaker's aim pressed this turn, so the next can move it only a step; and which secrets' tells have shown.
  const pressures = { ...scene.pressures }
  for (const s of written.plan.speakers) {
    const level = s.pressure ? content.ruleset.pressures.indexOf(s.pressure) : -1
    if (level >= 0) pressures[s.id] = level
  }
  const tells = [...new Set([...scene.tells, ...written.plan.speakers.flatMap((s) => (s.tell && s.kept ? s.kept : []))])]

  // When each held secret was last active (milestone 4b: dormancy); a keep counts over being shown or brought up.
  const secretActivity = { ...state.secretActivity }
  const ORDER = ['kept', 'full', 'keyword', 'context'] as const
  for (const s of [...(written.secrets ?? []), ...kept.map((id) => ({ id, how: 'kept' as const }))].sort((a, b) => ORDER.indexOf(b.how) - ORDER.indexOf(a.how))) secretActivity[s.id] = { at: state.time, how: s.how }

  return {
    ...state,
    secretActivity,
    time: state.time + MINUTES_PER_TURN,
    dice: written.dice,
    scene: {
      ...scene,
      peaks,
      turns,
      summary,
      moods: { ...scene.moods, ...only(felt) },
      comfort: { ...scene.comfort, ...comfort },
      expressions: { ...scene.expressions, ...only(written.tags.expressions) },
      departed: [...scene.departed, ...leaving],
      ended: scene.ended || written.plan.end_scene,
      told,
      newFacts,
      pressures,
      tells
    }
  }
}
