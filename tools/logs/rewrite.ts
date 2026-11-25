import type { Pack } from '@engine/pack'
import { currentFlags, type FlagRecord } from '@engine/review'
import { buildSceneWriterPrompt, parseReply, sceneSpeakers, usageOf, writerChecks, type TurnLlm } from '@engine/scene'
import type { Beat } from '@engine/state'
import { replyText, type Prompt } from '@engine/core'
import { promptOf, sections, type SessionLog } from '@platform/logs'
import { scenarioContent, scenarioState } from '../bench/scenario'
import { namer } from './load'
import { toScenario } from './scenario'

/**
 * Writer replay (Milestone 5 task 8, decided 2026-11-24, user): a logged scene turn's writer prompt rebuilt from the
 * current code and pack, over the director's plan as it was played, and only the writer called again. A writing change
 * is read on the same moment several times, for a few writer calls, instead of a scored bench run; the bench stays for
 * checkpoints. The plan is held fixed, so what changes is the writer's doing.
 */

/** The writer call the replay makes: the turn's own, without streaming to anyone. */
export type Write = TurnLlm['write']

export interface Echo {
  /** 1-based beat in the sample. */
  beat: number
  /** The heading of the prompt section the words are shared with ("## Vex", "# The place's details"). */
  section: string
  /** The words both share, as the prompt has them. */
  shared: string[]
}

export interface Sample {
  beats: Beat[]
  /** What the turn's code checks found: in play, these would have spent the turn's rewrite. */
  problems: string[]
  echoes: Echo[]
  gestures: number
  ms: number
  error?: string
}

export interface Replay {
  session: string
  turn: number
  input: string
  /** Why the turn wasn't replayed (it was played on another pipeline), when it wasn't. */
  skipped?: string
  /** Prompt sections that differ from the logged prompt, by heading: what the current code and pack changed. */
  drift: { changed: string[]; gone: string[] }
  /** The logged prompt was sent as it was, not rebuilt: the "before" of a change, on any checkout. */
  asLogged?: boolean
  played: Beat[]
  /** Flags on the played turn: by beat, and `0` for the turn as a whole. */
  flags: Map<number, string[]>
  samples: Sample[]
}

const heading = (section: string): string => {
  const first = section.split('\n', 1)[0]!.trim()
  return first.startsWith('#') ? first : '(no heading)'
}

/** Which sections of the rebuilt prompt aren't in the logged one, and which logged ones are gone. */
export function promptDrift(rebuilt: Prompt, logged: Prompt): Replay['drift'] {
  const parts = (p: Prompt) => [...sections(p.system), ...sections(p.user)]
  const now = parts(rebuilt)
  const was = parts(logged)
  const before = new Set(was)
  const after = new Set(now)
  return { changed: now.filter((s) => !before.has(s)).map(heading), gone: was.filter((s) => !after.has(s)).map(heading) }
}

