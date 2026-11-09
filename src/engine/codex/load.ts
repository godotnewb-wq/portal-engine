import { IdSchema } from '@engine/core'
import { parseEntryFile } from './header'
import { AUDIENCES, CODEX_FOLDERS, EntryHeaderSchema, parseSelector, type CodexEntry, type Selector } from './schema'

/** One codex file as read from disk: its path relative to `codex/` (always with `/`) and its text. */
export interface CodexFile {
  path: string
  text: string
}

const isId = (s: string) => IdSchema.safeParse(s).success

/**
 * The id a file's path gives it. The folder names the kind of entry, each folder below it adds a part, and `main.md`
 * takes its folder's id, so ids can't drift from file names: `locations/ward/market/stall.md` →
 * `location.ward.market.stall`, `factions/guild/main.md` → `faction.guild`.
 */
export function idFromPath(path: string): { id: string; folder: string; parts: string[]; isMain: boolean } | string {
  const segments = path.split('/')
  const [folder, ...rest] = segments
  const spec = folder ? CODEX_FOLDERS[folder] : undefined
  if (!spec) return `"${folder}" isn't a codex folder (${Object.keys(CODEX_FOLDERS).join(', ')})`
  const last = rest.pop()
  if (!last?.endsWith('.md')) return 'codex entries are .md files'
  const name = last.slice(0, -3)
  const isMain = name === 'main'
  const parts = isMain ? rest : [...rest, name]
  if (parts.length === 0) return 'main.md must sit inside a folder that names the entry'
  const bad = parts.find((p) => !isId(p))
  if (bad !== undefined) return `"${bad}" isn't a valid id part (lower-case words joined by hyphens)`
  return { id: [spec.prefix, ...parts].join('.'), folder, parts, isMain }
}

/**
 * Reads every codex file into entries. Problems name the file (and line, for header problems); a file with problems
 * gives no entry. Checks that need the rest of the pack (factions, characters, tiers) are in `codexProblems`.
 */
export function buildCodex(files: CodexFile[]): { entries: CodexEntry[]; problems: string[] } {
  const problems: string[] = []
  const entries: CodexEntry[] = []
  const at = (file: string, p: string) => problems.push(`codex/${file}: ${p}`)

  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const where = idFromPath(f.path)
    if (typeof where === 'string') {
      at(f.path, where)
      continue
    }
    const parsed = parseEntryFile(f.text)
    if (!parsed.ok) {
      for (const p of parsed.problems) at(f.path, p)
      continue
    }
    const header = EntryHeaderSchema.safeParse(parsed.file.fields)
    if (!header.success) {
      for (const i of header.error.issues) at(f.path, `${i.path.join('.') || 'header'}: ${i.message}`)
      continue
    }
    const h = header.data
    if (!CODEX_FOLDERS[where.folder]!.kinds.includes(h.kind)) {
      at(f.path, `a ${h.kind} entry can't go in ${where.folder}/ (expected ${CODEX_FOLDERS[where.folder]!.kinds.join(' or ')})`)
      continue
    }
    if (!parsed.file.body) {
      at(f.path, 'the entry has no text below its header')
      continue
    }

    let faction: string | undefined
    if (h.kind === 'faction') {
      // A faction's main entry sits in the faction's own folder; a deeper entry sits beside it.
      faction = where.isMain ? where.parts.at(-1) : where.parts.at(-2)
      if (!faction) {
        at(f.path, 'faction entries go in a folder named for the faction (factions/<faction>/main.md)')
        continue
      }
    }

    const selectors = (texts: string[], field: string): Selector[] =>
      texts.flatMap((t) => {
        const s = parseSelector(t)
        if (typeof s === 'string') {
          at(f.path, `${field}: ${s}`)
          return []
        }
        return [s]
      })
    let circle: Selector | undefined
    if (h.circle) [circle] = selectors([h.circle], 'circle')
    else if (h.knowledge === 'circles' && faction) circle = { by: 'faction', faction, level: 'member' }

    entries.push({
      id: where.id,
      file: f.path,
      name: h.name,
      kind: h.kind,
      keywords: h.keywords,
      aliases: h.aliases,
      summary: h.summary,
      full: parsed.file.body,
      // Secrets reach only the director, and only on a holder's sheet; everything else may go anywhere it's picked.
      audience: h.audience ?? (h.knowledge === 'secret' ? ['director'] : [...AUDIENCES]),
      knowledge: h.knowledge,
      ...(circle && { circle }),
      also: selectors(h.also, 'also'),
      knownBy: selectors(h['known-by'], 'known-by'),
      ...(h.cap !== undefined && { cap: h.cap }),
      belief: h.belief,
      related: h.related,
      ...(h.stage && { stage: h.stage }),
      ...(h.source && { source: h.source }),
      origin: h.origin,
      saveScoped: h['save-scoped'],
      ...(h.expires && { expires: h.expires }),
      ...(h.kind === 'location' && { layer: where.parts.length }),
      ...(faction && { faction })
    })
  }
  return { entries, problems }
}

export const entryById = (entries: CodexEntry[], id: string) => entries.find((e) => e.id === id)

/**
 * A location's chain from itself up to its tier, read from its id: `location.ward.market.stall` →
 * stall, market, ward. Only the ids that exist in the codex are returned.
 */
export function locationChain(entries: CodexEntry[], id: string): CodexEntry[] {
  const parts = id.split('.')
  if (parts[0] !== 'location') return []
  const chain: CodexEntry[] = []
  for (let n = parts.length; n > 1; n--) {
    const e = entryById(entries, parts.slice(0, n).join('.'))
    if (e) chain.push(e)
  }
  return chain
}
