import type { GameState, Relation } from './schema'
import type { Scene } from './scene'
import { characterById, locationById, type Pack } from '@engine/pack'

/** A new game: the test player, everyone's starting feelings, the dice seeded. */
export function createInitialState(content: Pack, seed: number): GameState {
  const relations: Relation[] = content.characters.flatMap((c) =>
    c.relations.map((r) => ({ from: c.id, to: r.to, label: r.label, meters: r.meters }))
  )
  return {
    player: content.player,
    // Evening of the first day: 20:00.
    time: 20 * 60,
    dice: seed >>> 0,
    meters: Object.fromEntries(content.characters.map((c) => [c.id, c.meters])),
    relations,
    memories: [],
    facts: {},
    scene: null
  }
}

/**
 * Opens a scene at a location with the given cast; moods and comfort start from the characters' files. `id` names the
 * scene in logs; the app passes a unique one, and the default (from the game clock) is enough for tests and the bench.
 */
export function startScene(content: Pack, state: GameState, locationId: string, cast: string[], id = `scene-${state.time}`): GameState {
  const location = locationById(content, locationId)
  if (!location) throw new Error(`Unknown location "${locationId}"`)
  const characters = cast.map((id) => {
    const c = characterById(content, id)
    if (!c) throw new Error(`Unknown character "${id}"`)
    return c
  })
  const scene: Scene = {
    id,
    locationId,
    cast,
    walkOns: location.walkOns.map((w) => w.id),
    turns: [],
    summary: '',
    moods: Object.fromEntries(characters.map((c) => [c.id, c.mood])),
    comfort: Object.fromEntries(characters.map((c) => [c.id, 3])),
    expressions: Object.fromEntries(characters.map((c) => [c.id, 'neutral'])),
    departed: [],
    ended: false,
    nsfw: false,
    baseline: Object.fromEntries(cast.map((id) => [id, state.meters[id]!]))
  }
  return { ...state, scene }
}

/**
 * Whether a saved game still fits the content it is loaded with: every character, place and walk-on it names must
 * exist. Empty when it does. A save that doesn't fit is refused rather than patched (no backwards compatibility).
 */
export function stateProblems(content: Pack, state: GameState): string[] {
  const known = new Set(content.characters.map((c) => c.id))
  const problems: string[] = []
  const unknown = (what: string, id: string) => {
    if (!known.has(id)) problems.push(`${what} names unknown character "${id}"`)
  }
  for (const id of Object.keys(state.meters)) unknown('meters', id)
  // Meters must be the ruleset's: a save from a pack version with other meters doesn't fit.
  const meterIds = content.ruleset.meters.list.map((m) => m.id).sort().join(',')
  const fits = (m: Record<string, number>) => Object.keys(m).sort().join(',') === meterIds
  if (!Object.values(state.meters).every(fits) || !state.relations.every((r) => fits(r.meters))) {
    problems.push(`its relationship meters aren't this pack's (${meterIds.replaceAll(',', ', ')})`)
  }
  for (const [skill] of Object.entries(state.player.stats.skills)) {
    if (!content.ruleset.skills.some((s) => s.id === skill)) problems.push(`the player has unknown skill "${skill}"`)
  }
  for (const r of state.relations) {
    unknown('a relation', r.from)
    unknown('a relation', r.to)
  }
  for (const m of state.memories) unknown('a memory', m.owner)
  for (const id of Object.keys(state.facts)) unknown('facts', id)
  const scene = state.scene
  if (scene) {
    const location = locationById(content, scene.locationId)
    if (!location) problems.push(`the scene is at unknown location "${scene.locationId}"`)
    for (const id of [...scene.cast, ...scene.departed]) unknown('the scene', id)
    for (const id of scene.walkOns) if (!location?.walkOns.some((w) => w.id === id)) problems.push(`the scene has unknown walk-on "${id}"`)
  }
  return [...new Set(problems)]
}
