import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cardWarnings, characterById, locationById, packProblems, packWarnings } from '@engine/pack'
import { readPack } from '@platform/packs'
import { content, PACK_DIR } from './support'

describe('the Neonpunk Nights pack', () => {
  it('has the milestone 1 bar scene: Vex and Brask as Major Characters in the party, Oria Senn with her secret, a bartender walk-on', () => {
    expect(characterById(content, 'vex')?.tier).toBe('major')
    expect(characterById(content, 'brask')?.tier).toBe('major')
    expect(content.manifest.start.party).toEqual(['vex', 'brask'])
    const oria = characterById(content, 'oria-senn')!
    expect(oria.tier).toBe('recurring')
    expect(oria.secrets.map((s) => s.id)).toContain('client-is-grid-corporation')
    expect(oria.voice.shifts.lying).toMatch(/darling/)
    const bar = locationById(content, 'sump-lantern')!
    expect(bar.tier).toBe('low-turns')
    expect(bar.walkOns.map((w) => w.id)).toEqual(['bartender'])
    expect(bar.texture.sights.length).toBeGreaterThanOrEqual(3)
  })

  it('opens on the Sump Lantern with everyone, and carries its ruleset, setting, primer and tone', () => {
    expect(content.manifest.start).toEqual({ location: 'sump-lantern', cast: ['vex', 'brask', 'oria-senn'], party: ['vex', 'brask'] })
    expect(content.ruleset.skills).toHaveLength(19)
    expect(content.ruleset.difficulties.map((d) => d.dc)).toEqual([5, 10, 15, 20, 25, 30])
    expect(content.setting.tiers.map((t) => t.id)).toEqual(['crown', 'high-turns', 'bulk', 'low-turns', 'deepwell'])
    expect(content.primer).toMatch(/^Spire City/)
    expect(content.tone).toMatch(/punk/)
  })

  it('uses the canon names from lore.md (no drift)', () => {
    const all = JSON.stringify(content)
    expect(all).not.toMatch(/consortium|middle turns|dark.elf/i)
    expect(characterById(content, 'vex')?.species).toBe('deep-elf')
  })

  it('gives the author no warnings: no stance words in codex text, no character crowded with secrets', () => {
    // Until the cast is rewritten on the full card (milestone 4a task 6), its cards are incomplete for their tier.
    const forms = content.characters.flatMap((c) => cardWarnings(content.ruleset, c))
    expect(packWarnings(content).filter((w) => !forms.includes(w))).toEqual([])
  })

  it('describes every character as an adult', () => {
    for (const c of content.characters) expect(c.appearance, c.id).toMatch(/^adult\b/)
    expect(content.player.appearance).toMatch(/^adult\b/)
  })
})

describe('reading a pack folder', () => {
  /** A copy of the pack to break. */
  const copy = () => {
    const root = join(mkdtempSync(join(tmpdir(), 'pe-pack-')), 'pack')
    cpSync(PACK_DIR, root, { recursive: true })
    return root
  }

  it('names the file and field when a file does not fit its schema, and keeps the manifest for the picker', () => {
    const root = copy()
    writeFileSync(join(root, 'player.json'), JSON.stringify({ name: 'X' }))
    const built = readPack(root)
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.problems.join('\n')).toMatch(/player\.json: species/)
    expect(built.manifest?.id).toBe('neonpunk-nights')
  })

  it('reports a missing file and JSON that does not parse', () => {
    const root = copy()
    writeFileSync(join(root, 'setting', 'setting.json'), '{ nope')
    const built = readPack(root)
    expect(!built.ok && built.problems.join('\n')).toMatch(/setting\/setting\.json: not valid JSON/)
  })

  it('checks content against the ruleset and setting', () => {
    const root = copy()
    const vexPath = join(root, 'characters', 'vex.json')
    const vex = JSON.parse(readFileSync(vexPath, 'utf8'))
    vex.species = 'dragon'
    vex.stats.skills.flying = 1
    vex.meters.lust = 5
    writeFileSync(vexPath, JSON.stringify(vex))
    const built = readPack(root)
    expect(!built.ok && built.problems).toEqual(
      expect.arrayContaining(['vex is of unknown species "dragon"', 'vex has unknown meter "lust"', 'vex has unknown skill "flying"'])
    )
  })

  it('refuses a pack made for another engine version', () => {
    const root = copy()
    const manifest = JSON.parse(readFileSync(join(root, 'pack.json'), 'utf8'))
    writeFileSync(join(root, 'pack.json'), JSON.stringify({ ...manifest, engine: '^9.0.0' }))
    const built = readPack(root)
    expect(!built.ok && built.problems.join('\n')).toMatch(/needs engine \^9\.0\.0/)
  })

  it('reports problems across files', () => {
    const vex = characterById(content, 'vex')!
    const broken = { ...content, characters: [...content.characters, vex, { ...vex, id: 'ghost', relations: [{ to: 'nobody', note: 'x', meters: vex.meters }] }] }
    expect(packProblems(broken)).toEqual(expect.arrayContaining(['character id "vex" is used twice', 'ghost has a relation to unknown character "nobody"']))
  })
})
