import { describe, expect, it } from 'vitest'
import { parseEntryFile } from './header'

describe('parseEntryFile (the YAML subset)', () => {
  it('reads plain values, quoted strings, one-line lists and booleans, and keeps the body as the full text', () => {
    const r = parseEntryFile(['---', 'name: Ada’s Rest', 'keywords: [rest, "Ada, the inn", \'old inn\']', 'source: "Places > Ada: the inn"', 'belief: true', '# a comment', '', '---', '', 'The inn by the bridge.', ''].join('\n'))
    expect(r.ok && r.file).toEqual({ fields: { name: 'Ada’s Rest', keywords: ['rest', 'Ada, the inn', 'old inn'], source: 'Places > Ada: the inn', belief: true }, body: 'The inn by the bridge.' })
  })

  it('reads an empty list', () => {
    const r = parseEntryFile('---\nalso: []\n---\nText')
    expect(r.ok && r.file.fields['also']).toEqual([])
  })

  it('names the line of anything outside the subset', () => {
    const r = parseEntryFile(['---', 'name: Ada', 'keywords:', '  - nested', 'list: [a, [b]]', 'name: again', 'tags: {a: b}', 'just words', 'summary: "never closed', '---', 'Body'].join('\n'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.problems).toEqual([
      'line 3: a key with no value',
      'line 4: indented lines aren’t allowed (no nesting or multi-line values)',
      'line 5: lists can’t be nested',
      'line 6: "name" is set twice',
      'line 7: only plain values, quoted strings and one-line lists are allowed',
      'line 8: expected "key: value"',
      'line 9: a quoted value must close at the end of the line'
    ])
  })

  it('needs a header opened and closed with ---', () => {
    expect(parseEntryFile('name: Ada\n').ok).toBe(false)
    expect(parseEntryFile('---\nname: Ada\n')).toEqual({ ok: false, problems: ['the header is never closed with a --- line'] })
  })
})
