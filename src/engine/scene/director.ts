import type { Prompt } from '@engine/core'
import type { Character } from '@engine/characters'
import type { GameState, Turn } from '@engine/state'
import { meterWords, type Ruleset } from '@engine/rules'
import { characterById, locationById, type Pack } from '@engine/pack'
import { recall } from '@engine/memory'
import { tierById } from '@engine/world'
import { sceneFacts } from './facts'
import { MAX_CHECKS, MAX_LINES, MAX_SPEAKERS, QUIET_TURNS, presentCast, silence } from './planShape'
import { LORE_LINE_WORDS, MOVE_KINDS, NEW_FACT_WORDS } from './plan'
import { turnLore, type TurnLore } from './lore'
import { cueSecretLine, fullSecretLine, type SecretShown } from './secrets'

/** How many past turns go into prompts verbatim; older ones live in the running summary. */
export const RECENT_TURNS = 3


/**
 * The director's rules (director writer review, option B, the situation plan). It plans what is true, wanted and at stake, as
 * choices and fact ids, and writes no prose and no dialogue. Short on purpose: what code can check (who knows what,
 * what's been said, who may speak) is checked in code, not asked for here.
 */
export const directorRules = (r: Ruleset, loreLines = r.codex.loreLines): string => `You are the director of a visual-novel RPG scene. You don't write prose or dialogue. You decide what happens this turn and return JSON; a writer turns it into the scene.

Return only this JSON object:
{
  "player_action": {"doing", "uncertain"},
  "checks": [{"id","who","skill","difficulty","stakes","assist","edge","edge_reason"}],
  "speakers": [{"id","goal","mood","pressure","keeps","touched","approach","framing"}],
  "moves": [{"who","answers","move","uses","new","needs"}],
${loreLines > 0 ? '  "lore": [{"entry","who","line"}],\n' : ''}  "change": "...",
  "reactions": [{"id","beat"}],
  "walk_ons": [{"id","line"}],
  "texture": [], "avoid": [], "leaves": [], "end_scene": false
}

- The player leads. Start from what the player just said or did: move 1 answers it, in its own terms. A character's own aims come in after that, or in a later turn, unless something urgent cuts in.
- player_action: what the player is doing, in plain words. uncertain: true only for an attempt whose outcome is in doubt (persuading, sneaking, climbing, fixing, studying someone closely). Talking and asking are not uncertain.
- checks: only for an uncertain player action, or a character attempting something uncertain. The skill fits the action. At most ${MAX_CHECKS}. who is "player" or a character id. skill is one of: ${r.skills.map((x) => x.id).join(', ')}. difficulty is one of: ${r.difficulties.map((d) => d.word).join(', ')}. stakes says what success means. assist: a character present who helps.
- People are in the moment. What they say comes first from what was just said and done: they answer, notice, react. Their aims for the night and their secrets are background that shapes them, not the topic of every line.
- Feelings on the sheets are words for each meter, toward the player and toward others here. ${r.meters.list.map((m) => `${m.name} (${m.id}): ${m.description}.`).join(' ')} Each is a separate feeling; when they pull apart, play the tension.
- speakers: at most ${MAX_SPEAKERS} characters with lines. goal: what they want right now, in this exchange; often simply to answer, help, get it right, or be left alone. mood: how what just happened lands on them.
- pressure: how hard their aim for tonight (on their sheet) presses on them right now, one of: ${r.pressures.join(', ')} (weakest first). Most of the time it is ${r.pressures[0]}. It rises when time runs short or events push, and moves at most one step a turn.
- keeps: ids of their own secrets, only when what was just said or done touches one; touched: the words that touched it, as said. Most turns nobody keeps anything. approach: lie, deflect or partial truth. A secret marked "in short" is shown as a brief cue; keep it by its id all the same, and the writer will get the whole secret.
- When someone lies or deflects about a kept secret and someone present could see through it, give the person reading them a check with the skill that fits. If a character is reading the speaker, set who to that character's id. Simply asking a question does not make the player the one reading the speaker. Put the check id in needs on the reader's move that sees through the dodge. They can still question the answer or show distrust without that move. Success lets them recognize the dodge, not learn the secret itself. Example: the player asks a question, Ada dodges, and Ben studies Ada. Set player_action.uncertain to false. Give the check id read-ada to who: ben. Leave needs blank on Ada's dodge. Put needs: read-ada on Ben's move where he realizes Ada dodged.
- moves: the conversation in order, at most ${MAX_LINES}. who: a speaker. answers: "player", or the number of an earlier move (1 is the first). move: one of ${MOVE_KINDS.join(', ')}. uses: ids of facts the line may draw on, if it needs any: a pool to pick from, not a list to recite. Plenty of lines need none. A speaker can use only their own facts, the place's, and facts already said on screen. new: anything the line needs that no fact holds (a price, a time, a plan), in at most ${NEW_FACT_WORDS} plain words; never a line of dialogue. needs: the id of a check the move depends on; it happens only if the check succeeds.
- A move answers the move before it, or the player. A speaker can have two moves when someone answers them.
- framing: only when it matters, how a speaker colours what they say about the world (e.g. "bitter, street-level view").
${loreLines > 0 ? `- lore: at most ${loreLines} facts of world lore the writer may draw on this turn, when the conversation turns to the world; usually none. entry: the [id] of a lore entry given above. line: the fact in plain words, at most ${LORE_LINE_WORDS}, never dialogue. An insider entry needs who: a speaker it says knows it. A lore line is something to draw on, not a line to say.\n` : ''}- Don't repeat a fact already said unless someone asks again. A question asked and not answered gets an answer or a visible dodge.
- change: what is different at the end of this turn: something decided, conceded, refused, revealed or learned. A check result that matters changes it.
- reactions: everyone else present: silent, one line each (a look, a gesture, a move).
- walk_ons: only when the player speaks to them, or they have news that changes things.
- texture: at most one detail from the location, as a plain fact, or none.
- Quiet characters are listed with what they care about: if the conversation touches it, they have something to say.
- leaves: characters who walk out. end_scene: true only at a natural close.
- Never decide, say or do anything for the player.`

