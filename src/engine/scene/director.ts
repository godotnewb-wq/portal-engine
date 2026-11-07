import type { Prompt } from '@engine/core'
import type { Character, Meters } from '@engine/characters'
import type { GameState, Turn } from '@engine/state'
import type { Ruleset } from '@engine/rules'
import { characterById, locationById, type Pack } from '@engine/pack'
import { MAX_CHECKS, MAX_LINES, MAX_SPEAKERS, QUIET_TURNS, presentCast, silence } from './plan'
import { recall } from '@engine/memory'
import { ADULTS_ONLY } from './style'
import { tierById } from '@engine/world'

/** How many past turns go into prompts verbatim; older ones live in the running summary. */
export const RECENT_TURNS = 3

/** A character's meters as the prompts show them, e.g. "approval 55, trust 60, attraction 35 (0–100)". */
export const meterWords = (r: Ruleset, m: Meters): string =>
  `${r.meters.list.map((x) => `${x.id} ${m[x.id] ?? r.meters.min}`).join(', ')} (${r.meters.min}–${r.meters.max})`

export const directorRules = (r: Ruleset): string => `You are the director of a visual-novel RPG scene. You do not write prose. You read the whole situation and return a short JSON beat plan for this turn; a separate writer turns it into prose.

Return only a JSON object:
{
  "speakers": [{"id","intent","mood","knows","hiding","approach","depends_on_check"}],
  "exchange": [{"who","answers","point"}],
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
- exchange: the turn's conversation, line by line in order, at most ${MAX_LINES} lines, each by one of the speakers. Plan it as a conversation, not separate speeches: each line answers the one before it or the player.
  - who: the speaker's id.
  - answers: "player", or the number of an earlier line (1 is the first). When the player spoke to someone, line 1 answers the player. A later line answers whoever just spoke when it can: a speaker replies to the last line, pushes back on it or takes it further.
  - A speaker can have more than one line when someone answers them. Every line needs its own point.
  - point: the one thing this line gets across, in plain words and with its content: what they answer, ask, offer, refuse, demand, admit or warn ("names her price: nine each, half tonight"; "asks who else knows about the case"). It adds one new thing the conversation didn't have; more waits for a later line. A stance ("needles her") or a mood is not a point. When lying or deflecting, the point is the specific lie or dodge.
  - A point is a note for the writer, not the line: your own plain words, never quoted dialogue, sayings or a finished sentence for the character to say. State the content flatly, with no wordplay or turns of phrase ("says it has to be tonight because the rival crew is close"). The writer writes the line in the character's voice.
  - When a line brings up something the player hasn't heard this scene (a job, an object, a person, a place), the point says so: "first mention of the case: what it is".
  - A point refers only to what was actually said in the last turns, by whom it was said.
- reactions: silent, one line each: a look, a gesture, a move. Never speech, muttering or "says that". Someone with something to say needs a line in the exchange, which makes them a speaker; if both speaker slots are taken, it waits for a later turn.
- Only plan someone to speak when they have a point. Never repeat a point already made in the last turns.
- A question asked in the last turns that nobody has answered gets an answer or a visible dodge this turn, from whoever it was asked of.
- speakers: who has lines this turn, with their brief. intent: what the speaker is trying to do this beat, from their own agenda, not just answering the player.
- hiding/approach: only when a secret matters now; approach is lie / deflect / partial truth / tell, and name their tell when lying.
- checks: only when the outcome is uncertain and matters (noticing a lie, persuading, sneaking). At most ${MAX_CHECKS}. who is "player" or a character id. skill is one of: ${r.skills.map((x) => x.id).join(', ')}. difficulty is one of: ${r.difficulties.map((d) => d.word).join(', ')}. stakes says what success means. A speaker whose line depends on a roll names it in depends_on_check. assist: a character present who helps.
- walk_ons: a line or action for a walk-on, voiced by the narrator. Only when the player speaks to them, or what they say or do bears on the conversation right now (their trade, a price, a warning that changes what happens next). Never a line for atmosphere; atmosphere belongs in texture.
- texture: 2–3 details from the location card, as plain facts ("the conduit flickers"), preferring ones not used recently. No similes or description: the writer decides how to show them.
- contrast: one line on how the speakers' voices differ.
- avoid: phrases and details to steer clear of.
- Every field is notes for the writer. Never write the prose or the dialogue yourself.
- leaves: characters who walk out this beat. end_scene: true only when the scene has reached a natural close.
- Quiet characters are listed each turn with what they care about. If what is being said touches their trade, aims or knowledge, they have a point: give them a slot. If nothing does, silence is fine.
- Never decide, say or do anything for the player.`

