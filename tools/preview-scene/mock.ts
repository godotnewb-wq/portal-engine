/// <reference types="vite/client" />
// The renderer with a mock window.api: real content and the real turn pipeline, but a scripted director and writer
// that stream with delays. Build with `npx vite build --config scripts/preview-scene/vite.config.ts`.
import { SettingsSchema, toView } from '@llm'
import { buildPack, type Pack, type PackFiles } from '@engine/pack'
import type { PackListing } from '@platform/packs'
import { mockLlm } from '../bench/mock'
import type { GameState } from '@engine/state'
import type { RendererApi, SceneEvent } from '@app/ipc'
import { bookkeep, runTurn, type TurnLlm } from '@engine/scene'
import type { CallTrace } from '@engine/core'
import { endScene, judgeScene } from '@engine/relationships'
import { currentFlags, type FlagRecord } from '@engine/review'
import type { CallSummary, SceneEndDetails, TurnDetails } from '@platform/logs'
import { cleanLoreBudgets, type LoreBudgetOverrides } from '@engine/rules'
// Every pack in packs/, as Vite bundles them: JSON parsed, Markdown as text.
const json = import.meta.glob('../../packs/*/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>
const text = import.meta.glob('../../packs/*/**/*.md', { eager: true, import: 'default', query: '?raw' }) as Record<string, string>

/** One pack's files from the bundled globs, the same shape platform/packs reads from disk. */
function packFiles(id: string): PackFiles {
  const at = (path: string) => `../../packs/${id}/${path}`
  const folder = (sub: string) =>
    Object.entries(json)
      .filter(([path]) => path.startsWith(at(`${sub}/`)))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, data]) => ({ file: path.slice(at(`${sub}/`).length), data }))
  return {
    manifest: json[at('pack.json')],
    ruleset: json[at('ruleset/ruleset.json')],
    setting: json[at('setting/setting.json')],
    primer: text[at('setting/primer.md')] ?? '',
    tone: text[at('setting/tone.md')] ?? '',
    phrases: json[at('setting/phrases.json')],
    player: json[at('player.json')],
    characters: folder('characters'),
    locations: folder('locations'),
    codex: Object.entries(text)
      .filter(([path]) => path.startsWith(at('codex/')))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, body]) => ({ path: path.slice(at('codex/').length), text: body }))
  }
}

const covers = import.meta.glob('../../packs/*/cover.png', { eager: true, import: 'default', query: '?url' }) as Record<string, string>

// The packs the preview's picker lists: every bundled pack, and a deliberately broken copy of one so the picker's
// "can't be played" state can be looked at.
const ids = [...new Set(Object.keys(json).map((path) => path.split('/')[3]!))].sort()
const brokenFiles = { ...packFiles('test-fixture'), player: { name: 'Nobody' }, manifest: { ...(json['../../packs/test-fixture/pack.json'] as object), id: 'broken-example', name: 'Broken Example' } }
const found = [
  ...ids.map((id) => ({ key: `packs/${id}`, built: buildPack(packFiles(id)), cover: covers[`../../packs/${id}/cover.png`] })),
  { key: 'packs/broken-example', built: buildPack(brokenFiles), cover: undefined }
]
const listings: PackListing[] = found.map(({ key, built, cover }) => {
  const manifest = built.ok ? built.pack.manifest : built.manifest
  return { key, source: 'bundled', ...(manifest && { manifest }), ok: built.ok, problems: built.ok ? [] : built.problems, duplicate: false, ...(cover && { cover }) }
})
let content: Pack

const PLAN = JSON.stringify({
  speakers: [
    { id: 'oria', intent: 'Deflect; claim a private collector.', mood: 'composed, slightly too polished', hiding: 'client is the consortium', approach: 'lie' },
    { id: 'vex', intent: 'Call out the lie if she catches it.', mood: 'wary', depends_on_check: 'vex_empathy' }
  ],
  reactions: [{ id: 'brask', beat: 'fidgets with his glass, ears flat' }],
  checks: [{ id: 'vex_empathy', who: 'vex', skill: 'empathy', difficulty: 'moderate', stakes: 'notices Oria is lying' }]
})

const WRITTEN = `NARRATION: Water ticks from the cooled pipe overhead onto the table edge, inches from your hand. Oria doesn't move her glass out of its way.
Oria: "A private collector, darling. Discreet, generous, and entirely uninterested in being named. I'm sure you understand."
NARRATION: At the next table someone slaps down a losing hand. Beside you, Brask flinches and turns his glass in a slow circle, ears flat.
Vex: "'Darling.' She only says that when she's lying."
[Vex: EXPRESSION smirk]
[Oria: EXPRESSION polite]
[Brask: COMFORT 2 too loud, doesn't like her]
`

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const listeners = new Set<(e: SceneEvent) => void>()
const emit = (e: SceneEvent) => listeners.forEach((l) => l(e))

