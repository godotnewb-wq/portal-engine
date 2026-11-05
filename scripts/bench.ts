// The scene test bench (narrator-scene-engine §10): plays fixed scenarios through the real turn pipeline and writes
// what happened, so prompt and model changes can be compared side by side.
//
//   npm run bench                                  every scenario, models from bench.config.json or BENCH_* env vars
//   npm run bench -- deception-caught tense-negotiation   only these
//   npm run bench -- --label new-style-guide       name the run (its folder and report title)
//   npm run bench -- --mock                        no LLM: checks the harness, not the prose
//   npm run bench -- --no-summaries                skip the end-of-scene summaries
//   npm run bench -- --compare bench-output/A bench-output/B   side by side, into bench-output/compare-….md
//
// Each run writes bench-output/<time>-<label>/run.json (everything, prompts and raw replies included) and report.md.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isConfigured } from '../src/shared/settings'
import { loadContent } from '../src/main/content/load'
import { benchSettings, modelsOf } from '../src/main/bench/config'
import { compareRuns, renderReport } from '../src/main/bench/report'
import { mockLlm, runBench, type BenchLlm, type BenchRun } from '../src/main/bench/run'
import { loadScenarios } from '../src/main/bench/scenario'
import { summaryLlm, turnLlm } from '../src/main/scene/llm'

const root = resolve(__dirname, '..')
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const content = loadContent(join(root, 'content/default'))
const outRoot = join(root, 'bench-output')

async function main(): Promise<void> {
  const compare = args.indexOf('--compare')
  if (compare >= 0) {
    const [a, b] = args.slice(compare + 1, compare + 3)
    if (!a || !b) throw new Error('--compare needs two run folders')
    const read = (dir: string): BenchRun => JSON.parse(readFileSync(join(resolve(dir), 'run.json'), 'utf8'))
    mkdirSync(outRoot, { recursive: true })
    const path = join(outRoot, `compare-${stamp()}.md`)
    writeFileSync(path, compareRuns(content, read(a), read(b)))
    console.log(`Comparison written to ${path}`)
    return
  }

  const valued = new Set(['--label', '--config'])
  const wanted = args.filter((arg, i) => !arg.startsWith('--') && !valued.has(args[i - 1] ?? ''))
  const all = loadScenarios(join(root, 'bench/scenarios'))
  const scenarios = wanted.length > 0 ? all.filter((s) => wanted.includes(s.id)) : all
  const missing = wanted.filter((id) => !all.some((s) => s.id === id))
  if (missing.length > 0) throw new Error(`No such scenario: ${missing.join(', ')}. Known: ${all.map((s) => s.id).join(', ')}`)
  if (flag('--no-summaries')) for (const s of scenarios) s.summaries = false

  let llm: BenchLlm
  let models: Record<string, string>
  if (flag('--mock')) {
    llm = mockLlm()
    models = { all: 'mock' }
  } else {
    const settings = benchSettings(option('--config') ?? join(root, 'bench.config.json'), process.env)
    if (!isConfigured(settings.writer)) throw new Error('No model set up for the bench. Create bench.config.json (same shape as the app settings) or set BENCH_BASE_URL and BENCH_MODEL. Or run with --mock.')
    llm = { turn: turnLlm(settings, false), summarize: summaryLlm(settings, false) }
    models = modelsOf(settings)
  }

  const label = option('--label') ?? (flag('--mock') ? 'mock' : 'run')
  const bench = await runBench(content, scenarios, llm, label, models, (line) => console.log(line))
  const dir = join(outRoot, `${stamp()}-${label}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'run.json'), JSON.stringify(bench, null, 2))
  writeFileSync(join(dir, 'report.md'), renderReport(content, bench))
  console.log(`\nReport: ${join(dir, 'report.md')}`)
  if (bench.scenarios.some((s) => s.error)) process.exitCode = 1
}

main().catch((error) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
