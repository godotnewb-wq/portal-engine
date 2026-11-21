import type { Beat, Bookkeeping, GameState, RolledCheck, Turn } from '@engine/state'
import type { Tags } from './beats'
import { characterById, type Pack } from '@engine/pack'
import { firstName } from '@engine/core'
import { RECENT_TURNS, turnText } from './director'
import { planBookkeeping } from './bookkeeper'
import { presentCast, type BeatPlan } from './planShape'

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
  /** The turn's records, when they are already known (tests, tools); left out, the plan's stand in until the bookkeeper answers. */
  records?: Bookkeeping
  /** The pressures the `scene` pipeline played live (Milestone 5, task 1), kept on the turn as `live`. */
  live?: { who: string; kind: 'goal' | 'secret' | 'tie'; ref: string }[]
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

/**
 * Puts a turn's records into the state (milestone 4c): the bookkeeper's, or the plan's until it answers and when it
 * fails. Always the scene's last turn, since the next turn waits for its bookkeeper. Replaces whatever records the turn
 * had: the secrets it added to `told`, who they came out in front of (`exposed`), the secrets among its topics, and
 * the details it said (`newFacts`), so applying the same records twice changes nothing. A secret comes out only
 * through `records.out`; leaks, guesses and unresolved cases are kept on the turn and teach no one (decided
 * 2026-11-18, user, J–L).
 */
export function applyRecords(state: GameState, records: Bookkeeping): GameState {
  const scene = state.scene
  const turn = scene?.turns.at(-1)
  if (!scene || !turn) throw new Error('No turn to record')
  const unique = <T>(xs: T[]) => [...new Set(xs)]
  const before = scene.told.filter((id) => !(turn.toldSecrets ?? []).includes(id))
  const out = unique(records.out.map((o) => o.secret))
  const toldSecrets = out.filter((id) => !before.includes(id))
  const exposed = out.flatMap((secret) => {
    const to = unique(records.out.filter((o) => o.secret === secret).flatMap((o) => o.to))
    return to.length > 0 ? [{ secret, to }] : []
  })
  const wereOut = (turn.records?.out ?? []).map((o) => o.secret)
  const topics = unique([...(turn.topics ?? []).filter((t) => !wereOut.includes(t)), ...out])
  const kept = scene.newFacts.filter((f) => f.turn !== turn.id)
  const newFacts = [...kept]
  for (const n of records.new) if (!newFacts.some((f) => f.text === n.text)) newFacts.push({ id: `said.${newFacts.length + 1}`, text: n.text, by: n.by, turn: turn.id })
  const { exposed: _e, topics: _t, toldSecrets: _s, ...rest } = turn
  const recorded = { ...rest, records, ...(exposed.length > 0 && { exposed }), ...(topics.length > 0 && { topics }), ...(toldSecrets.length > 0 && { toldSecrets }) }
  return { ...state, scene: { ...scene, turns: [...scene.turns.slice(0, -1), recorded], told: [...before, ...toldSecrets], newFacts } }
}

/**
 * Applies a finished turn to the state. Felt moods come from the plan's `feels`; tags only touch characters who are
 * present; departures and the scene's end come from the plan alone (see `acceptTags` for which tags count). Secrets
 * that came out and new details come from the turn's records (`applyRecords`), the plan's until the bookkeeper answers.
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
  if (written.live && written.live.length > 0) turn.live = written.live
  if (written.details && written.details.length > 0) turn.details = written.details
  if (written.plan.reads && written.plan.reads.length > 0) turn.reads = written.plan.reads
  if (written.memories && written.memories.length > 0) turn.memories = written.memories
  if (written.topics && written.topics.length > 0) turn.topics = [...new Set(written.topics)]
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

  // Facts said on screen join the scene's common ground: a fact is introduced the first time, and anyone present can
  // repeat it after. Only moves whose speaker actually had a line count, in case the writer or salvage dropped one.
  // Known facts stay plan-based (milestone 4c, until milestone 5); secrets and new details come from the records.
  const voiced = new Set(written.beats.flatMap((b) => (b.kind === 'dialogue' ? [b.speaker] : [])))
  const said = (written.plan.moves ?? []).filter((m) => voiced.has(m.who))
  const isSecret = (id: string) => content.characters.some((c) => c.secrets.some((x) => `${c.id}.${x.id}` === id))
  const told = [...new Set([...scene.told, ...said.flatMap((m) => m.says.flatMap((s) => (s.id && !isSecret(s.id) ? [s.id] : [])))])]

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

  // Secrets and new details come from the turn's records: the plan's stand in until the bookkeeper answers (milestone 4c).
  const records = written.records ?? planBookkeeping(content, state, written)
  return applyRecords({
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
      pressures,
      tells
    }
  }, records)
}
