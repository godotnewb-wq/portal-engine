import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { CallTrace } from '@engine/core'
import type { SceneEndTrace } from '@engine/relationships'
import type { TurnTrace } from '@engine/scene'
import type { FlagRecord, ScoreRecord } from '@engine/review'
import { FILES, sessionName, splitPrompt, type CallRecord, type ErrorRecord, type PromptRecord, type SceneRecord, type SessionRecord, type TurnRecord } from './records'

/**
 * Writes one session's folder (milestone 2, A2). Every `.jsonl` line is appended as soon as it happens, so a crash
 * loses at most the turn in progress; `session.json` is written at the start and again at the end, and one without
 * an end time marks a session that didn't close cleanly. Nothing here deletes anything.
 */
export class LogSession {
  private readonly stored = new Set<string>()

  private constructor(
    readonly dir: string,
    private record: SessionRecord
  ) {
    const prompts = join(dir, FILES.prompts)
    if (existsSync(prompts)) {
      for (const line of readFileSync(prompts, 'utf8').split('\n')) {
        try {
          if (line.trim()) this.stored.add((JSON.parse(line) as PromptRecord).id)
        } catch {
          // A half-written last line from a crash: that section is written again if it comes up.
        }
      }
    }
  }

  get id(): string {
    return this.record.id
  }

  /** Starts a session in a new folder under `root` (one per pack: `logs/<pack-id>/`). */
  static open(root: string, info: Omit<SessionRecord, 'id' | 'startedAt'>, now = new Date(), name = sessionName(now, randomBytes(2).toString('hex'))): LogSession {
    let dir = join(root, name)
    for (let n = 2; existsSync(dir); n++) dir = join(root, `${name}-${n}`)
    mkdirSync(dir, { recursive: true })
    const session = new LogSession(dir, { ...info, id: dir.split(/[\\/]/).pop()!, startedAt: now.toISOString() })
    session.writeSession()
    return session
  }

  /** Reopens a session to add to it: the flag panel and the scorer write into sessions after play. */
  static resume(dir: string): LogSession {
    return new LogSession(dir, JSON.parse(readFileSync(join(dir, FILES.session), 'utf8')) as SessionRecord)
  }

  /** Writes the calls and the prompt sections not yet stored; returns their ids. */
  calls(calls: CallTrace[]): string[] {
    for (const call of calls) {
      const { ref, parts } = splitPrompt(call.prompt)
      for (const part of parts) {
        if (this.stored.has(part.id)) continue
        this.stored.add(part.id)
        this.append(FILES.prompts, part)
      }
      const { prompt: _prompt, ...rest } = call
      this.append(FILES.calls, { ...rest, prompt: ref } satisfies CallRecord)
    }
    return calls.map((c) => c.id)
  }

  turn(trace: TurnTrace): void {
    const { calls, ...rest } = trace
    this.append(FILES.turns, { ...rest, calls: this.calls(calls) } satisfies TurnRecord)
  }

  sceneStart(scene: { sceneId: string; location: string; cast: string[] }, now = new Date()): void {
    this.append(FILES.scenes, { type: 'start', ...scene, at: now.toISOString() } satisfies SceneRecord)
  }

  sceneEnd(trace: SceneEndTrace): void {
    const { calls, ...rest } = trace
    this.append(FILES.scenes, { type: 'end', ...rest, calls: this.calls(calls) } satisfies SceneRecord)
  }

  error(error: Omit<ErrorRecord, 'at' | 'calls'> & { calls?: CallTrace[] }, now = new Date()): void {
    const { calls, ...rest } = error
    const ids = calls && calls.length > 0 ? this.calls(calls) : undefined
    this.append(FILES.errors, { at: now.toISOString(), ...rest, ...(ids && { calls: ids }) } satisfies ErrorRecord)
  }

  flag(record: FlagRecord): void {
    this.append(FILES.flags, record)
  }

  score(record: ScoreRecord, call?: CallTrace): void {
    if (call) this.calls([call])
    this.append(FILES.scores, record)
  }

  /** Records the models each role used; written into `session.json`. */
  models(models: SessionRecord['models']): void {
    this.record = { ...this.record, models: { ...this.record.models, ...models } }
    this.writeSession()
  }

  close(now = new Date()): void {
    if (this.record.endedAt) return
    this.record = { ...this.record, endedAt: now.toISOString() }
    this.writeSession()
  }

  get info(): SessionRecord {
    return this.record
  }

  private append(file: string, value: unknown): void {
    appendFileSync(join(this.dir, file), `${JSON.stringify(value)}\n`)
  }

  private writeSession(): void {
    const path = join(this.dir, FILES.session)
    writeFileSync(`${path}.tmp`, JSON.stringify(this.record, null, 2))
    renameSync(`${path}.tmp`, path)
  }
}
