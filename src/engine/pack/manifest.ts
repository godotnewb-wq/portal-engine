import { z } from 'zod'
import { IdSchema } from '@engine/core'

/** The running engine's version. A pack names the range of engine versions it works with. */
export const ENGINE_VERSION = '0.2.0'

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

/** A pack's `pack.json` (architecture §5). */
export const PackManifestSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  version: z.string().regex(SEMVER, 'versions are major.minor.patch, e.g. 1.0.0'),
  description: z.string().default(''),
  author: z.string().default(''),
  license: z.string().default(''),
  /** The engine versions this pack works with: "^0.2.0", ">=0.2.0 <1.0.0", "0.2.0" or "*". */
  engine: z.string().min(1),
  /** Where a new game opens. */
  /**
   * The opening scene. `party`: Major Characters already in the player's party at the start (npc design §2); they must
   * be in the opening cast. Joining and leaving in play come with milestone 7.
   */
  start: z.object({ location: IdSchema, cast: z.array(IdSchema).default([]), party: z.array(IdSchema).default([]) }),
  ui: z
    .object({
      /** The title screen's heading; the pack name if left out. */
      title: z.string().optional(),
      tagline: z.string().default(''),
      /** An image in the pack folder, shown in the pack picker. */
      cover: z.string().optional()
    })
    .prefault({}),
  /** Pack rating or notes, shown in the pack picker. */
  content: z.object({ rating: z.string().default(''), notes: z.string().default('') }).prefault({})
})
export type PackManifest = z.infer<typeof PackManifestSchema>

type Version = [number, number, number]
const parse = (v: string): Version | undefined => {
  const m = v.trim().match(SEMVER)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}
const compare = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/**
 * Whether a version is in a range. Ranges are space-separated comparators that must all hold (`>=0.2.0 <1.0.0`), an
 * exact version, a caret (`^0.2.0`: same major, or same minor below 1.0.0), or `*`. Enough for pack manifests
 * without a dependency.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parse(version)
  if (!v) return false
  const parts = range.trim().split(/\s+/)
  return parts.every((part) => {
    if (part === '*') return true
    const caret = part.match(/^\^(.+)$/)
    if (caret) {
      const base = parse(caret[1]!)
      if (!base || compare(v, base) < 0) return false
      return base[0] > 0 ? v[0] === base[0] : v[0] === 0 && v[1] === base[1]
    }
    const op = part.match(/^(>=|<=|>|<|=)?(.+)$/)!
    const target = parse(op[2]!)
    if (!target) return false
    const c = compare(v, target)
    switch (op[1]) {
      case '>=':
        return c >= 0
      case '<=':
        return c <= 0
      case '>':
        return c > 0
      case '<':
        return c < 0
      default:
        return c === 0
    }
  })
}
