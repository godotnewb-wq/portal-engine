import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CallTrace } from '@engine/core'
import type { Pack } from '@engine/pack'
import type { ConsolidationTrace, SceneEndTrace, RelationshipTrace } from '@engine/relationships'
import { promptSources, type BookkeeperTrace, type OpeningTrace, type Pipeline, type TurnTrace } from '@engine/scene'
import { currentFlags, FlagSchema, type Flag, type FlagRecord, type ScoreRecord } from '@engine/review'
import { callTrace, findSessions, readFlags, readSession } from './reader'
import { promptVersion, type BookkeepingRecord, type CallRecord, type SessionRecord, type TurnRecord } from './records'
import { LogSession } from './writer'

/** A call as the Turn details panel shows it: no prompt or reply, just what it cost and who answered. */
export interface CallSummary {
  id: string
  role: CallRecord['role']
  profile?: string
  model?: string
  ms: number
  firstTextMs?: number
  tokens?: { input?: number; output?: number }
  restarted?: boolean
  declined?: string
  jsonRetried?: boolean
  error?: string
}

/**
 * One logged turn for the Turn details panel: its readable trace, its calls, any AI scores, and the bookkeeper's
 * record once it has answered (milestone 4d; absent for a turn just played, until it is read back, and in older logs).
 */
export interface TurnDetails {
  session: string
  turn: TurnRecord
  calls: CallSummary[]
  scores: ScoreRecord[]
  records?: BookkeepingRecord
}

/** One call's prompt and reply, read back from its session for a Calls tab (milestone 4d). */
export interface CallText {
  id: string
  role: CallRecord['role']
  system: string
  user: string
  reply?: string
  error?: string
}

/**
 * The scene's end for its details view (milestone 4d): the relationship calls and the ties settled from them, then
 * the memory calls and what each witness took, each with its calls summarized; `session` is where their prompts can
 * be read back, absent with logging off. Either half is absent when it didn't run.
 */
export interface SceneEndDetails {
  session?: string
  ties?: Omit<RelationshipTrace, 'calls'> & { calls: CallSummary[] }
  end?: Omit<SceneEndTrace, 'calls'> & { calls: CallSummary[] }
}

/** A trace with its calls summarized, for the screen. */
export const summarized = <T extends { calls: CallTrace[] }>(trace: T): Omit<T, 'calls'> & { calls: CallSummary[] } => ({ ...trace, calls: trace.calls.map(summarizeCall) })

/** What the flag panel sends: what is flagged, and the flag (null clears it). */
export interface FlagInput {
  turnSession: string
  turnId: string
  beat?: number
  speaker?: string
  text?: string
  flag: Flag | null
}

export const summarizeCall = (c: Omit<CallTrace, 'prompt'>): CallSummary => ({
  id: c.id,
  role: c.role,
  ...(c.meta?.profile && { profile: c.meta.profile }),
  ...(c.meta?.model && { model: c.meta.model }),
  ms: c.ms,
  ...(c.firstTextMs !== undefined && { firstTextMs: c.firstTextMs }),
  ...(c.meta?.usage && { tokens: c.meta.usage }),
  ...(c.restarted && { restarted: true }),
  ...(c.meta?.declined && { declined: c.meta.declined }),
  ...(c.meta?.jsonRetried && { jsonRetried: true }),
  ...(c.error && { error: c.error })
})

/** The readable part of a fresh trace, as `turns.jsonl` keeps it, with its calls summarized. */
export function detailsOf(session: string, trace: TurnTrace): TurnDetails {
  const { calls, ...rest } = trace
  return { session, turn: { ...rest, calls: calls.map((c) => c.id) }, calls: calls.map(summarizeCall), scores: [] }
}

/**
 * The game's logs for one pack (milestone 2, A2): a session runs from starting or loading a game until the player
 * returns to the title screen or quits. Turns, scene ends and errors go into the open session; with logging off,
 * nothing is written and there is no session. Old sessions are read for read-back (Turn details, flags) but only
 * flags are added to them, in the current session's file.
 */
export class PlayLogs {
  private session: LogSession | null = null
  private scenes = new Set<string>()

  constructor(
    /** `userData/logs/<pack-id>`; never inside a pack folder. */
    private readonly root: string,
    private readonly pack: Pack,
    private readonly info: () => Pick<SessionRecord, 'engine' | 'models'> & { pipeline?: Pipeline },
    private readonly enabled: () => boolean
  ) {}

  get dir(): string {
    return this.root
  }

  /** The open session's id, if logging is on and a session is open. */
  get current(): string | null {
    return this.session?.id ?? null
  }

  /** Starts a session, closing any open one: a game was started or loaded. */
  begin(from: string, now = new Date()): string | null {
    this.end(now)
    if (!this.enabled()) return null
    // The prompt version of the pipeline in use: it used to be the default's whatever played (2026-11-24 play logs).
    const { engine, models, pipeline } = this.info()
    this.session = LogSession.open(this.root, { kind: 'play', pack: { id: this.pack.manifest.id, version: this.pack.manifest.version }, engine, prompts: promptVersion(promptSources(this.pack, pipeline)), ...(pipeline && { pipeline }), models, from }, now)
    this.scenes.clear()
    return this.session.id
  }

