// Tools for play logs and bench runs (milestone 2, A4). Every command takes a session folder, or a folder of them (a
// pack's logs folder, a bench run, bench-output/), and joins the session's files by id.
//
//   npm run logs -- transcript <session> [--out file.md]       readable transcript, flags and AI scores inline
//   npm run logs -- flags <paths…> [--rating bad] [--reason voice] [--speaker vex] [--ai]
//   npm run logs -- stats <paths…>                              the B2 metrics, per session and in total
//   npm run logs -- blind <session> [--count 10] [--seed 1] [--key key.md]
//   npm run logs -- to-scenario <session> --turn N [--out file.json]
//   npm run logs -- show <session> --turn N                     one turn in full, prompts and raw replies
//   npm run logs -- score <paths…> [--config bench.config.json] AI-score turns not yet scored by this scorer version
//   npm run logs -- flag <session> --turn N [--beat n] --rating bad [--reason voice,generic] [--note "…"]
//                                                               flag a beat or turn of a bench run (play is flagged in the app)
//
// Output goes to stdout unless --out names a file. --pack <id or folder> when a session's pack isn't in packs/.

import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isConfigured } from '@llm'
import { FlagSchema, RATINGS, type Rating } from '@engine/review'
import { LogSession } from '@platform/logs'
import { scorerLlm } from '@platform/roles'
import { benchSettings } from '../bench/config'
import { flagsFor, metricInput, namer, packFor, sessionsAt } from './load'
import { metrics, renderMetrics } from './metrics'
import { blindTest, renderFlags } from './review'
import { toScenario } from './scenario'
import { scoreSession } from './score'
import { renderTurn } from './show'
import { renderTranscript } from './transcript'

const ROOT = resolve(__dirname, '../..')
const [command, ...args] = process.argv.slice(2)
const VALUED = new Set(['--out', '--rating', '--reason', '--speaker', '--count', '--seed', '--key', '--turn', '--pack', '--config', '--beat', '--note'])
const option = (name: string) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const flag = (name: string) => args.includes(name)
const paths = args.filter((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1] ?? ''))

function emit(text: string): void {
  const out = option('--out')
  if (out) {
    writeFileSync(out, text)
    console.log(`Written to ${resolve(out)}`)
  } else process.stdout.write(`${text}\n`)
}

function one() {
  const logs = sessionsAt(paths)
  if (logs.length !== 1) throw new Error(`Give one session folder; ${paths.join(', ')} holds ${logs.length}.`)
  return logs[0]!
}
const turnNumber = () => {
  const n = Number(option('--turn'))
  if (!Number.isInteger(n) || n < 1) throw new Error('--turn needs a turn number (1 is the first turn of the session)')
  return n
}

async function main(): Promise<void> {
  switch (command) {
    case 'transcript': {
      const log = one()
      emit(renderTranscript(packFor(log, option('--pack')), log, flagsFor(log)))
      return
    }
    case 'flags': {
      const logs = sessionsAt(paths)
      const rating = option('--rating')
      if (rating && !RATINGS.includes(rating as Rating)) throw new Error(`--rating is one of ${RATINGS.join(', ')}`)
      const content = packFor(logs[0]!, option('--pack'))
      emit(renderFlags(content, logs.map((log) => ({ log, flags: flagsFor(log, logs.filter((l) => l !== log)) })), { ...(rating && { rating: rating as Rating }), ...(option('--reason') && { reason: option('--reason') }), ...(option('--speaker') && { speaker: option('--speaker') }), ai: flag('--ai') }))
      return
    }
    case 'stats': {
      const logs = sessionsAt(paths)
      const nameOf = namer(packFor(logs[0]!, option('--pack')))
      const inputs = logs.map((log) => metricInput(log))
      const parts = [`# Stats (${logs.length} session${logs.length === 1 ? '' : 's'})`, '']
      if (logs.length > 1) parts.push('## All sessions', '', renderMetrics(metrics(inputs), nameOf), '')
      logs.forEach((log, i) => parts.push(`## \`${log.session.id}\``, '', renderMetrics(metrics([inputs[i]!]), nameOf), ''))
      emit(parts.join('\n'))
      return
    }
    case 'blind': {
      const log = one()
      const { test, key } = blindTest(packFor(log, option('--pack')), log, Number(option('--count') ?? 10), Number(option('--seed') ?? 1))
      // The key never goes where the test does.
      const keyPath = resolve(option('--key') ?? `blind-key-${log.session.id}.md`)
      writeFileSync(keyPath, key)
      emit(test)
      console.error(`Answer key: ${keyPath}`)
      return
    }
    case 'to-scenario': {
      const log = one()
      emit(JSON.stringify(toScenario(log, turnNumber(), flagsFor(log)), null, 2))
      if (option('--out')) console.log(`Replay it with: npm run bench -- --pack ${log.session.pack.id} --scenario ${option('--out')}`)
      return
    }
    case 'show': {
      const log = one()
      emit(renderTurn(packFor(log, option('--pack')), log, turnNumber()))
      return
    }
    case 'score': {
      const logs = sessionsAt(paths)
      const settings = benchSettings(option('--config') ?? join(ROOT, 'bench.config.json'), process.env)
      if (!isConfigured(settings.scorer) && !isConfigured(settings.summary) && !isConfigured(settings.writer)) {
        throw new Error('No model for the scorer. Set "scorer" (or "summary", or "writer") in bench.config.json, or BENCH_SCORER_MODEL with BENCH_BASE_URL.')
      }
      const scorer = scorerLlm(settings)
      for (const log of logs) {
        console.log(`▸ ${log.session.id}`)
        const r = await scoreSession(packFor(log, option('--pack')), log.dir, scorer, { log: (l) => console.log(l) })
        console.log(`  scored ${r.scored}, already scored ${r.skipped}, failed ${r.failed}`)
      }
      return
    }
    case 'flag': {
      const log = one()
      const turn = log.turns[turnNumber() - 1]
      if (!turn) throw new Error(`No turn ${option('--turn')} in ${log.session.id}`)
      const beatN = option('--beat') ? Number(option('--beat')) : undefined
      const beat = beatN !== undefined ? turn.beats.find((b) => b.index === beatN) : undefined
      if (beatN !== undefined && !beat) throw new Error(`Turn ${turn.turn} has ${turn.beats.length} beats.`)
      const given = flag('--clear') ? null : FlagSchema.parse({ rating: option('--rating'), reasons: (option('--reason') ?? '').split(',').map((r) => r.trim()).filter(Boolean), note: option('--note') ?? '' })
      LogSession.resume(log.dir).flag({
        session: log.session.id,
        turnSession: log.session.id,
        turnId: turn.turnId,
        ...(beat && { beat: beat.index, text: beat.beat.text, ...(beat.beat.kind === 'dialogue' && { speaker: beat.beat.speaker }) }),
        flag: given,
        at: new Date().toISOString()
      })
      console.log(`${given ? `Flagged ${given.rating}` : 'Cleared'}: ${log.session.id} turn ${turn.turn}${beat ? ` beat ${beat.index}` : ''}`)
      return
    }
    default:
      throw new Error(`Unknown command "${command ?? ''}". Commands: transcript, flags, stats, blind, to-scenario, show, score, flag. See tools/logs/README.md.`)
  }
}

main().catch((error) => {
  console.error((error as Error).message)
  process.exitCode = 1
})
