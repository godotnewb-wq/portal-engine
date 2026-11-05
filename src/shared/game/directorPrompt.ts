import type { Character, GameState, Meters, Turn } from '../model'
import { DIFFICULTY_DC, SKILLS } from '../model/rules'
import { characterById, locationById, type Content } from './content'
import { MAX_CHECKS, MAX_SPEAKERS, presentCast, silence } from './plan'
import { CORE_LORE } from './style'

export interface Prompt {
  system: string
  /** Per-turn material, last, so the stable prefix caches. */
  user: string
}

/** How many past turns go into prompts verbatim; older ones live in the running summary. */
export const RECENT_TURNS = 3

const meterWords = (m: Meters) => `approval ${m.approval}, trust ${m.trust}, attraction ${m.attraction} (0–100)`

const DIRECTOR_RULES = `You are the director of an adult visual-novel RPG scene. You do not write prose. You read the whole situation and return a short JSON beat plan for this turn; a separate writer turns it into prose.

Return only a JSON object:
{
  "speakers": [{"id","intent","mood","knows","hiding","approach","depends_on_check"}],
  "reactions": [{"id","beat"}],
  "checks": [{"id","who","skill","difficulty","stakes","assist","edge","edge_reason"}],
  "walk_ons": [{"id","line"}],
  "texture": ["..."],
  "contrast": "...",
  "avoid": ["..."],
  "leaves": ["id"],
  "end_scene": false
}

Rules:
- At most ${MAX_SPEAKERS} speakers. Pick: whoever the player addressed; anyone whose agenda is urgent; anyone whose comfort is low; whoever has been silent longest. Everyone else present gets a one-line reaction.
- intent: what the speaker is trying to do this beat, from their own agenda, not just answering the player.
- hiding/approach: only when a secret matters now; approach is lie / deflect / partial truth / tell, and name their tell when lying.
- checks: only when the outcome is uncertain and matters (noticing a lie, persuading, sneaking). At most ${MAX_CHECKS}. who is "player" or a character id. skill is one of: ${SKILLS.join(', ')}. difficulty is one of: ${Object.keys(DIFFICULTY_DC).join(', ')}. stakes says what success means. A speaker whose line depends on a roll names it in depends_on_check. assist: a character present who helps.
- walk_ons: a line or action for a walk-on, voiced by the narrator.
- texture: 2–3 specific details from the location card, preferring ones not used recently.
- contrast: one line on how the speakers' voices differ.
- avoid: phrases and details to steer clear of.
- leaves: characters who walk out this beat. end_scene: true only when the scene has reached a natural close.
- Never decide, say or do anything for the player.`

function sheet(content: Content, state: GameState, c: Character, present: string[]): string {
  const scene = state.scene!
  const meters = state.meters[c.id]
  const relations = state.relations
    .filter((r) => r.from === c.id && present.includes(r.to))
    .map((r) => `${characterById(content, r.to)?.name ?? r.to}: ${r.label} (${meterWords(r.meters)})`)
  return [
    `## ${c.name} [id: ${c.id}] — ${c.tier}, ${c.species}, ${c.pronouns}`,
    `Role: ${c.role}`,
    `Personality: ${c.personality}`,
    `Agenda: ${c.agenda.longTerm.join('; ')}. Tonight: ${c.agenda.current}`,
    `Contradictions: ${c.contradictions.join('; ')}`,
    `Mood now: ${scene.moods[c.id] ?? c.mood}. Comfort ${scene.comfort[c.id] ?? 3}/5.`,
    c.knowledge.length > 0 && `Knows: ${c.knowledge.join('; ')}`,
    c.values.length > 0 && `Values: ${c.values.map((v) => `${v.stance} ${v.value}`).join(', ')}`,
    ...c.secrets.map((s) => `Secret [${s.id}]: ${s.text} Tell: ${s.tell}.${s.revealWhen ? ` Would reveal when: ${s.revealWhen}.` : ''}`),
    `Lying tell: ${c.voice.shifts.lying}`,
    meters && `Toward the player: ${meterWords(meters)}`,
    relations.length > 0 && `Toward others here: ${relations.join('; ')}`
  ]
    .filter(Boolean)
    .join('\n')
}

/** A past turn as the prompts show it: what the player said and the beats written. */
export function turnText(content: Content, playerName: string, turn: Turn): string {
  const beats = turn.beats.map((b) => (b.kind === 'narration' ? b.text : `${characterById(content, b.speaker)?.name ?? b.speaker}: ${b.text}`))
  return [`${playerName}: ${turn.player}`, ...beats].join('\n')
}

export function buildDirectorPrompt(content: Content, state: GameState, input: string): Prompt {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const location = locationById(content, scene.locationId)!
  const present = presentCast(scene)
  const cast = present.map((id) => characterById(content, id)!)
  const walkOns = location.walkOns.filter((w) => scene.walkOns.includes(w.id))
  const player = state.player

  const system = [
    DIRECTOR_RULES,
    `# World\n${CORE_LORE}`,
    `# Location: ${location.name} (${location.tier}, ${location.district})\n${location.description}\nSights: ${location.texture.sights.join('; ')}\nSounds: ${location.texture.sounds.join('; ')}\nSmells: ${location.texture.smells.join('; ')}${location.texture.slang.length ? `\nLocal slang: ${location.texture.slang.join('; ')}` : ''}${location.texture.current.length ? `\nLately: ${location.texture.current.join('; ')}` : ''}${location.extras.length ? `\nCrowd: ${location.extras.join('; ')}` : ''}`,
    walkOns.length > 0 && `# Walk-ons\n${walkOns.map((w) => `- ${w.label}${w.name ? ` (${w.name})` : ''} [id: ${w.id}]: ${w.species}; ${w.look}; ${w.manner}; ${w.role}`).join('\n')}`,
    `# The player: ${player.name} (${player.species}, ${player.pronouns})\n${player.appearance}. ${player.background}`,
    `# Characters present\n${cast.map((c) => sheet(content, state, c, present)).join('\n\n')}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const quiet = silence(scene)
  const recent = scene.turns.slice(-RECENT_TURNS)
  const usedTexture = [...new Set(scene.turns.slice(-3).flatMap((t) => t.texture))]
  const user = [
    scene.summary && `# Earlier in the scene\n${scene.summary}`,
    recent.length > 0 ? `# Last turns\n${recent.map((t) => turnText(content, player.name, t)).join('\n\n')}` : '# The scene opens now.',
    `# Turns since each last spoke\n${present.map((id) => `${id}: ${quiet[id]}`).join(', ')}`,
    usedTexture.length > 0 && `# Texture used recently\n${usedTexture.join('; ')}`,
    `# The player says or does\n${input}`,
    'Return the JSON beat plan.'
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, user }
}
