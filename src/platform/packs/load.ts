import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import { CharacterSchema, PlayerSchema } from '@engine/characters'
import { LocationSchema } from '@engine/world'
import { contentProblems, type Content } from '@engine/pack'

function parseFile<S extends z.ZodType>(schema: S, path: string): z.infer<S> {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${(error as Error).message})`)
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new Error(`${path}: ${issues}`)
  }
  return parsed.data
}

function parseDir<S extends z.ZodType>(schema: S, dir: string): z.infer<S>[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => parseFile(schema, join(dir, name)))
}

/** Loads and checks a content folder (e.g. `content/default`). Throws with every problem found. */
export function loadContent(root: string): Content {
  const content: Content = {
    characters: parseDir(CharacterSchema, join(root, 'characters')),
    locations: parseDir(LocationSchema, join(root, 'locations')),
    player: parseFile(PlayerSchema, join(root, 'player.json'))
  }
  const problems = contentProblems(content)
  if (problems.length > 0) throw new Error(`Content in ${root} has problems:\n- ${problems.join('\n- ')}`)
  return content
}