const STOP = new Set(
  'that this with from they them their there then than have been were what when where which while your yours into onto over just only some more most very much also even back down still about after before again other each such like will would could should does done here know says said tell told make made take took look looks away round around without'.split(' ')
)
/** Content words, roughly stemmed, so "walking" meets "walks" and "knuckles" meets "knuckle". */
const stems = (text: string): Map<string, string> => {
  const out = new Map<string, string>()
  for (const raw of text.toLowerCase().match(/[\p{L}']+/gu) ?? []) {
    const word = raw.replace(/'s$|'/g, '')
    if (word.length < 4 || STOP.has(word)) continue
    out.set(word.replace(/(?:ing|ed|es|s)$/, ''), raw)
  }
  return out
}

/**
 * Beats that share three or more content words with one line of the prompt: a habit, a sample line or a note carried
 * into the prose. A reading aid, not a check: a fact used as asked shares words too. Lines holding the player's words
 * or an earlier beat of the scene are left out, since answering them is the point.
 */
export function echoesOf(beats: Beat[], prompt: Prompt, leaveOut: string[]): Echo[] {
  const lines: Array<{ section: string; words: Map<string, string> }> = []
  for (const part of [...sections(prompt.system), ...sections(prompt.user)]) {
    const section = heading(part)
    if (/the player says or does/i.test(section)) continue
    for (const line of part.split('\n')) {
      if (leaveOut.some((t) => t.length > 0 && line.includes(t))) continue
      lines.push({ section, words: stems(line) })
    }
  }
  const echoes: Echo[] = []
  beats.forEach((beat, i) => {
    const own = stems(beat.text)
    let best: Echo | undefined
    for (const line of lines) {
      const shared = [...own.keys()].filter((w) => line.words.has(w)).map((w) => line.words.get(w)!)
      if (shared.length >= 3 && shared.length > (best?.shared.length ?? 0)) best = { beat: i + 1, section: line.section, shared }
    }
    if (best) echoes.push(best)
  })
  return echoes
}

/**
 * Replays one logged turn's writer `samples` times: on the prompt rebuilt from the current code and pack, or with
 * `asLogged` on the logged prompt itself, so a change's "before" needs no older checkout.
 */
export async function replayTurn(content: Pack, log: SessionLog, n: number, write: Write, samples: number, flags: FlagRecord[] = log.flags, asLogged = false): Promise<Replay> {
  const turn = log.turns[n - 1]
  if (!turn) throw new Error(`${log.session.id} has ${log.turns.length} turns; there is no turn ${n}.`)
  const own = [...currentFlags(flags.filter((f) => f.turnSession === log.session.id && f.turnId === turn.turnId)).values()]
  const byBeat = new Map<number, string[]>()
  for (const f of own) byBeat.set(f.beat ?? 0, [...(byBeat.get(f.beat ?? 0) ?? []), `${f.flag.rating}${f.flag.note ? `: ${f.flag.note}` : ''}`])
  const base: Replay = { session: log.session.id, turn: n, input: turn.input, drift: { changed: [], gone: [] }, played: turn.beats.map((b) => b.beat), flags: byBeat, samples: [] }
  const plan = turn.director.plan
  if (!plan.scene) return { ...base, skipped: `played on the ${turn.director.pipeline ?? 'situation'} pipeline; only scene turns can be replayed` }

  const scenario = toScenario(log, n, flags)
  const played = scenarioContent(content, scenario)
  const state = scenarioState(played, scenario)
  const call = log.calls.get(turn.writer.callId)
  if (asLogged && !call) throw new Error(`${log.session.id} turn ${n}: the logged writer call is missing, so it can't be sent as logged.`)
  const rebuilt = buildSceneWriterPrompt(played, state, plan, turn.input)
  const prompt = asLogged ? promptOf(log, call!) : rebuilt
  const drift = call ? promptDrift(rebuilt, promptOf(log, call)) : { changed: ['(the logged writer call is missing)'], gone: [] }
  const speakers = sceneSpeakers(played, state)
  const check = writerChecks(played, state, plan, turn.input, 'scene')
  const earlier = (state.scene?.turns ?? []).flatMap((t) => t.beats.map((b) => b.text))

  const one = async (): Promise<Sample> => {
    const started = Date.now()
    try {
      const reply = await write(prompt, () => {}, () => {})
      const parsed = parseReply(replyText(reply), speakers, { script: true })
      return {
        beats: parsed.beats,
        problems: check(parsed).map((p) => p.fix),
        echoes: echoesOf(parsed.beats, prompt, earlier),
        gestures: usageOf(played, parsed.beats).gestures.length,
        ms: Date.now() - started
      }
    } catch (error) {
      return { beats: [], problems: [], echoes: [], gestures: 0, ms: Date.now() - started, error: (error as Error).message }
    }
  }
  return { ...base, drift, ...(asLogged && { asLogged }), samples: await Promise.all(Array.from({ length: samples }, one)) }
}

/** The turns a replay takes from a session when none is named: its scene turns that carry a flag. */
export function flaggedTurns(log: SessionLog, flags: FlagRecord[] = log.flags): number[] {
  const flagged = new Set([...currentFlags(flags.filter((f) => f.turnSession === log.session.id)).values()].map((f) => f.turnId))
  return log.turns.filter((t) => flagged.has(t.turnId)).map((t) => t.turn)
}

export function renderReplays(content: Pack, replays: Replay[], header: { label?: string; model: string }): string {
  const nameOf = namer(content)
  const line = (b: Beat) => (b.kind === 'dialogue' ? `${nameOf(b.speaker)}: "${b.text}"` : `*${b.text}*`)
  const out = [`# Writer replay${header.label ? `: ${header.label}` : ''}`, '', `Writer: ${header.model}. Each sample is the writer's draft for the logged plan, before any rewrite.`, '']
  const done = replays.filter((r) => !r.skipped)
  if (done.length > 0) {
    out.push('| Turn | Sample | Beats | Narration | Gestures | Echoes | Would rewrite | Time |', '|---|---|---|---|---|---|---|---|')
    for (const r of done) {
      const narr = r.played.filter((b) => b.kind === 'narration').length
      out.push(`| ${r.session} t${r.turn} | as played | ${r.played.length} | ${narr} | | | | |`)
      r.samples.forEach((s, i) =>
        out.push(s.error ? `| | ${i + 1} | failed | | | | | ${(s.ms / 1000).toFixed(1)} s |` : `| | ${i + 1} | ${s.beats.length} | ${s.beats.filter((b) => b.kind === 'narration').length} | ${s.gestures} | ${s.echoes.length} | ${s.problems.length} | ${(s.ms / 1000).toFixed(1)} s |`)
      )
    }
    out.push('')
  }
  for (const r of replays) {
    out.push(`## ${r.session}, turn ${r.turn}`, '', `> ${r.input}`, '')
    if (r.skipped) {
      out.push(`Not replayed: ${r.skipped}.`, '')
      continue
    }
    const { changed, gone } = r.drift
    if (r.asLogged) out.push(`Prompt: sent as logged.${changed.length + gone.length > 0 ? ` The current code and pack would change: ${[...new Set([...changed, ...gone])].join(', ')}.` : ''}`, '')
    else out.push(
      changed.length + gone.length === 0
        ? 'Prompt: the same as the one logged.'
        : `Prompt: rebuilt from the current code and pack; ${[changed.length > 0 && `changed or new: ${changed.join(', ')}`, gone.length > 0 && `gone: ${gone.join(', ')}`].filter(Boolean).join('; ')}.`,
      ''
    )
    out.push('### As played', '')
    for (const note of r.flags.get(0) ?? []) out.push(`⚑ the turn: ${note}`)
    r.played.forEach((b, i) => out.push(`${i + 1}. ${line(b)}${(r.flags.get(i + 1) ?? []).map((n) => `  ⚑ ${n}`).join('')}`))
    out.push('')
    r.samples.forEach((s, k) => {
      out.push(`### Sample ${k + 1} (${(s.ms / 1000).toFixed(1)} s)`, '')
      if (s.error) {
        out.push(`The call failed: ${s.error}`, '')
        return
      }
      s.beats.forEach((b, i) => out.push(`${i + 1}. ${line(b)}`))
      out.push('')
      for (const e of s.echoes) out.push(`- Beat ${e.beat} shares ${e.shared.map((w) => `"${w}"`).join(', ')} with ${e.section}`)
      for (const p of s.problems) out.push(`- Would be sent back: ${p}`)
      if (s.echoes.length + s.problems.length > 0) out.push('')
    })
  }
  return out.join('\n')
}