// The scripted turn fits the Sump Lantern scene; any other pack gets the bench's generic mock.
const scripted: TurnLlm = {
  async direct() {
    await wait(300)
    return PLAN
  },
  async write(_prompt, onDelta) {
    for (const piece of WRITTEN.match(/[\s\S]{1,12}/g)!) {
      await wait(25)
      onDelta(piece)
    }
    return WRITTEN
  }
}

// Logs live in memory for the preview: one session, its turns' details and its flags.
const SESSION = 'preview'
let logging = true
let loreBudgets: LoreBudgetOverrides = {}
const logged = new Map<string, TurnDetails>()
// Every call made, whole, so a Calls tab can open its prompt and reply (milestone 4d).
const made = new Map<string, CallTrace>()
const summary = (c: CallTrace): CallSummary => ({ id: c.id, role: c.role, ms: c.ms, ...(c.firstTextMs !== undefined && { firstTextMs: c.firstTextMs }), model: 'mock' })
const summarized = <T extends { calls: CallTrace[] }>(trace: T) => {
  for (const c of trace.calls) made.set(c.id, c)
  return { ...trace, calls: trace.calls.map(summary) }
}

/**
 * A scripted bookkeeper for the preview (milestone 4c): a new detail, what changed, a mood for the first speaker and
 * every check kept, so the Records, Secrets and Checks tabs have something to show. It answers after a moment, as the
 * real one does while the player reads.
 */
const bookkeeper = async (prompt: { user: string }) => {
  await wait(800)
  const first = prompt.user.match(/^1\. ([^:]+):/m)?.[1]
  const id = content.characters.find((c) => c.name.startsWith(first ?? '\u0000'))?.id
  const shade = content.ruleset.people.emotions.shades[0]
  const checks = [...prompt.user.matchAll(/^- \[([^\]]+)\]/gm)].map((m) => m[1]!).filter((x) => !x.includes('.'))
  return JSON.stringify({
    secrets: [],
    new: [{ text: 'a private collector', at: 2 }],
    changed: 'The table hears the lie called out.',
    moods: id && shade ? [{ id, shade: shade.word, family: shade.families[0], intensity: 2 }] : [],
    checks: checks.map((c) => ({ id: c, honored: true }))
  })
}
const flagged: FlagRecord[] = []

const saved = new Map<string, { pack: string; slotId: string; savedAt: string; name?: string; state: GameState }>()

/**
 * The canned end-of-scene replies. Each holds a witness's relationship answers and their memory together; the two calls
 * each read their own fields from it.
 */
function cannedSummarize() {
  // Keyed by the first name each summary prompt opens with ("About Vex …").
  const summaries: Record<string, object> = {
    Vex: { memory: 'Vex caught Oria lying about the client and called it out in front of Rook, who backed her.', level: 'normal', reason: 'Rook trusted her read over Oria\'s polish.', approval: 'more', trust: 'a little more', interest: 'a little more', others: [{ with: 'oria-senn', approval: 'less', trust: 'a little less', interest: 'unchanged', reason: 'Same old Oria.' }] },
    Brask: { memory: 'Brask sat through a loud night at the Sump Lantern while Oria lied and Vex called it; nobody asked him anything.', level: 'fleeting', reason: 'Too loud, and nobody noticed he wanted to go.', approval: 'unchanged', trust: 'unchanged', interest: 'unchanged' },
    Oria: { memory: 'Oria was caught in her "darling" by a Courier and had to admit the client was corporate.', level: 'normal', reason: 'Rook pushed her in public.', approval: 'a little less', trust: 'unchanged', interest: 'a little more', others: [{ with: 'vex', approval: 'less', trust: 'unchanged', interest: 'unchanged', reason: 'She sees through me.' }] }
  }
  // Anyone the script didn't plan for (a walk-on who joined the scene) gets a quiet, unchanged reply.
  const quiet = (name: string) => ({ memory: `${name} spent the night at the edge of things.`, level: 'fleeting', reason: 'Nothing much happened between us.', approval: 'unchanged', trust: 'unchanged', interest: 'unchanged' })
  return content.manifest.id === 'neonpunk-nights'
    ? async (prompt: { user: string }) => {
        const name = prompt.user.match(/^About (\w+)/)![1]!
        return JSON.stringify(summaries[name] ?? quiet(name))
      }
    : mockLlm().summarize
}

