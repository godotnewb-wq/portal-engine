import type { GameState, Scene } from '@engine/state'
import type { Pack } from '@engine/pack'
import { characterById, locationById } from '@engine/pack'
import { presentCast } from './planShape'
import { learnedMemories } from '@engine/memory'

/**
 * Something a line can say, with who may say it (director writer review, option B). Characters' knowledge and
 * secrets belong to them; the place's current news belongs to anyone there; what has been said on screen this scene
 * belongs to everyone present. A move may use only facts its speaker has, so one character can't say what only
 * another knows (session 2026-11-07_1246_b4db: the nurse quoting the conductor's own record).
 */
export interface Fact {
  id: string
  text: string
  /** A character id, or `scene` for what anyone present can know. */
  owner: string
  kind: 'knows' | 'secret' | 'place' | 'said'
  /** For a secret: the characters present who learned it in play (milestone 4b), who can say it too. */
  knownBy?: string[]
}

/** Every fact in the scene now, by id: `<character>.k<n>`, `<character>.<secret id>`, `place.<n>`, and `said.<n>`. */
export function sceneFacts(content: Pack, state: GameState): Fact[] {
  const scene = state.scene!
  const location = locationById(content, scene.locationId)
  const cast = presentCast(scene).flatMap((id) => {
    const c = characterById(content, id)
    if (!c) return []
    return [
      ...c.knowledge.map((text, i): Fact => ({ id: `${c.id}.k${i + 1}`, text, owner: c.id, kind: 'knows' })),
      ...c.secrets.map((s): Fact => ({ id: `${c.id}.${s.id}`, text: s.text, owner: c.id, kind: 'secret' }))
    ]
  })
  const place = (location?.texture.current ?? []).map((text, i): Fact => ({ id: `place.${i + 1}`, text, owner: 'scene', kind: 'place' }))
  const said = scene.newFacts.map((f): Fact => ({ id: f.id, text: f.text, owner: 'scene', kind: 'said' }))
  // Secrets learned in play (milestone 4b): a learner present can say it too, holder here or not. The fact keeps the
  // holder's id, so it is still introduced the first time and its holder's disclosure gate doesn't apply to the learner.
  const learned = new Map<string, string[]>()
  for (const who of presentCast(scene)) for (const m of learnedMemories(state, who)) learned.set(m.secret!, [...(learned.get(m.secret!) ?? []), who])
  const absent = [...learned.keys()].filter((id) => !cast.some((f) => f.id === id)).flatMap((id): Fact[] => {
    const holder = characterById(content, id.slice(0, id.indexOf('.')))
    const s = holder?.secrets.find((x) => `${holder.id}.${x.id}` === id)
    return holder && s ? [{ id, text: s.text, owner: holder.id, kind: 'secret' }] : []
  })
  return [...cast, ...absent, ...place, ...said].map((f) => (learned.has(f.id) ? { ...f, knownBy: learned.get(f.id)! } : f))
}

/** Whether `who` can say this fact: their own, the place's, a secret they learned, or anything already said in front of them. */
export const canSay = (scene: Scene, fact: Fact, who: string): boolean => fact.owner === who || fact.owner === 'scene' || !!fact.knownBy?.includes(who) || scene.told.includes(fact.id)

/** Whether the player has heard this fact on screen this scene; a fact they haven't is introduced when it comes up. */
export const toldPlayer = (scene: Scene, fact: Fact): boolean => fact.kind === 'said' || scene.told.includes(fact.id)
