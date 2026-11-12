import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPack } from '@platform/packs'

/**
 * The boundaries in architecture.md §7, checked on every test run. A small check of our own instead of
 * dependency-cruiser: the rules are few and this needs no extra dependency.
 */

const ROOT = resolve(__dirname, '..')
const SRC = join(ROOT, 'src')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}
const code = files(SRC).filter((f) => /\.tsx?$/.test(f))
const isTest = (f: string) => /\.test\.tsx?$/.test(f)
const rel = (f: string) => relative(ROOT, f).replaceAll('\\', '/')

const LAYERS = ['llm', 'engine', 'platform', 'app'] as const
type Layer = (typeof LAYERS)[number]
const layerOf = (path: string): Layer => rel(path).split('/')[1] as Layer
/** The system a file belongs to: engine/scene, platform/saves, llm, app. */
const systemOf = (path: string): string => {
  const [, layer, system] = rel(path).split('/')
  return layer === 'engine' || layer === 'platform' ? `${layer}/${system}` : layer!
}

interface Import {
  spec: string
  typeOnly: boolean
}
function importsOf(file: string): Import[] {
  const source = readFileSync(file, 'utf8')
  const found: Import[] = []
  for (const m of source.matchAll(/^\s*(import|export)(\s+type)?[\s\S]*?from\s+'([^']+)'/gm)) found.push({ spec: m[3]!, typeOnly: !!m[2] })
  for (const m of source.matchAll(/^\s*import\s+'([^']+)'/gm)) found.push({ spec: m[1]!, typeOnly: false })
  for (const m of source.matchAll(/import\('([^']+)'\)/g)) found.push({ spec: m[1]!, typeOnly: false })
  return found
}

/** Where an import points: a layer and system inside src, or an outside package. */
function target(file: string, spec: string): { layer?: Layer; system?: string; path?: string; external?: string } {
  if (spec === '@llm') return { layer: 'llm', system: 'llm' }
  const alias = spec.match(/^@(engine|platform|app)\/(.+)$/)
  if (alias) {
    const path = join(SRC, alias[1]!, alias[2]!)
    return { layer: alias[1] as Layer, system: alias[1] === 'app' ? 'app' : `${alias[1]}/${alias[2]!.split('/')[0]}`, path }
  }
  if (spec.startsWith('.')) {
    const path = resolve(dirname(file), spec)
    if (!path.startsWith(SRC)) return { external: spec }
    return { layer: layerOf(path), system: systemOf(path), path }
  }
  return { external: spec }
}

const ALLOWED_PACKAGES: Record<Layer, (spec: string) => boolean> = {
  // The engine and the LLM client are pure TypeScript: they run in Electron, the bench, tests and a browser alike.
  llm: (s) => s === 'zod',
  engine: (s) => s === 'zod',
  platform: (s) => s === 'zod' || s.startsWith('node:') || s === 'electron',
  app: () => true
}

describe('import rules (architecture §7)', () => {
  const source = code.filter((f) => !isTest(f))

  it('layers import downward only: llm → engine → platform → app', () => {
    const wrong = source.flatMap((f) =>
      importsOf(f).flatMap(({ spec }) => {
        const t = target(f, spec)
        return t.layer && LAYERS.indexOf(t.layer) > LAYERS.indexOf(layerOf(f)) ? [`${rel(f)} imports ${spec}`] : []
      })
    )
    expect(wrong).toEqual([])
  })

  it('the engine and LLM layers use no Electron, React or Node: only zod', () => {
    const wrong = source.flatMap((f) => importsOf(f).flatMap(({ spec }) => (target(f, spec).external && !ALLOWED_PACKAGES[layerOf(f)](spec) ? [`${rel(f)} imports ${spec}`] : [])))
    expect(wrong).toEqual([])
  })

  it('systems import each other only through index.ts, and relative imports stay inside their system', () => {
    const wrong = source.flatMap((f) =>
      importsOf(f).flatMap(({ spec }) => {
        const t = target(f, spec)
        if (spec.startsWith('.') && t.system && t.system !== systemOf(f) && layerOf(f) !== 'app') return [`${rel(f)} reaches into ${spec}`]
        if (/^@(engine|platform)\/[^/]+\/.+/.test(spec)) return [`${rel(f)} imports ${spec} instead of its index`]
        return []
      })
    )
    expect(wrong).toEqual([])
  })

  it('engine systems have no import cycles', () => {
    const graph = new Map<string, Set<string>>()
    for (const f of source.filter((f) => layerOf(f) === 'engine')) {
      const from = systemOf(f)
      for (const { spec } of importsOf(f)) {
        const to = target(f, spec).system
        if (to?.startsWith('engine/') && to !== from) graph.set(from, new Set([...(graph.get(from) ?? []), to]))
      }
    }
    const cycles: string[] = []
    const visit = (node: string, path: string[]) => {
      if (path.includes(node)) return void cycles.push([...path.slice(path.indexOf(node)), node].join(' → '))
      for (const next of graph.get(node) ?? []) visit(next, [...path, node])
    }
    for (const node of graph.keys()) visit(node, [])
    expect(cycles).toEqual([])
  })

  it('the renderer, which runs in a browser, imports platform code only as types', () => {
    const renderer = source.filter((f) => rel(f).startsWith('src/app/renderer/'))
    const wrong = renderer.flatMap((f) => importsOf(f).flatMap(({ spec, typeOnly }) => (target(f, spec).layer === 'platform' && !typeOnly ? [`${rel(f)} imports ${spec}`] : [])))
    expect(wrong).toEqual([])
  })
})

/** A pack's proper nouns: names a world gives things, which only that pack should contain. */
function properNouns(dir: string): string[] {
  const pack = loadPack(dir)
  const strip = (name: string) => name.replace(/^The\s+/, '')
  const names = [
    pack.manifest.name,
    pack.manifest.ui.title ?? '',
    pack.setting.name,
    pack.setting.world ?? '',
    ...pack.setting.tiers.map((t) => strip(t.name)),
    ...pack.setting.factions.map((f) => strip(f.name)),
    ...pack.locations.flatMap((l) => [strip(l.name), ...l.walkOns.flatMap((w) => (w.name ? [w.name] : []))]),
    ...pack.characters.flatMap((c) => [c.name, c.name.split(' ')[0]!]),
    // Codex entries' in-world names (not descriptive titles like "How the tallies work").
    ...pack.codex.flatMap((e) => [...(e.label ? [strip(e.label)] : []), ...e.aliases.map(strip)]),
    pack.player.name
  ]
  return [...new Set(names.filter((n) => n.length > 2))]
}

describe('no world words in engine code (architecture §7)', () => {
  const packs = readdirSync(join(ROOT, 'packs')).filter((id) => statSync(join(ROOT, 'packs', id)).isDirectory())
  const everything = files(SRC)

  /** Files under src that name any of the words, as "file: word". */
  const hits = (words: string[], which: string[]) =>
    which.flatMap((f) => {
      const text = readFileSync(f, 'utf8')
      return words.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)).map((w) => `${rel(f)}: ${w}`)
    })

  it('src/ names nothing from any game pack', () => {
    const words = packs.filter((id) => id !== 'test-fixture').flatMap((id) => properNouns(join(ROOT, 'packs', id)))
    expect(words.length).toBeGreaterThan(10)
    expect(hits(words, everything)).toEqual([])
  })

  it('and the test fixture’s names appear only in tests', () => {
    expect(hits(properNouns(join(ROOT, 'packs', 'test-fixture')), everything.filter((f) => !isTest(f)))).toEqual([])
  })
})
