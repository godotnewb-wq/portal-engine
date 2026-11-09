import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { buildPack, type BuiltPack, type Pack, type PackFiles } from '@engine/pack'

const json = (path: string, problems: string[], name: string): unknown => {
  if (!existsSync(path)) {
    problems.push(`${name}: missing`)
    return undefined
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    problems.push(`${name}: not valid JSON (${(error as Error).message})`)
    return undefined
  }
}

const text = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')

function dir(root: string, sub: string, problems: string[]): { file: string; data: unknown }[] {
  const path = join(root, sub)
  if (!existsSync(path)) return []
  return readdirSync(path)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((file) => ({ file, data: json(join(path, file), problems, `${sub}/${file}`) }))
}

/** Every `.md` file under `codex/`, with paths relative to it and always written with `/`. */
function codexFiles(root: string): { path: string; text: string }[] {
  const base = join(root, 'codex')
  if (!existsSync(base)) return []
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? walk(path) : name.endsWith('.md') ? [path] : []
    })
  return walk(base)
    .map((path) => ({ path: relative(base, path).split(/[\\/]/).join('/'), text: readFileSync(path, 'utf8') }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Reads a pack folder's files (architecture §5 layout) without judging them. Files that are missing or aren't JSON
 * are reported here; everything else is for `buildPack`.
 */
export function readPackFiles(root: string): { files: PackFiles; problems: string[] } {
  const problems: string[] = []
  const files: PackFiles = {
    manifest: json(join(root, 'pack.json'), problems, 'pack.json'),
    ruleset: json(join(root, 'ruleset', 'ruleset.json'), problems, 'ruleset/ruleset.json'),
    setting: json(join(root, 'setting', 'setting.json'), problems, 'setting/setting.json'),
    primer: text(join(root, 'setting', 'primer.md')),
    tone: text(join(root, 'setting', 'tone.md')),
    phrases: existsSync(join(root, 'setting', 'phrases.json')) ? json(join(root, 'setting', 'phrases.json'), problems, 'setting/phrases.json') : undefined,
    player: json(join(root, 'player.json'), problems, 'player.json'),
    characters: dir(root, 'characters', problems),
    locations: dir(root, 'locations', problems),
    codex: codexFiles(root)
  }
  return { files, problems }
}

/** Reads and validates a pack folder in one step. */
export function readPack(root: string): BuiltPack {
  const { files, problems } = readPackFiles(root)
  const built = buildPack(files)
  if (problems.length === 0) return built
  return { ok: false, problems: [...problems, ...(built.ok ? [] : built.problems)], ...(built.ok ? { manifest: built.pack.manifest } : built.manifest && { manifest: built.manifest }) }
}

/** Reads a pack that must be sound (tests, the bench): throws with every problem otherwise. */
export function loadPack(root: string): Pack {
  const built = readPack(root)
  if (!built.ok) throw new Error(`The pack in ${root} has problems:\n- ${built.problems.join('\n- ')}`)
  return built.pack
}