const api: RendererApi = {
  getSettings: async () => toView(SettingsSchema.parse({})),
  saveSettings: async () => toView(SettingsSchema.parse({})),
  getLoreBudgets: async () => loreBudgets,
  setLoreBudgets: async (budgets) => (loreBudgets = cleanLoreBudgets(budgets).overrides),
  listModels: async () => ({ models: [] }),
  testConnection: async () => ({ ok: true, detail: 'mock' }),
  sceneTurn: async ({ state, input }) => {
    const llm = content.manifest.id === 'neonpunk-nights' ? scripted : mockLlm().turn
    const outcome = await runTurn(content, state, input, llm, emit, { loreBudgets, ...(logging && { log: SESSION }) })
    const { calls, ...trace } = outcome.trace
    for (const c of calls) made.set(c.id, c)
    const details: TurnDetails = {
      session: logging ? SESSION : '',
      turn: { ...trace, calls: calls.map((c) => c.id) },
      calls: calls.map(summary),
      scores: []
    }
    if (logging) {
      logged.set(trace.turnId, details)
      // The bookkeeper reads the turn while the player does; its record joins the logged details when it answers.
      const last = outcome.state.scene!.turns.at(-1)!
      void bookkeep(content, state, { id: last.id, input, beats: last.beats, plan: outcome.plan }, bookkeeper).then(({ trace: kept }) => {
        for (const c of kept.calls) made.set(c.id, c)
        const { calls: done, ...rest } = kept
        logged.set(trace.turnId, { ...details, calls: [...details.calls, ...done.map(summary)], records: { ...rest, calls: done.map((c) => c.id) } })
      })
    }
    return { ok: true, state: outcome.state, beats: outcome.beats, checks: outcome.plan.checks.flatMap((c) => (c.line ? [c.line] : [])), calls: outcome.calls, corrections: outcome.corrections, rewrite: outcome.problems.map((p) => p.fix), details }
  },
  consolidate: async (state) => ({ ok: true, state, merged: 0 }),
  sceneTies: async (state) => {
    const { state: next, trace } = await judgeScene(content, state, cannedSummarize())
    const details: SceneEndDetails = { ...(logging && { session: SESSION }), ties: summarized(trace) }
    return { ok: true, state: next, details }
  },
  sceneEnd: async (state) => {
    await wait(600)
    const summarize = cannedSummarize()
    const { state: next, reports, trace } = await endScene(content, state, summarize)
    const details: SceneEndDetails = { ...(logging && { session: SESSION }), end: summarized(trace) }
    return { ok: true, state: next, reports, details }
  },
  listPacks: async () => listings,
  choosePack: async (key) => {
    const chosen = found.find((f) => f.key === key)
    if (!chosen?.built.ok) return { ok: false, error: 'That pack can\'t be played.' }
    content = chosen.built.pack
    return { ok: true, pack: content }
  },
  openPacksFolder: async () => '(preview: no packs folder)',
  getPackFolders: async () => [],
  setPackFolders: async (folders) => folders,
  chooseFolder: async () => null,
  // Saves live in memory for the preview, per pack.
  listSaves: async () => [...saved.values()].filter((x) => x.pack === content.manifest.id).map(({ slotId, savedAt, name, state }) => ({ slotId, savedAt, unreadable: false as const, ...(name ? { name } : {}), packVersion: content.manifest.version, playerName: state.player.name, time: state.time, inScene: state.scene !== null, turns: state.scene?.turns.length ?? 0, memories: state.memories.length })),
  saveGame: async ({ slotId, state, name }) => {
    saved.set(`${content.manifest.id}/${slotId}`, { pack: content.manifest.id, slotId, savedAt: new Date().toISOString(), name: name ?? saved.get(`${content.manifest.id}/${slotId}`)?.name, state: state as GameState })
    return { ok: true, summary: (await api.listSaves()).find((s) => s.slotId === slotId)! }
  },
  loadGame: async (slotId) => {
    const game = saved.get(`${content.manifest.id}/${slotId}`)
    return game ? { ok: true, state: game.state } : { ok: false, error: 'Empty' }
  },
  deleteSave: async (slotId) => {
    saved.delete(`${content.manifest.id}/${slotId}`)
  },
  beginLog: async () => (logging ? SESSION : null),
  endLog: async () => {},
  getLogging: async () => logging,
  setLogging: async (on) => (logging = on),
  openLogsFolder: async () => '(preview: logs are in memory)',
  flag: async (input) => {
    const record: FlagRecord = { session: SESSION, ...input, at: new Date().toISOString() }
    flagged.push(record)
    return record
  },
  flagsFor: async (turns) => [...currentFlags(flagged).values()].filter((f) => turns.some((t) => t.session === f.turnSession && t.turnId === f.turnId)),
  turnDetails: async (_session, turnId) => logged.get(turnId) ?? null,
  callText: async (_session, callId) => {
    const c = made.get(callId)
    return c ? { id: c.id, role: c.role, system: c.prompt.system, user: c.prompt.user, ...(c.reply && { reply: c.reply }), ...(c.error && { error: c.error }) } : null
  },
  onSceneEvent: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}
;(window as unknown as { api: RendererApi }).api = api

await import('@app/renderer/src/main')
