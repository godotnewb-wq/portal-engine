// The scene test bench (narrator-scene-engine §10): plays fixed scenarios through the real turn pipeline and writes
// what happened, so prompt and model changes can be compared side by side.
//
//   npm run bench                                  every scenario of the default pack (neonpunk-nights), models from
//                                                  bench.config.json or BENCH_* env vars
//   npm run bench -- --pack test-fixture           another pack: a pack id in packs/, or a path to a pack folder
//   npm run bench -- deception-caught tense-negotiation   only these
//   npm run bench -- --label new-style-guide       name the run (its folder and report title)
//   npm run bench -- --mock                        no LLM: checks the harness, not the prose
//   npm run bench -- --no-summaries                skip the end-of-scene summaries
//   npm run bench -- --repeat 10                   play each scenario 10 times with different seeds
//   npm run bench -- --compare bench-output/A bench-output/B   side by side, into bench-output/compare-….md
//
// Scenarios live in the pack's bench/ folder. Each run writes bench-output/<time>-<label>/: run.json (label, pack,
// prompt version, models, options), report.md, and one session folder per scenario run in the play-log layout
// (session.json, turns.jsonl, calls.jsonl, prompts.jsonl, …), so `npm run logs` reads bench runs and play alike.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { roleModels } from '@platform/logs'
import { join, resolve } from 'node:path'
import { isConfigured } from '@llm'
import { existsSync } from 'node:fs'
import { loadPack } from '@platform/packs'
import { benchSettings, modelsOf } from './config'
import { compareRuns, renderReport } from './report'
import { mockLlm, readRun, runBench, writeRun, type BenchLlm } from './run'
import { loadScenarios } from './scenario'
import { summaryLlm, turnLlm } from '@platform/roles'

const root = resolve(__dirname, '../..')
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
/** A pack id in the repository's packs/ folder, or a path to any pack folder. */
const packDir = (idOrPath: string): string => (existsSync(join(idOrPath, 'pack.json')) ? resolve(idOrPath) : join(root, 'packs', idOrPath))
const outRoot = join(root, 'bench-output')

async function main(): Promise<void> {
  const compare = args.indexOf('--compare')
  if (compare >= 0) {
    const [a, b] = args.slice(compare + 1, compare + 3)
    if (!a || !b) throw new Error('--compare needs two run folders')
    const [runA, runB] = [readRun(resolve(a)), readRun(resolve(b))]
    mkdirSync(outRoot, { recursive: true })
    const path = join(outRoot, `compare-${stamp()}.md`)
    writeFileSync(path, compareRuns(loadPack(packDir(runA.pack)), runA, runB))
    console.log(`Comparison written to ${path}`)
    return
  }

  const dir = packDir(option('--pack') ?? 'neonpunk-nights')
  const content = loadPack(dir)
  const valued = new Set(['--label', '--config', '--pack', '--repeat'])
  const wanted = args.filter((arg, i) => !arg.startsWith('--') && !valued.has(args[i - 1] ?? ''))
  const all = loadScenarios(join(dir, 'bench'))
  const scenarios = wanted.length > 0 ? all.filter((s) => wanted.includes(s.id)) : all
  const missing = wanted.filter((id) => !all.some((s) => s.id === id))
  if (missing.length > 0) throw new Error(`No such scenario: ${missing.join(', ')}. Known: ${all.map((s) => s.id).join(', ')}`)
  if (flag('--no-summaries')) for (const s of scenarios) s.summaries = false

  const repeat = Number(option('--repeat') ?? 1)
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat needs a whole number of 1 or more')

  let llm: BenchLlm
  let models: Record<string, string>
  let sessionModels = {}
  if (flag('--mock')) {
    llm = mockLlm()
    models = { all: 'mock' }
  } else {
    const settings = benchSettings(option('--config') ?? join(root, 'bench.config.json'), process.env)
    if (!isConfigured(settings.writer)) throw new Error('No model set up for the bench. Create bench.config.json (same shape as the app settings) or set BENCH_BASE_URL and BENCH_MODEL. Or run with --mock.')
    llm = { turn: turnLlm(settings, false), summarize: summaryLlm(settings, false) }
    models = modelsOf(settings)
    sessionModels = roleModels(settings)
  }

  const label = option('--label') ?? (flag('--mock') ? 'mock' : 'run')
  const out = join(outRoot, `${stamp()}-${label}`)
  mkdirSync(out, { recursive: true })
  const engine = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version
  const bench = await runBench(content, scenarios, llm, label, models, { repeat, out, engine, roleModels: sessionModels, log: (line) => console.log(line) })
  writeRun(out, bench)
  writeFileSync(join(out, 'report.md'), renderReport(content, bench))
  console.log(`\nReport: ${join(out, 'report.md')}`)
  if (bench.scenarios.some((s) => s.error)) process.exitCode = 1
}

main().catch((error) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
