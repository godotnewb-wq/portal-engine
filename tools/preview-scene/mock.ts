/// <reference types="vite/client" />
// The renderer with a mock window.api: real content and the real turn pipeline, but a scripted director and writer
// that stream with delays. Build with `npx vite build --config scripts/preview-scene/vite.config.ts`.
import { SettingsSchema, toView } from '@llm'
import { buildPack, type Pack, type PackFiles } from '@engine/pack'
import type { GameState } from '@engine/state'
import type { RendererApi, SceneEvent } from '@app/ipc'
import { runTurn, type TurnLlm } from '@engine/scene'
import { endScene } from '@engine/relationships'
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
    phrases: json[at('setting/phrases.json')] ?? [],
    player: json[at('player.json')],
    characters: folder('characters'),
    locations: folder('locations')
  }
}

const built = buildPack(packFiles('neonpunk-nights'))
if (!built.ok) throw new Error(built.problems.join('\n'))
const content: Pack = built.pack

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

const llm: TurnLlm = {
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

const saved = new Map<string, { slotId: string; savedAt: string; name?: string; state: GameState }>()

const api: RendererApi = {
  getContent: async () => content,
  getSettings: async () => toView(SettingsSchema.parse({})),
  saveSettings: async () => toView(SettingsSchema.parse({})),
  listModels: async () => ({ models: [] }),
  testConnection: async () => ({ ok: true, detail: 'mock' }),
  sceneTurn: async ({ state, input }) => {
    const outcome = await runTurn(content, state, input, llm, emit)
    return { ok: true, state: outcome.state, beats: outcome.beats, checks: outcome.plan.checks.flatMap((c) => (c.line ? [c.line] : [])), calls: outcome.calls, corrections: outcome.corrections, rewrite: outcome.problems.map((p) => p.fix) }
  },
  sceneEnd: async (state) => {
    await wait(600)
    // Keyed by the first name each summary prompt opens with ("About Vex …").
    const summaries: Record<string, object> = {
      Vex: { memory: 'Vex caught Oria lying about the client and called it out in front of Rook, who backed her.', level: 'normal', reason: 'Rook trusted her read over Oria\'s polish.', approval: 'more', trust: 'a little more', attraction: 'a little more', others: [{ with: 'oria-senn', approval: 'less', trust: 'a little less', attraction: 'unchanged', reason: 'Same old Oria.' }] },
      Brask: { memory: 'Brask sat through a loud night at the Sump Lantern while Oria lied and Vex called it; nobody asked him anything.', level: 'fleeting', reason: 'Too loud, and nobody noticed he wanted to go.', approval: 'unchanged', trust: 'unchanged', attraction: 'unchanged' },
      Oria: { memory: 'Oria was caught in her "darling" by a Courier and had to admit the client was corporate.', level: 'normal', reason: 'Rook pushed her in public.', approval: 'a little less', trust: 'unchanged', attraction: 'a little more', learned: [], others: [{ with: 'vex', approval: 'less', trust: 'unchanged', attraction: 'unchanged', reason: 'She sees through me.' }] }
    }
    return { ok: true, ...(await endScene(content, state, async (prompt) => JSON.stringify(summaries[prompt.user.match(/^About (\w+)/)![1]!]))) }
  },
  // Saves live in memory for the preview.
  listSaves: async () => [...saved.values()].map(({ slotId, savedAt, name, state }) => ({ slotId, savedAt, unreadable: false as const, ...(name ? { name } : {}), playerName: state.player.name, time: state.time, inScene: state.scene !== null, turns: state.scene?.turns.length ?? 0, memories: state.memories.length })),
  saveGame: async ({ slotId, state, name }) => {
    saved.set(slotId, { slotId, savedAt: new Date().toISOString(), name: name ?? saved.get(slotId)?.name, state: state as GameState })
    return { ok: true, summary: (await api.listSaves()).find((s) => s.slotId === slotId)! }
  },
  loadGame: async (slotId) => {
    const game = saved.get(slotId)
    return game ? { ok: true, state: game.state } : { ok: false, error: 'Empty' }
  },
  deleteSave: async (slotId) => {
    saved.delete(slotId)
  },
  onSceneEvent: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}
;(window as unknown as { api: RendererApi }).api = api

await import('@app/renderer/src/main')
