import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { API } from 'typescript/unstable/sync'
import { SyntaxKind, type Node } from 'typescript/unstable/ast'
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

/**
 * Imports are read by TypeScript's own parser, so every form counts: either quote style, `export … from`, side-effect
 * and dynamic imports, and `import("…")` in a type (milestone 3.6, task 3). TypeScript 7 offers its syntax tree only
 * through `typescript/unstable/*`, which runs the compiler in the background; if an update changes that API, this test
 * fails rather than passing unchecked. The fallback, if it ever becomes unworkable, is es-module-lexer plus a separate
 * check for type-only imports.
 */
const api = new API({ cwd: ROOT })
const program = api.updateSnapshot({ openProjects: [join(ROOT, 'tsconfig.json')] }).getProjects()[0]!.program
afterAll(() => api.close())

/** Whether an import brings in types only: `import type`, every named import marked `type`, or `import("…")` in a type. */
function typeOnly(spec: Node): boolean {
  const at = spec.parent as Node & Record<string, unknown>
  const allTypes = (named: unknown) => {
    const elements = (named as { elements?: readonly { isTypeOnly: boolean }[] } | undefined)?.elements
    return !!elements && elements.length > 0 && elements.every((e) => e.isTypeOnly)
  }
  if (at.kind === SyntaxKind.ImportDeclaration) {
    const clause = at['importClause'] as { phaseModifier?: SyntaxKind; name?: unknown; namedBindings?: unknown } | undefined
    if (!clause) return false
    return clause.phaseModifier === SyntaxKind.TypeKeyword || (!clause.name && allTypes(clause.namedBindings))
  }
  if (at.kind === SyntaxKind.ExportDeclaration) return at['isTypeOnly'] === true || allTypes(at['exportClause'])
  return at.kind === SyntaxKind.LiteralType && at.parent.kind === SyntaxKind.ImportType
}

