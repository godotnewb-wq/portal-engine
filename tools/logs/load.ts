import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { characterById, locationById, type Pack } from '@engine/pack'
import { firstName } from '@engine/core'
import type { FlagRecord } from '@engine/review'
import { findSessions, readSession, type SessionLog } from '@platform/logs'
import { loadPack } from '@platform/packs'
import type { MetricInput } from './metrics'

const ROOT = resolve(__dirname, '../..')

/** A session's pack: `--pack` (an id in packs/ or a folder), else the bundled pack the session names. */
export function packFor(log: SessionLog, given?: string): Pack {
  const dir = given ? (existsSync(join(given, 'pack.json')) ? resolve(given) : join(ROOT, 'packs', given)) : join(ROOT, 'packs', log.session.pack.id)
  if (!existsSync(join(dir, 'pack.json'))) throw new Error(`No pack "${log.session.pack.id}" in packs/. Pass --pack <folder>.`)
  return loadPack(dir)
}

/** Every session under the paths given, read. */
export function sessionsAt(paths: string[]): SessionLog[] {
  const dirs = [...new Set(paths.flatMap((p) => findSessions(resolve(p))))]
  if (dirs.length === 0) throw new Error(`No log sessions found in ${paths.join(', ')}`)
  return dirs.map(readSession)
}

/**
 * Flags on a session's turns can be made in a later session (after loading a save), so they are looked for in every
 * session beside it too.
 */
export function flagsFor(log: SessionLog, siblings?: SessionLog[]): FlagRecord[] {
  const others = siblings ?? findSessions(dirname(log.dir), 1).filter((d) => d !== log.dir).map(readSession)
  return [...log.flags, ...others.flatMap((s) => s.flags)].filter((f) => f.turnSession === log.session.id)
}

export function metricInput(log: SessionLog, siblings?: SessionLog[]): MetricInput {
  return { session: log.session.id, turns: log.turns, calls: [...log.calls.values()], flags: flagsFor(log, siblings), scores: log.scores, errors: log.errors }
}

/** Where a scene happened: from its start record, or the bench scenario's location. */
export function sceneLocation(log: SessionLog, sceneId: string): string | undefined {
  const start = log.scenes.find((s) => s.type === 'start' && s.sceneId === sceneId)
  return start?.type === 'start' ? start.location : log.session.bench?.location
}

/** A display name for an id: a character's first name, a walk-on's name, or the id. */
export function namer(content: Pack, location?: string): (id: string) => string {
  return (id) => {
    if (id === 'player') return content.player.name
    const c = characterById(content, id)
    if (c) return firstName(c.name)
    const walkOn = (location ? [locationById(content, location)] : content.locations).flatMap((l) => l?.walkOns ?? []).find((w) => w.id === id)
    return walkOn?.name ?? walkOn?.label ?? id
  }
}
