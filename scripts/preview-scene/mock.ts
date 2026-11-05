// The renderer with a mock window.api: real content and the real turn pipeline, but a scripted director and writer
// that stream with delays. Build with `npx vite build --config scripts/preview-scene/vite.config.ts`.
import { CharacterSchema, LocationSchema, PlayerSchema } from '../../src/shared/model'
import { SettingsSchema, toView } from '../../src/shared/settings'
import type { Content } from '../../src/shared/game/content'
import type { RendererApi, SceneEvent } from '../../src/shared/ipc'
import { runTurn, type TurnLlm } from '../../src/main/scene/runTurn'
import vex from '../../content/default/characters/vex.json'
import brask from '../../content/default/characters/brask.json'
import oria from '../../content/default/characters/oria-senn.json'
import bar from '../../content/default/locations/sump-lantern.json'
import player from '../../content/default/player.json'

const content: Content = {
  characters: [vex, brask, oria].map((c) => CharacterSchema.parse(c)),
  locations: [LocationSchema.parse(bar)],
  player: PlayerSchema.parse(player)
}

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
  onSceneEvent: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}
;(window as unknown as { api: RendererApi }).api = api

await import('../../src/renderer/src/main')
