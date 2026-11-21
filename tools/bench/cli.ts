// The scene test bench (director writer §10): plays fixed scenarios through the real turn pipeline and writes
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
//   npm run bench -- --score                       run the AI scorer on the run as it finishes
//   npm run bench -- --pipeline situation          which pipeline makes the turns (default: situation; Milestone 5 adds scene)
//   npm run bench -- --scenario turn.json          also a scenario file from elsewhere (e.g. made by `npm run logs -- to-scenario`)
//   npm run bench -- --compare bench-output/A bench-output/B   side by side, into bench-output/compare-….md; it lists
//                                                  what differs between the runs' inputs, and computes shared metrics
//                                                  only over scenario plays whose inputs match and that ran to the end
//   npm run bench -- --fill bench-output/A         re-play A's stopped plays into A (up to two tries each), on the
//                                                  inputs A recorded: refused if the code, pack, scenarios, prompts,
//                                                  model settings or lore budgets changed since
//
// Scenarios live in the pack's bench/ folder. Each run writes bench-output/<time>-<label>/: run.json (label, pack,
// prompt version, models, options, and its inputs: git commit, pack and scenario fingerprints, role settings without
// keys, display names), report.md, and one session folder per scenario run in the play-log layout
// (session.json, turns.jsonl, calls.jsonl, prompts.jsonl, …), so `npm run logs` reads bench runs and play alike.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { promptVersion, roleModels, type SessionRecord } from '@platform/logs'
import { join, resolve } from 'node:path'
import { isConfigured } from '@llm'
import { existsSync } from 'node:fs'
import { loadPack } from '@platform/packs'
import { benchLoreBudgets, benchSettings, modelsOf, npmSwallowed } from './config'
import { compareRuns, renderReport } from './report'
import { fillProblems, fillRun, mockLlm, readRun, runBench, writeRun, type BenchLlm } from './run'
import { roleSettings, runInputs, sourceRevision, type RunInputs } from './inputs'
import { scoreSession, type Scorer } from '../logs/score'
import { loadScenarios, scenarioFile } from './scenario'
import { bookkeeperLlm, bookkeeperWaitMs, scorerLlm, summaryLlm, turnLlm } from '@platform/roles'
import { isPipeline, PIPELINES, promptSources, type Pipeline } from '@engine/scene'
import { loreBudgets } from '@engine/rules'
import type { Pack } from '@engine/pack'

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
/** With --mock, a scorer that gives every item a 3: proves the scoring path, not the judgment. */
const mockScorer: Scorer = async (prompt) => JSON.stringify({ items: [...prompt.system.matchAll(/^(\d+)\. \[/gm)].map((m) => ({ id: Number(m[1]), score: 3, reason: 'mock' })), beats: [] })

/** The models a run plays with: the mock, or the config's (or BENCH_* env vars') profiles. */
interface Models {
  llm: BenchLlm
  models: Record<string, string>
  sessionModels: SessionRecord['models']
  scorer: Scorer | undefined
  roles: RunInputs['roles']
}

function setUp(mock: boolean, configPath: string, score: boolean): Models {
  if (mock) return { llm: mockLlm(), models: { all: 'mock' }, sessionModels: {}, scorer: mockScorer, roles: {} }
  const settings = benchSettings(configPath, process.env)
  if (!isConfigured(settings.writer)) throw new Error('No model set up for the bench. Create bench.config.json (same shape as the app settings) or set BENCH_BASE_URL and BENCH_MODEL. Or run with --mock.')
  const played = ['director', 'writer', 'bookkeeper', 'summary', ...(score ? (['scorer'] as const) : [])] as const
  return {
    llm: { turn: turnLlm(settings), summarize: summaryLlm(settings), bookkeeper: { call: bookkeeperLlm(settings), waitMs: bookkeeperWaitMs(settings) } },
    models: modelsOf(settings),
    sessionModels: roleModels(settings, [...played]),
    scorer: scorerLlm(settings),
    roles: roleSettings(settings, [...played])
  }
}

/** The pack's scenarios, and any given by path, as `main` and `fill` both read them. */
const scenariosIn = (dir: string) => [...loadScenarios(join(dir, 'bench')), ...args.flatMap((arg, i) => (args[i - 1] === '--scenario' ? [scenarioFile(resolve(arg))] : []))]

/** Scores a run's plays in the given sessions, then rewrites its report. */
async function finish(content: Pack, out: string, scorer: Scorer | undefined, sessions: string[]): Promise<void> {
  if (scorer && sessions.length > 0) {
    console.log('\nScoring…')
    for (const session of sessions) {
      const r = await scoreSession(content, join(out, session), scorer)
      console.log(`  ${session}: scored ${r.scored}, failed ${r.failed}`)
    }
  }
  const bench = readRun(out)
  writeFileSync(join(out, 'report.md'), renderReport(content, bench))
  console.log(`\nReport: ${join(out, 'report.md')}`)
  if (bench.scenarios.some((s) => s.error)) process.exitCode = 1
}

/**
 * `--fill`: re-plays a run's stopped plays into it (Milestone 5 plan, task 0b), so a comparison has the same plays on
 * both sides. Only on the inputs the run recorded; the models are the mock for a mock run, else the config's.
 */
async function fill(out: string): Promise<void> {
  const bench = readRun(out)
  const dir = packDir(option('--pack') ?? bench.pack)
  const content = loadPack(dir)
  const scenarios = scenariosIn(dir).filter((s) => bench.scenarios.some((r) => r.id === s.id))
  // A run made with --no-summaries played its scenarios without them; filling plays them the same way.
  if (!bench.options.summaries) for (const s of scenarios) s.summaries = false
  const mock = bench.models['all'] === 'mock'
  const configPath = option('--config') ?? join(root, 'bench.config.json')
  const m = setUp(mock, configPath, bench.options.score === true)
  const lore = benchLoreBudgets(configPath)
  const source = sourceRevision(root)
  const problems = fillProblems(bench, {
    prompts: promptVersion(promptSources(content, bench.options.pipeline)),
    inputs: runInputs(content, scenarios, { ...(source && { source }), roles: m.roles }),
    loreBudgets: loreBudgets(content.ruleset, lore.budgets)
  })
  if (problems.length > 0) throw new Error(`Can't fill ${out}: ${problems.join('; ')}. Fill a run only on the inputs it was made with, or make a new run.`)
  const stopped = bench.scenarios.filter((s) => s.error).length
  if (stopped === 0) {
    console.log(`Nothing to fill: every play in ${out} ran to the end.`)
    return
  }
  console.log(`Filling ${stopped} stopped ${stopped === 1 ? 'play' : 'plays'} in ${out}`)
  const result = await fillRun(content, bench, scenarios, m.llm, { out, roleModels: m.sessionModels, loreBudgets: lore.budgets, log: (line) => console.log(line) })
  writeRun(out, result.bench)
  console.log(`\nFilled: ${result.filled.length > 0 ? result.filled.join(', ') : 'none'}.`)
  if (result.still.length > 0) console.log(`Still stopped, left out of comparisons on both sides:\n${result.still.map((s) => `  ${s}`).join('\n')}`)
  const replayed = result.bench.scenarios.filter((s, i) => s.session !== bench.scenarios[i]!.session).map((s) => s.session)
  await finish(content, out, bench.options.score ? m.scorer : undefined, replayed)
}

async function main(): Promise<void> {
  const swallowed = npmSwallowed(process.env)
  if (swallowed.length > 0) throw new Error(`npm took ${swallowed.join(', ')} for itself, so the bench never saw ${swallowed.length > 1 ? 'them' : 'it'}. Put -- before the bench's options: npm run bench -- ${swallowed.join(' ')} …`)
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
  const filling = option('--fill')
  if (filling) return fill(resolve(filling))

  const dir = packDir(option('--pack') ?? 'neonpunk-nights')
  const content = loadPack(dir)
  const valued = new Set(['--label', '--config', '--pack', '--repeat', '--scenario', '--pipeline'])
  const wanted = args.filter((arg, i) => !arg.startsWith('--') && !valued.has(args[i - 1] ?? ''))
  const extra = args.flatMap((arg, i) => (args[i - 1] === '--scenario' ? [scenarioFile(resolve(arg))] : []))
  const all = scenariosIn(dir)
  // Scenario files given by path run on their own unless pack scenarios are named too.
  const scenarios = wanted.length > 0 ? [...all.filter((s) => wanted.includes(s.id)), ...extra.filter((s) => !wanted.includes(s.id))] : extra.length > 0 ? extra : all
  const missing = wanted.filter((id) => !all.some((s) => s.id === id))
  if (missing.length > 0) throw new Error(`No such scenario: ${missing.join(', ')}. Known: ${all.map((s) => s.id).join(', ')}`)
  if (flag('--no-summaries')) for (const s of scenarios) s.summaries = false

  const repeat = Number(option('--repeat') ?? 1)
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat needs a whole number of 1 or more')
  const chosen = option('--pipeline')
  if (chosen !== undefined && !isPipeline(chosen)) throw new Error(`--pipeline is one of: ${PIPELINES.join(', ')}`)
  const pipeline: Pipeline | undefined = chosen

  const configPath = option('--config') ?? join(root, 'bench.config.json')
  const { llm, models, sessionModels, scorer, roles } = setUp(flag('--mock'), configPath, flag('--score'))
  // The config's lore budgets apply with --mock too, so budget changes can be checked without a model.
  const lore = benchLoreBudgets(configPath)
  for (const w of lore.warnings) console.log(`Warning: ${w}`)
  const label = option('--label') ?? (flag('--mock') ? 'mock' : 'run')
  const out = join(outRoot, `${stamp()}-${label}`)
  mkdirSync(out, { recursive: true })
  const engine = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version
  const source = sourceRevision(root)
  if (source?.dirty) console.log('Note: the checkout has uncommitted changes; the run records that.')
  const bench = await runBench(content, scenarios, llm, label, models, { repeat, out, engine, roleModels: sessionModels, log: (line) => console.log(line), loreBudgets: lore.budgets, ...(source && { source }), roles, ...(pipeline && { pipeline }) })
  bench.options.score = flag('--score')
  writeRun(out, bench)
  await finish(content, out, flag('--score') ? scorer : undefined, bench.scenarios.map((s) => s.session))
  const stopped = bench.scenarios.filter((s) => s.error).length
  if (stopped > 0) console.log(`${stopped} ${stopped === 1 ? 'play' : 'plays'} stopped; re-play them before comparing: npm run bench -- --fill ${out}`)
}

main().catch((error) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