function importsOf(file: string): Import[] {
  const source = program.getSourceFile(file)
  if (!source) throw new Error(`${rel(file)} is not in the tsconfig.json program, so its imports can't be read`)
  return source.imports.map((spec) => ({ spec: (spec as Node & { text: string }).text, typeOnly: typeOnly(spec) }))
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

// Each rule takes a file and its imports and returns what's wrong, so the import-forms sample can be judged as if it
// sat anywhere in src.
type Rule = (file: string, imports: Import[]) => string[]

const downwardOnly: Rule = (f, imports) =>
  imports.flatMap(({ spec }) => {
    const t = target(f, spec)
    return t.layer && LAYERS.indexOf(t.layer) > LAYERS.indexOf(layerOf(f)) ? [`${rel(f)} imports ${spec}`] : []
  })

const allowedPackages: Rule = (f, imports) => imports.flatMap(({ spec }) => (target(f, spec).external && !ALLOWED_PACKAGES[layerOf(f)](spec) ? [`${rel(f)} imports ${spec}`] : []))

const throughIndex: Rule = (f, imports) =>
  imports.flatMap(({ spec }) => {
    const t = target(f, spec)
    if (spec.startsWith('.') && t.system && t.system !== systemOf(f) && layerOf(f) !== 'app') return [`${rel(f)} reaches into ${spec}`]
    if (/^@(engine|platform)\/[^/]+\/.+/.test(spec)) return [`${rel(f)} imports ${spec} instead of its index`]
    return []
  })

/** The renderer runs in a browser: platform code may reach it only as types. */
const rendererTypesOnly: Rule = (f, imports) =>
  rel(f).startsWith('src/app/renderer/') ? imports.flatMap(({ spec, typeOnly }) => (target(f, spec).layer === 'platform' && !typeOnly ? [`${rel(f)} imports ${spec}`] : [])) : []

/** Every cycle in a graph of systems, each as "a → b → a". */
function cyclesIn(graph: Map<string, Set<string>>): string[] {
  const cycles = new Set<string>()
  const visit = (node: string, path: string[]) => {
    if (path.includes(node)) {
      const loop = path.slice(path.indexOf(node))
      // The same cycle is found from each of its members; name it from its smallest one so it's reported once.
      const start = loop.indexOf([...loop].sort()[0]!)
      const turned = [...loop.slice(start), ...loop.slice(0, start)]
      return void cycles.add([...turned, turned[0]].join(' → '))
    }
    for (const next of graph.get(node) ?? []) visit(next, [...path, node])
  }
  for (const node of graph.keys()) visit(node, [])
  return [...cycles]
}

describe('import rules (architecture §7)', () => {
  const source = code.filter((f) => !isTest(f))
  const broken = (rule: Rule) => source.flatMap((f) => rule(f, importsOf(f)))

  it('every source file is in the program the imports are read from', () => {
    expect(source.filter((f) => !program.getSourceFile(f)).map(rel)).toEqual([])
  })

  it('layers import downward only: llm → engine → platform → app', () => {
    expect(broken(downwardOnly)).toEqual([])
  })

  it('the engine and LLM layers use no Electron, React or Node: only zod', () => {
    expect(broken(allowedPackages)).toEqual([])
  })

  it('systems import each other only through index.ts, and relative imports stay inside their system', () => {
    expect(broken(throughIndex)).toEqual([])
  })

  it('engine and platform systems have no import cycles', () => {
    const graph = new Map<string, Set<string>>()
    for (const f of source.filter((f) => layerOf(f) === 'engine' || layerOf(f) === 'platform')) {
      const from = systemOf(f)
      for (const { spec } of importsOf(f)) {
        const to = target(f, spec).system
        if ((to?.startsWith('engine/') || to?.startsWith('platform/')) && to !== from) graph.set(from, new Set([...(graph.get(from) ?? []), to]))
      }
    }
    expect(graph.size).toBeGreaterThan(5)
    expect(cyclesIn(graph)).toEqual([])
  })

  it('the renderer, which runs in a browser, imports platform code only as types', () => {
    expect(broken(rendererTypesOnly)).toEqual([])
  })
})

describe('the import reader and the rules catch what they should', () => {
  const SAMPLE = join(ROOT, 'tests/architecture/import-forms.ts')
  const sample = importsOf(SAMPLE)
  /** The sample's imports, judged as if the file sat at this path under src. */
  const asIf = (path: string) => join(SRC, path)

  it('reads every import form, in either quote style, and tells type-only imports apart', () => {
    expect(sample).toEqual([
      { spec: '@platform/saves', typeOnly: false },
      { spec: '@engine/pack', typeOnly: true },
      { spec: '@engine/state', typeOnly: true },
      { spec: '@llm', typeOnly: false },
      { spec: '@platform/settings', typeOnly: true },
      { spec: '@engine/core', typeOnly: false },
      { spec: '@engine/scene', typeOnly: false },
      { spec: '@engine/rules', typeOnly: true },
      { spec: '@engine/codex', typeOnly: false },
      { spec: '@platform/logs', typeOnly: true },
      { spec: '@platform/logs', typeOnly: false }
    ])
  })

  it('catches upward imports, type-only ones included, from a file in the engine', () => {
    expect(downwardOnly(asIf('engine/sample/sample.ts'), sample)).toEqual([
      'src/engine/sample/sample.ts imports @platform/saves',
      'src/engine/sample/sample.ts imports @platform/settings',
      'src/engine/sample/sample.ts imports @platform/logs',
      'src/engine/sample/sample.ts imports @platform/logs'
    ])
  })

  it('lets the renderer take platform types but not platform code', () => {
    expect(rendererTypesOnly(asIf('app/renderer/src/sample.ts'), sample)).toEqual([
      'src/app/renderer/src/sample.ts imports @platform/saves',
      'src/app/renderer/src/sample.ts imports @platform/logs'
    ])
  })

  it('catches a package the layer may not use, and a reach past a system index', () => {
    const file = asIf('engine/sample/sample.ts')
    expect(allowedPackages(file, [{ spec: 'node:fs', typeOnly: false }, { spec: 'zod', typeOnly: false }])).toEqual(['src/engine/sample/sample.ts imports node:fs'])
    expect(throughIndex(file, [{ spec: '@engine/scene/plan', typeOnly: false }, { spec: '../other/thing', typeOnly: false }])).toEqual([
      'src/engine/sample/sample.ts imports @engine/scene/plan instead of its index',
      'src/engine/sample/sample.ts reaches into ../other/thing'
    ])
  })

  it('finds a cycle between platform systems once', () => {
    const graph = new Map([
      ['platform/saves', new Set(['platform/logs'])],
      ['platform/logs', new Set(['platform/saves', 'platform/settings'])],
      ['platform/settings', new Set<string>()]
    ])
    expect(cyclesIn(graph)).toEqual(['platform/logs → platform/saves → platform/logs'])
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