  end(now = new Date()): void {
    this.session?.close(now)
    this.session = null
  }

  /** The open session, starting one if play began without saying how (so no turn goes unlogged). */
  private open(): LogSession | null {
    if (!this.session && this.enabled()) this.begin('unknown')
    return this.session
  }

  /** The id the next turn should be logged under, before it runs. */
  sessionForTurn(): string | null {
    return this.open()?.id ?? null
  }

  turn(trace: TurnTrace, scene: { location: string; cast: string[] }): TurnDetails | null {
    const log = this.open()
    if (!log) return null
    if (!this.scenes.has(trace.sceneId)) {
      this.scenes.add(trace.sceneId)
      log.sceneStart({ sceneId: trace.sceneId, ...scene }, new Date(trace.at))
    }
    log.turn(trace)
    return detailsOf(log.id, trace)
  }

  sceneEnd(trace: SceneEndTrace): void {
    this.open()?.sceneEnd(trace)
  }

  /** The scene's opening, after its start record: the scene starts in the logs when it opens, not at its first turn. */
  opening(trace: OpeningTrace, scene: { location: string; cast: string[] }): void {
    const log = this.open()
    if (!log) return
    if (!this.scenes.has(trace.sceneId)) {
      this.scenes.add(trace.sceneId)
      log.sceneStart({ sceneId: trace.sceneId, ...scene }, new Date(trace.at))
    }
    log.opening(trace)
  }

  /** The relationship calls and the ties settled from them (milestone 4c), in the scenes file before the scene's end. */
  ties(trace: RelationshipTrace): void {
    this.open()?.ties(trace)
  }

  /** A turn's bookkeeper (milestone 4c), once it answered, failed or the turn stopped waiting. */
  bookkeeping(trace: BookkeeperTrace, late = false): void {
    this.open()?.bookkeeping(trace, late)
  }

  /** A consolidation run between scenes (milestone 4b): its groups and calls, in the scenes file. */
  consolidation(trace: ConsolidationTrace): void {
    this.open()?.consolidation(trace)
  }

  error(where: 'turn' | 'scene-end' | 'app', message: string, context: { turnId?: string; sceneId?: string; calls?: CallTrace[] } = {}): void {
    this.open()?.error({ where, message, ...context })
  }

  /** Writes a flag into the current session's file, naming the session that recorded the turn. */
  flag(input: FlagInput, now = new Date()): FlagRecord | null {
    const log = this.open()
    if (!log) return null
    const record: FlagRecord = {
      session: log.id,
      turnSession: input.turnSession,
      turnId: input.turnId,
      ...(input.beat !== undefined && { beat: input.beat }),
      ...(input.speaker && { speaker: input.speaker }),
      ...(input.text && { text: input.text }),
      flag: input.flag ? FlagSchema.parse(input.flag) : null,
      at: now.toISOString()
    }
    log.flag(record)
    return record
  }

  /** The flags standing on these turns, from every session of this pack (a flag may be made in a later session). */
  flagsFor(turns: { session: string; turnId: string }[]): FlagRecord[] {
    if (turns.length === 0) return []
    const wanted = new Set(turns.map((t) => `${t.session}/${t.turnId}`))
    const all = this.sessionDirs().flatMap(readFlags)
    return [...currentFlags(all).values()].filter((r) => wanted.has(`${r.turnSession}/${r.turnId}`))
  }

  /** A logged turn read back from its session, with scores written there by the scorer. */
  details(session: string, turnId: string): TurnDetails | null {
    const dir = join(this.root, session)
    if (!/^[\w.-]+$/.test(session) || !existsSync(dir)) return null
    const log = readSession(dir)
    const turn = log.turns.find((t) => t.turnId === turnId)
    if (!turn) return null
    const records = log.bookkeeping.find((b) => b.turnId === turnId)
    // The bookkeeper's call is logged with its record, after the turn's own; the Calls tab lists them together.
    return {
      session,
      turn,
      calls: [...turn.calls, ...(records?.calls ?? [])].flatMap((id) => {
        const call = log.calls.get(id)
        return call ? [summarizeCall(call)] : []
      }),
      scores: log.scores.filter((s) => s.turnSession === session && s.turnId === turnId),
      ...(records && { records })
    }
  }

  /** A logged call's prompt and reply (milestone 4d), or null when the session or call isn't there. */
  call(session: string, callId: string): CallText | null {
    const dir = join(this.root, session)
    if (!/^[\w.-]+$/.test(session) || !existsSync(dir)) return null
    const call = callTrace(readSession(dir), callId)
    return call ? { id: call.id, role: call.role, system: call.prompt.system, user: call.prompt.user, ...(call.reply && { reply: call.reply }), ...(call.error && { error: call.error }) } : null
  }

  private sessionDirs(): string[] {
    if (!existsSync(this.root) || readdirSync(this.root).length === 0) return []
    return findSessions(this.root, 1)
  }
}
