import { z } from 'zod'
import type { CheckResult, Difficulty, Edge, Ruleset, Skill } from '@engine/rules'
import type { GameState, Scene } from '@engine/state'
import { characterById, locationById, type Pack } from '@engine/pack'

/**
 * The director's beat plan (narrator-scene-engine §4), read leniently: a field the model leaves out or gets the wrong
 * shape of becomes empty rather than failing the turn. `validatePlan` then checks it against the scene.
 */
const text = z.string().catch('')
const list = <T extends z.ZodType>(item: T) => z.array(z.unknown()).catch([]).transform((xs) => xs.flatMap((x) => {
  const parsed = item.safeParse(x)
  return parsed.success ? [parsed.data as z.infer<T>] : []
}))

export const PlannedSpeakerSchema = z.object({
  id: z.string(),
  /** What the line gets across, with its content (round 0 F2): the writer's job for this speaker. */
  point: text.optional(),
  intent: text,
  mood: text,
  knows: text.optional(),
  hiding: text.optional(),
  approach: text.optional(),
  depends_on_check: z.string().optional().catch(undefined)
})

export const PlannedCheckSchema = z.object({
  id: z.string(),
  who: z.string(),
  skill: z.string(),
  difficulty: z.string(),
  stakes: text,
  /** A character present who helps. The game decides what their help is worth. */
  assist: z.string().optional().catch(undefined),
  /** Suggested with a reason; the game applies it, never stacked. */
  edge: z.enum(['advantage', 'disadvantage']).optional().catch(undefined),
  edge_reason: text.optional()
})

export const RawPlanSchema = z.object({
  speakers: list(PlannedSpeakerSchema),
  reactions: list(z.object({ id: z.string(), beat: z.string() })),
  checks: list(PlannedCheckSchema),
  walk_ons: list(z.object({ id: z.string(), line: z.string() })),
  texture: list(z.string()),
  contrast: text,
  avoid: list(z.string()),
  /** Characters who leave this beat. */
  leaves: list(z.string()),
  end_scene: z.boolean().catch(false)
})
export type RawPlan = z.infer<typeof RawPlanSchema>

export interface PlannedCheck {
  id: string
  who: string
  skill: Skill
  difficulty: Difficulty
  stakes: string
  assist?: string
  edge?: 'advantage' | 'disadvantage'
  /** Filled in by the game once rolled. */
  result?: CheckResult
  /** What the assist was worth, once rolled: a bonus, an edge, or nothing (no skill, or not enough of the assist meter). */
  assisted?: { by: string; bonus: number; edge: Edge; meter: number }
  /** The line shown to the player, e.g. "Ada — Search 17 vs 15: success". */
  line?: string
}

export type BeatPlan = Omit<RawPlan, 'checks'> & { checks: PlannedCheck[] }

/** At most two speakers a beat (narrator-scene-engine §6), and few enough checks to keep the turn quick. */
export const MAX_SPEAKERS = 2
export const MAX_CHECKS = 2
export const MAX_TEXTURE = 3
/**
 * After this many turns without a line, the director is shown what a character cares about (round 0 F3). A reminder
 * to look, never a quota: whether they speak stays the director's call (director-writer §6).
 */
export const QUIET_TURNS = 2

/** Pulls the JSON object out of a reply that may wrap it in a code fence or a sentence. */
export function parsePlan(reply: string): RawPlan | null {
  const stripped = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return null
  }
  const parsed = RawPlanSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')

/** A skill as the director wrote it, by id or by name. */
export function skillNamed(r: Ruleset, written: string): Skill | undefined {
  const asked = normalize(written)
  return r.skills.find((s) => normalize(s.id) === asked || normalize(s.name) === asked)?.id
}

export function difficultyNamed(r: Ruleset, written: string): Difficulty | undefined {
  const asked = normalize(written)
  return r.difficulties.find((d) => normalize(d.word) === asked)?.word
}

/** Who is here now: the persistent cast minus anyone who left. */
export const presentCast = (scene: Scene): string[] => scene.cast.filter((id) => !scene.departed.includes(id))

/** Who is meant: an id, a full name or a first name, for someone present. */
function presentId(content: Pack, scene: Scene, written: string): string | undefined {
  const asked = normalize(written)
  return presentCast(scene).find((id) => {
    const c = characterById(content, id)
    return id === asked || (c && (normalize(c.name) === asked || normalize(c.name.split(' ')[0]!) === asked))
  })
}

/**
 * Checks the plan against the scene and fixes what it can: unknown people are dropped, speakers capped at two,
 * checks with skills or difficulties that don't exist removed, texture capped. Returns what was changed and why,
 * so the test bench can show how often the director strays.
 */
