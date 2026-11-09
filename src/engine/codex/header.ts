/**
 * The header of a codex entry file: a small YAML subset between `---` lines, read by hand so the engine still imports
 * only zod. Supported: `key: value` lines, quoted strings, one-line lists (`[a, b, "c, d"]`), `true` / `false`,
 * blank lines and `#` comments. Anything else is a problem naming the line, so a typo can't silently drop a field.
 */

export type HeaderValue = string | boolean | string[]

export interface ParsedEntryFile {
  fields: Record<string, HeaderValue>
  /** Everything after the closing `---`, trimmed: the entry's full text. */
  body: string
}

export type HeaderResult = { ok: true; file: ParsedEntryFile } | { ok: false; problems: string[] }

const KEY = /^([a-z][a-z-]*):(?:\s+(.*))?$/

/** Reads a double- or single-quoted string starting at `text[0]`; returns the value and what's left. */
function quoted(text: string): { value: string; rest: string } | undefined {
  const q = text[0]
  if (q !== '"' && q !== "'") return undefined
  let value = ''
  for (let i = 1; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '\\' && q === '"' && i + 1 < text.length) {
      value += text[++i]
      continue
    }
    if (ch === q) return { value, rest: text.slice(i + 1) }
    value += ch
  }
  return undefined
}

function list(text: string): string[] | string {
  const inner = text.slice(1, -1).trim()
  if (!inner) return []
  const items: string[] = []
  let rest = inner
  while (rest.length > 0) {
    let item: string
    if (rest[0] === '"' || rest[0] === "'") {
      const q = quoted(rest)
      if (!q) return 'a quoted list item is never closed'
      item = q.value
      rest = q.rest.trim()
      if (rest && rest[0] !== ',') return 'expected a comma after a quoted list item'
      rest = rest.slice(1).trim()
    } else {
      const comma = rest.indexOf(',')
      item = (comma < 0 ? rest : rest.slice(0, comma)).trim()
      rest = comma < 0 ? '' : rest.slice(comma + 1).trim()
      if (!item) return 'an empty list item'
      if (/[[\]{}]/.test(item)) return 'lists can’t be nested'
    }
    items.push(item)
  }
  return items
}

function value(raw: string): HeaderValue | { problem: string } {
  const text = raw.trim()
  if (text === '') return { problem: 'a key with no value' }
  if (text === 'true' || text === 'false') return text === 'true'
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) return { problem: 'a list must open and close on one line' }
    const items = list(text)
    return typeof items === 'string' ? { problem: items } : items
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    const q = quoted(text)
    if (!q || q.rest.trim() !== '') return { problem: 'a quoted value must close at the end of the line' }
    return q.value
  }
  if (/^[{|>&*!]/.test(text)) return { problem: 'only plain values, quoted strings and one-line lists are allowed' }
  return text
}

/** Splits an entry file into its header fields and body. Problems say `line N: …`. */
export function parseEntryFile(text: string): HeaderResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { ok: false, problems: ['line 1: the file must start with a --- header line'] }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end < 0) return { ok: false, problems: ['the header is never closed with a --- line'] }

  const problems: string[] = []
  const fields: Record<string, HeaderValue> = {}
  for (let i = 1; i < end; i++) {
    const line = lines[i]!
    if (!line.trim() || line.trim().startsWith('#')) continue
    if (/^\s/.test(line)) {
      problems.push(`line ${i + 1}: indented lines aren’t allowed (no nesting or multi-line values)`)
      continue
    }
    const m = line.match(KEY)
    if (!m) {
      problems.push(`line ${i + 1}: expected "key: value"`)
      continue
    }
    const key = m[1]!
    if (key in fields) {
      problems.push(`line ${i + 1}: "${key}" is set twice`)
      continue
    }
    const v = value(m[2] ?? '')
    if (typeof v === 'object' && !Array.isArray(v)) problems.push(`line ${i + 1}: ${v.problem}`)
    else fields[key] = v
  }
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, file: { fields, body: lines.slice(end + 1).join('\n').trim() } }
}
