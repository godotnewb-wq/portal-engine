import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import type { Pack, PackManifest } from '@engine/pack'
import { readPack } from './load'

/** Where packs are looked for (architecture §9). Bundled packs ship with the app; user packs live in app data. */
export interface PackSource {
  kind: 'bundled' | 'user' | 'extra'
  dir: string
}

/** One pack folder as the picker shows it, sound or not. */
export interface PackListing {
  /** The folder's absolute path: unique even when two packs share an id. */
  key: string
  source: PackSource['kind']
  /** Read from pack.json when it reads, even if the rest of the pack doesn't. */
  manifest?: PackManifest
  ok: boolean
  problems: string[]
  /** Another folder holds a pack with the same id; the player picks one. */
  duplicate: boolean
  /** The cover image as a data URL, for the picker. */
  cover?: string
}

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

function cover(dir: string, manifest: PackManifest | undefined): string | undefined {
  const file = manifest?.ui.cover
  if (!file) return undefined
  const path = resolve(dir, file)
  const type = IMAGE_TYPES[extname(path).toLowerCase()]
  // The cover must sit inside the pack folder: a pack can't point the app at other files.
  if (!type || !path.startsWith(resolve(dir)) || !existsSync(path)) return undefined
  return `data:${type};base64,${readFileSync(path).toString('base64')}`
}

/** Pack folders in a source: the folder itself if it holds a pack.json, otherwise each subfolder that does. */
function packFolders(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
  if (existsSync(join(dir, 'pack.json'))) return [resolve(dir)]
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isDirectory() && existsSync(join(path, 'pack.json')))
    .sort()
    .map((path) => resolve(path))
}

/**
 * Finds every pack in every source and reads each one. Invalid packs are listed with their problems rather than
 * hidden, and packs sharing an id are all listed, marked, so nothing is silently overridden.
 */
export function discoverPacks(sources: PackSource[]): { listings: PackListing[]; packs: Map<string, Pack> } {
  const listings: PackListing[] = []
  const packs = new Map<string, Pack>()
  const seen = new Set<string>()
  for (const source of sources) {
    for (const dir of packFolders(source.dir)) {
      if (seen.has(dir)) continue
      seen.add(dir)
      const built = readPack(dir)
      const manifest = built.ok ? built.pack.manifest : built.manifest
      if (built.ok) packs.set(dir, built.pack)
      listings.push({ key: dir, source: source.kind, ...(manifest && { manifest }), ok: built.ok, problems: built.ok ? [] : built.problems, duplicate: false, ...(cover(dir, manifest) && { cover: cover(dir, manifest)! }) })
    }
  }
  const ids = listings.flatMap((l) => (l.manifest ? [l.manifest.id] : []))
  for (const l of listings) l.duplicate = !!l.manifest && ids.filter((id) => id === l.manifest!.id).length > 1
  return { listings, packs }
}
