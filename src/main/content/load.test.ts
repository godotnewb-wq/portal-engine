import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { characterById, contentProblems, locationById } from '../../shared/game/content'
import { loadContent } from './load'

const DEFAULT = join(__dirname, '../../../content/default')

describe('content/default', () => {
  const content = loadContent(DEFAULT)

  it('has the milestone 1 bar scene: Vex and Brask as companions, Oria Senn with her secret, a bartender walk-on', () => {
    expect(characterById(content, 'vex')?.tier).toBe('companion')
    expect(characterById(content, 'brask')?.tier).toBe('companion')
    const oria = characterById(content, 'oria-senn')!
    expect(oria.tier).toBe('recurring')
    expect(oria.secrets.map((s) => s.id)).toContain('client-is-consortium')
    expect(oria.voice.shifts.lying).toMatch(/darling/)
    const bar = locationById(content, 'sump-lantern')!
    expect(bar.tier).toBe('low-turns')
    expect(bar.walkOns.map((w) => w.id)).toEqual(['bartender'])
    expect(bar.texture.sights.length).toBeGreaterThanOrEqual(3)
  })

  it('describes every character as an adult', () => {
    for (const c of content.characters) expect(c.appearance, c.id).toMatch(/^adult\b/)
    expect(content.player.appearance).toMatch(/^adult\b/)
  })
})

describe('loadContent', () => {
  const folder = () => {
    const root = mkdtempSync(join(tmpdir(), 'npn-content-'))
    mkdirSync(join(root, 'characters'))
    return root
  }

  it('names the file and field when a file does not fit its schema', () => {
    const root = folder()
    writeFileSync(join(root, 'player.json'), JSON.stringify({ name: 'X' }))
    expect(() => loadContent(root)).toThrow(/player\.json: .*species/)
  })

  it('reports problems across files', () => {
    const content = loadContent(DEFAULT)
    const vex = characterById(content, 'vex')!
    const broken = { ...content, characters: [...content.characters, vex, { ...vex, id: 'ghost', relations: [{ to: 'nobody', label: 'x', meters: vex.meters }] }] }
    expect(contentProblems(broken)).toEqual(expect.arrayContaining([
      'character id "vex" is used twice',
      'ghost has a relation to unknown character "nobody"'
    ]))
  })
})
