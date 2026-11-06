import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { CallTrace, Prompt } from '@engine/core'
import { FlagRecordSchema, type FlagRecord, type ScoreRecord } from '@engine/review'
import { FILES, joinSections, type CallRecord, type ErrorRecord, type PromptRecord, type SceneRecord, type SessionRecord, type TurnRecord } from './records'

/** One session's files, read and joined by id. */
export interface SessionLog {
  dir: string
  session: SessionRecord
  turns: TurnRecord[]
  calls: Map<string, CallRecord>
  prompts: Map<string, string>
  scenes: SceneRecord[]
  flags: FlagRecord[]
  scores: ScoreRecord[]
  errors: ErrorRecord[]
  /** Lines that couldn't be read (a crash mid-write leaves a half line). */
  unreadable: number
}

function lines<T>(dir: string, file: string, counter: { n: number }): T[] {
  const path = join(dir, file)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line) => {
      if (!line.trim()) return []
      try {
        return [JSON.parse(line) as T]
      } catch {
        counter.n++
        return []
      }
    })
}

export const isSession = (dir: string): boolean => existsSync(join(dir, FILES.session))

export function readSession(dir: string): SessionLog {
  const counter = { n: 0 }
  const session = JSON.parse(readFileSync(join(dir, FILES.session), 'utf8')) as SessionRecord
  const flags = lines<unknown>(dir, FILES.flags, counter).flatMap((f) => {
    const parsed = FlagRecordSchema.safeParse(f)
    if (!parsed.success) counter.n++
    return parsed.success ? [parsed.data] : []
  })
  return {
    dir,
    session,
    turns: lines<TurnRecord>(dir, FILES.turns, counter),
    calls: new Map(lines<CallRecord>(dir, FILES.calls, counter).map((c) => [c.id, c])),
    prompts: new Map(lines<PromptRecord>(dir, FILES.prompts, counter).map((p) => [p.id, p.text])),
    scenes: lines<SceneRecord>(dir, FILES.scenes, counter),
    flags,
    scores: lines<ScoreRecord>(dir, FILES.scores, counter),
    errors: lines<ErrorRecord>(dir, FILES.errors, counter),
    unreadable: counter.n
  }
}

/** A call's full prompt, put back together from its sections. A section that went missing shows as a marker. */
export function promptOf(log: SessionLog, call: CallRecord): Prompt {
  const text = (ids: string[]) => joinSections(ids.map((id) => log.prompts.get(id) ?? `[missing prompt section ${id}]`))
  return { system: text(call.prompt.system), user: text(call.prompt.user) }
}

/** A call as the engine traced it, prompt included. */
export function callTrace(log: SessionLog, id: string): CallTrace | undefined {
  const call = log.calls.get(id)
  return call && { ...call, prompt: promptOf(log, call) }
}

/**
 * Every session under a path, oldest first by folder name: the path itself if it is a session, else the sessions
 * inside it, looking down through folders of sessions (a pack's logs, a bench run, a folder of bench runs).
 */
export function findSessions(path: string, depth = 3): string[] {
  if (!existsSync(path) || !statSync(path).isDirectory()) return []
  if (isSession(path)) return [path]
  if (depth === 0) return []
  return readdirSync(path)
    .sort()
    .flatMap((name) => findSessions(join(path, name), depth - 1))
}