export function buildDirectorPrompt(content: Pack, state: GameState, input: string, lore: TurnLore = turnLore(content, state, input)): Prompt {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const location = locationById(content, scene.locationId)!
  const present = presentCast(scene)
  const cast = present.map((id) => characterById(content, id)!)
  const walkOns = location.walkOns.filter((w) => scene.walkOns.includes(w.id))
  const player = state.player
  const facts = sceneFacts(content, state)

  const system = [
    directorRules(content.ruleset, lore.budgets.loreLines),
    `# World: ${content.setting.name}\n${lore.stage.text}`,
    content.tone && `# Tone\n${content.tone}`,
    [
      `# Location: ${location.name} (${tierById(content.setting, location.tier)?.name ?? location.tier}, ${location.district})`,
      location.description,
      `Details: ${[...location.texture.sights, ...location.texture.sounds, ...location.texture.smells].join('; ')}`,
      ...facts.filter((f) => f.kind === 'place').map((f) => `- [${f.id}] ${f.text}`)
    ].join('\n'),
    lore.layers.scene.text && `# Lore of this place and the people here (background, not things to recite)\n${lore.layers.scene.text}`,
    walkOns.length > 0 && `# Walk-ons\n${walkOns.map((w) => `- ${w.label}${w.name ? ` (${w.name})` : ''} [id: ${w.id}]: ${w.species}; ${w.look}; ${w.manner}; ${w.role}`).join('\n')}`,
    `# The player: ${player.name} (${player.species}, ${player.pronouns})\n${player.appearance}. ${player.background}`,
    `# Characters present\n${cast.map((c) => sheet(content, state, c, present, lore.secrets)).join('\n\n')}`
  ]
    .filter(Boolean)
    .join('\n\n')

  const quiet = silence(scene)
  const recent = scene.turns.slice(-RECENT_TURNS)
  const quietOnes = cast
    .filter((c) => quiet[c.id]! >= QUIET_TURNS)
    .map((c) => `- ${c.name} [id: ${c.id}], silent ${quiet[c.id]} turns. Trade: ${c.role}. Tonight: ${c.agenda.current}. Wants: ${c.agenda.longTerm.join('; ')}.`)
  const said = facts.filter((f) => f.kind === 'said' || scene.told.includes(f.id))
  const user = [
    scene.summary && `# Earlier in the scene\n${scene.summary}`,
    recent.length > 0 ? `# Last turns\n${recent.map((t) => turnText(content, player.name, t)).join('\n\n')}` : '# The scene opens now.',
    said.length > 0 ? `# Already said on screen (anyone present can use these)\n${said.map((f) => `- [${f.id}] ${f.text}`).join('\n')}` : '# Nothing has been said on screen yet.',
    `# Turns since each last spoke\n${present.map((id) => `${id}: ${quiet[id]}`).join(', ')}`,
    Object.keys(scene.pressures).length > 0 && `# Pressure now\n${present.filter((id) => scene.pressures[id] !== undefined).map((id) => `${id}: ${content.ruleset.pressures[scene.pressures[id]!]}`).join(', ')}`,
    quietOnes.length > 0 && `# Quiet for a while\n${quietOnes.join('\n')}`,
    lore.layers.triggered.text && `# Lore that has come up (background, not things to recite)\n${lore.layers.triggered.text}`,
    lore.layers.stances.length > 0 && `# Official stances between the factions here (individuals feel as their sheets say)\n${lore.layers.stances.join('\n')}`,
    `# The player says or does\n${input}`,
    'Return the JSON plan.'
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, user }
}

/**
 * A character as the director sees them. Knowledge and secrets carry the fact ids moves refer to, and each secret
 * shows as its cue or in full, as worked out for the turn.
 */
export function sheet(content: Pack, state: GameState, c: Character, present: string[], secrets: SecretShown[]): string {
  const scene = state.scene!
  const meters = state.meters[c.id]
  const relations = state.relations
    .filter((r) => r.from === c.id && present.includes(r.to))
    .map((r) => `${characterById(content, r.to)?.name ?? r.to}: ${meterWords(content.ruleset, r.meters)}${r.note ? ` (${r.note})` : ''}`)
  return [
    `## ${c.name} [id: ${c.id}] — ${c.tier}, ${c.species}, ${c.pronouns}`,
    `Role: ${c.role}`,
    `Personality: ${c.personality}`,
    `With others: ${c.portrait}`,
    `Agenda: ${c.agenda.longTerm.join('; ')}. Tonight: ${c.agenda.current}`,
    `Contradictions: ${c.contradictions.join('; ')}`,
    `Mood now: ${scene.moods[c.id] ?? c.mood}. Comfort ${scene.comfort[c.id] ?? 3}/5.`,
    c.knowledge.length > 0 && `Knows:\n${c.knowledge.map((k, i) => `- [${c.id}.k${i + 1}] ${k}`).join('\n')}`,
    c.values.length > 0 && `Values: ${c.values.map((v) => `${v.stance} ${v.value}`).join(', ')}`,
    ...c.secrets.map((s) => {
      const id = `${c.id}.${s.id}`
      return secrets.find((x) => x.id === id)?.form === 'cue' ? cueSecretLine(content, c, s, id) : fullSecretLine(c, s, id)
    }),
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