/** A character as the director sees them. With `ids`, knowledge and secrets carry the fact ids moves refer to. */
export function sheet(content: Pack, state: GameState, c: Character, present: string[], ids = false): string {
  const scene = state.scene!
  const meters = state.meters[c.id]
  const relations = state.relations
    .filter((r) => r.from === c.id && present.includes(r.to))
    .map((r) => `${characterById(content, r.to)?.name ?? r.to}: ${r.label} (${meterWords(content.ruleset, r.meters)})`)
  return [
    `## ${c.name} [id: ${c.id}] — ${c.tier}, ${c.species}, ${c.pronouns}`,
    `Role: ${c.role}`,
    `Personality: ${c.personality}`,
    `Agenda: ${c.agenda.longTerm.join('; ')}. Tonight: ${c.agenda.current}`,
    `Contradictions: ${c.contradictions.join('; ')}`,
    `Mood now: ${scene.moods[c.id] ?? c.mood}. Comfort ${scene.comfort[c.id] ?? 3}/5.`,
    c.knowledge.length > 0 && (ids ? `Knows:\n${c.knowledge.map((k, i) => `- [${c.id}.k${i + 1}] ${k}`).join('\n')}` : `Knows: ${c.knowledge.join('; ')}`),
    c.values.length > 0 && `Values: ${c.values.map((v) => `${v.stance} ${v.value}`).join(', ')}`,
    ...c.secrets.map((s) => `Secret [${ids ? `${c.id}.` : ''}${s.id}]: ${s.text} Tell: ${s.tell}.${s.revealWhen ? ` Would reveal when: ${s.revealWhen}.` : ''}`),
    `Lying tell: ${c.voice.shifts.lying}`,
    meters && `Toward the player: ${meterWords(content.ruleset, meters)}`,
    recall(state, c).length > 0 && `Remembers: ${recall(state, c).map((m) => `(${m.level}) ${m.text}`).join(' ')}`,
    (state.facts[c.id] ?? []).length > 0 && `The player already knows: ${state.facts[c.id]!.join(' ')}`,
    relations.length > 0 && `Toward others here: ${relations.join('; ')}`
  ]
    .filter(Boolean)
    .join('\n')
}

/** Who said a line, by the name the scene knows them by: a character's first name, a walk-on's name or label. */
function speakerName(content: Pack, id: string): string {
  const c = characterById(content, id)
  if (c) return c.name.split(/\s+/)[0]!
  const w = content.locations.flatMap((l) => l.walkOns).find((x) => x.id === id)
  return w?.name ?? w?.label ?? id
}

/**
 * A past turn as the prompts show it: what the player said and the beats written. Speech keeps its quotes and the
 * name the writer uses, so it can't be read as narration (session 2026-11-06_1757_9630: walk-ons by id, full names where the writer uses first names).
 */
export function turnText(content: Pack, playerName: string, turn: Turn): string {
  const beats = turn.beats.map((b) => (b.kind === 'narration' ? b.text : `${speakerName(content, b.speaker)}: "${b.text}"`))
  return [`${playerName}: ${turn.player}`, ...beats].join('\n')
}

export function buildDirectorPrompt(content: Pack, state: GameState, input: string): Prompt {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const location = locationById(content, scene.locationId)!
  const present = presentCast(scene)
  const cast = present.map((id) => characterById(content, id)!)
  const walkOns = location.walkOns.filter((w) => scene.walkOns.includes(w.id))
  const player = state.player

  const system = [
    directorRules(content.ruleset),
    `# World: ${content.setting.name}\n${content.primer}\n${ADULTS_ONLY}`,
    content.tone && `# Tone\n${content.tone}`,
    `# Location: ${location.name} (${tierById(content.setting, location.tier)?.name ?? location.tier}, ${location.district})\n${location.description}\nSights: ${location.texture.sights.join('; ')}\nSounds: ${location.texture.sounds.join('; ')}\nSmells: ${location.texture.smells.join('; ')}${location.texture.slang.length ? `\nLocal slang: ${location.texture.slang.join('; ')}` : ''}${location.texture.current.length ? `\nLately: ${location.texture.current.join('; ')}` : ''}${location.extras.length ? `\nCrowd: ${location.extras.join('; ')}` : ''}`,
    walkOns.length > 0 && `# Walk-ons\n${walkOns.map((w) => `- ${w.label}${w.name ? ` (${w.name})` : ''} [id: ${w.id}]: ${w.species}; ${w.look}; ${w.manner}; ${w.role}`).join('\n')}`,
    `# The player: ${player.name} (${player.species}, ${player.pronouns})\n${player.appearance}. ${player.background}`,
    `# Characters present\n${cast.map((c) => sheet(content, state, c, present)).join('\n\n')}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const quiet = silence(scene)
  const recent = scene.turns.slice(-RECENT_TURNS)
  // What each quiet character cares about, pulled from their sheet so the director weighs it against this turn.
  const quietOnes = cast
    .filter((c) => quiet[c.id]! >= QUIET_TURNS)
    .map((c) => [`- ${c.name} [id: ${c.id}], silent ${quiet[c.id]} turns. Trade: ${c.role}. Tonight: ${c.agenda.current}. Wants: ${c.agenda.longTerm.join('; ')}.`, c.knowledge.length > 0 && ` Knows: ${c.knowledge.join('; ')}.`].filter(Boolean).join(''))
  const usedTexture = [...new Set(scene.turns.slice(-3).flatMap((t) => t.texture))]
  const user = [
    scene.summary && `# Earlier in the scene\n${scene.summary}`,
    recent.length > 0 ? `# Last turns\n${recent.map((t) => turnText(content, player.name, t)).join('\n\n')}` : '# The scene opens now.',
    `# Turns since each last spoke\n${present.map((id) => `${id}: ${quiet[id]}`).join(', ')}`,
    quietOnes.length > 0 && `# Quiet for a while: does anything on the table touch them?\n${quietOnes.join('\n')}`,
    usedTexture.length > 0 && `# Texture used recently\n${usedTexture.join('; ')}`,
    `# The player says or does\n${input}`,
    'Return the JSON beat plan.'
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, user }
}