export function validatePlan(content: Pack, state: GameState, raw: RawPlan): { plan: BeatPlan; corrections: string[] } {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const corrections: string[] = []
  const fix = (why: string) => corrections.push(why)

  const speakers: BeatPlan['speakers'] = []
  for (const s of raw.speakers) {
    const id = presentId(content, scene, s.id)
    if (!id) fix(`dropped speaker "${s.id}": not present`)
    else if (speakers.some((x) => x.id === id)) fix(`dropped duplicate speaker "${id}"`)
    else if (speakers.length >= MAX_SPEAKERS) fix(`dropped speaker "${id}": at most ${MAX_SPEAKERS}`)
    else speakers.push({ ...s, id })
  }

  const reactions: BeatPlan['reactions'] = []
  for (const r of raw.reactions) {
    const id = presentId(content, scene, r.id)
    if (!id) fix(`dropped reaction for "${r.id}": not present`)
    else if (speakers.some((s) => s.id === id)) fix(`dropped reaction for "${id}": they speak this beat`)
    else if (!reactions.some((x) => x.id === id)) reactions.push({ id, beat: r.beat })
  }

  const checks: PlannedCheck[] = []
  for (const c of raw.checks) {
    const who = normalize(c.who) === 'player' || normalize(c.who) === normalize(state.player.name) ? 'player' : presentId(content, scene, c.who)
    const skill = skillNamed(content.ruleset, c.skill)
    const difficulty = difficultyNamed(content.ruleset, c.difficulty)
    if (!who) fix(`dropped check "${c.id}": "${c.who}" is not present`)
    else if (!skill) fix(`dropped check "${c.id}": no skill "${c.skill}"`)
    else if (!difficulty) fix(`dropped check "${c.id}": no difficulty "${c.difficulty}"`)
    else if (checks.length >= MAX_CHECKS) fix(`dropped check "${c.id}": at most ${MAX_CHECKS}`)
    else if (checks.some((x) => x.id === c.id)) fix(`dropped duplicate check "${c.id}"`)
    else {
      const assist = c.assist ? presentId(content, scene, c.assist) : undefined
      if (c.assist && (!assist || assist === who)) fix(`dropped assist "${c.assist}" on check "${c.id}"`)
      checks.push({
        id: c.id,
        who,
        skill,
        difficulty,
        stakes: c.stakes,
        ...(assist && assist !== who && { assist }),
        ...(c.edge && { edge: c.edge })
      })
    }
  }
  for (const s of speakers) {
    if (s.depends_on_check && !checks.some((c) => c.id === s.depends_on_check)) {
      fix(`removed ${s.id}'s dependency on unknown check "${s.depends_on_check}"`)
      delete s.depends_on_check
    }
    // Kept, since dropping a speaker the player addressed is worse, but counted: a line without a point is the
    // filler round 0 found (F2).
    if (!s.point?.trim()) fix(`speaker "${s.id}" has no point`)
  }

  const location = locationById(content, scene.locationId)!
  const walk_ons = raw.walk_ons.flatMap((w) => {
    const card = location.walkOns.find((x) => scene.walkOns.includes(x.id) && [x.id, x.label, x.name ?? ''].some((n) => normalize(n) === normalize(w.id)))
    if (!card) {
      fix(`dropped walk-on "${w.id}": not here`)
      return []
    }
    return [{ id: card.id, line: w.line }]
  })

  let texture = raw.texture.filter((t) => t.trim().length > 0)
  if (texture.length > MAX_TEXTURE) {
    fix(`kept ${MAX_TEXTURE} of ${texture.length} texture details`)
    texture = texture.slice(0, MAX_TEXTURE)
  }
  if (texture.length === 0) texture = freshTexture(content, scene, 2)

  const leaves = raw.leaves.flatMap((l) => {
    const id = presentId(content, scene, l)
    if (!id) fix(`ignored departure of "${l}": not present`)
    return id ? [id] : []
  })

  return { plan: { ...raw, speakers, reactions, checks, walk_ons, texture, leaves }, corrections }
}

/** Location details not used in the last few turns, so description doesn't repeat. */
export function freshTexture(content: Pack, scene: Scene, count: number): string[] {
  const location = locationById(content, scene.locationId)!
  const used = new Set(scene.turns.slice(-3).flatMap((t) => t.texture))
  const all = [...location.texture.sights, ...location.texture.sounds, ...location.texture.smells]
  const fresh = all.filter((t) => !used.has(t))
  // Rotate by turn so a run of fallback plans doesn't always open on the same detail.
  const pool = fresh.length >= count ? fresh : all
  const start = scene.turns.length % pool.length
  return [...pool.slice(start), ...pool.slice(0, start)].slice(0, count)
}

/** How many turns since each present character last had a speaking slot (the whole scene if never). */
export function silence(scene: Scene): Record<string, number> {
  const result: Record<string, number> = {}
  for (const id of presentCast(scene)) {
    const last = scene.turns.findLastIndex((t) => t.speakers.includes(id))
    result[id] = last < 0 ? scene.turns.length : scene.turns.length - 1 - last
  }
  return result
}

/**
 * The plan the game makes itself when the director's reply can't be read, so a bad reply costs no extra call:
 * whoever the player named speaks, else whoever has been silent longest; everyone else reacts.
 */
export function fallbackPlan(content: Pack, state: GameState, input: string): BeatPlan {
  const scene = state.scene!
  const present = presentCast(scene)
  const quiet = silence(scene)
  const named = present.find((id) => {
    const c = characterById(content, id)!
    return new RegExp(`\\b(${[c.id, c.name, c.name.split(' ')[0]].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i').test(input)
  })
  const speaker = named ?? [...present].sort((a, b) => quiet[b]! - quiet[a]!)[0]
  return {
    speakers: speaker ? [{ id: speaker, point: 'Answer what the player just said, directly.', intent: 'Answer what the player just said, in character, pursuing their own aims.', mood: scene.moods[speaker] ?? '' }] : [],
    reactions: present.filter((id) => id !== speaker).map((id) => ({ id, beat: 'reacts in keeping with their mood' })),
    checks: [],
    walk_ons: [],
    texture: freshTexture(content, scene, 2),
    contrast: '',
    avoid: [],
    leaves: [],
    end_scene: false
  }
}
