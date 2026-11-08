import type { Prompt } from '@engine/core'
import type { GameState } from '@engine/state'
import type { Ruleset } from '@engine/rules'
import { characterById, locationById, type Pack } from '@engine/pack'
import { tierById } from '@engine/world'
import { RECENT_TURNS, sheet, turnText } from './director'
import { sceneFacts } from './facts'
import { MAX_CHECKS, MAX_LINES, MAX_SPEAKERS, QUIET_TURNS, presentCast, silence } from './plan'
import { MOVE_KINDS, NEW_FACT_WORDS } from './plan2'
import { ADULTS_ONLY } from './style'

/**
 * The situation director's rules (director-writer review, option B). It plans what is true, wanted and at stake, as
 * choices and fact ids, and writes no prose and no dialogue. Short on purpose: what code can check (who knows what,
 * what's been said, who may speak) is checked in code, not asked for here.
 */
export const director2Rules = (r: Ruleset): string => `You are the director of a visual-novel RPG scene. You don't write prose or dialogue. You decide what happens this turn and return JSON; a writer turns it into the scene.

Return only this JSON object:
{
  "player_action": {"doing", "uncertain"},
  "checks": [{"id","who","skill","difficulty","stakes","assist","edge","edge_reason"}],
  "speakers": [{"id","goal","mood","pressure","keeps","touched","approach"}],
  "moves": [{"who","answers","move","uses","new","needs"}],
  "change": "...",
  "reactions": [{"id","beat"}],
  "walk_ons": [{"id","line"}],
  "texture": [], "avoid": [], "leaves": [], "end_scene": false
}

- The player leads. Start from what the player just said or did: move 1 answers it, in its own terms. A character's own aims come in after that, or in a later turn, unless something urgent cuts in.
- player_action: what the player is doing, in plain words. uncertain: true only for an attempt whose outcome is in doubt (persuading, sneaking, climbing, fixing, studying someone closely). Talking and asking are not uncertain.
- checks: only for an uncertain player action, or a character attempting something uncertain. The skill fits the action. At most ${MAX_CHECKS}. who is "player" or a character id. skill is one of: ${r.skills.map((x) => x.id).join(', ')}. difficulty is one of: ${r.difficulties.map((d) => d.word).join(', ')}. stakes says what success means. assist: a character present who helps.
- People are in the moment. What they say comes first from what was just said and done: they answer, notice, react. Their aims for the night and their secrets are background that shapes them, not the topic of every line.
- speakers: at most ${MAX_SPEAKERS} characters with lines. goal: what they want right now, in this exchange; often simply to answer, help, get it right, or be left alone. mood: how what just happened lands on them.
- pressure: how hard their aim for tonight (on their sheet) presses on them right now, one of: ${r.pressures.join(', ')} (weakest first). Most of the time it is ${r.pressures[0]}. It rises when time runs short or events push, and moves at most one step a turn.
- keeps: ids of their own secrets, only when what was just said or done touches one; touched: the words that touched it, as said. Most turns nobody keeps anything. approach: lie, deflect or partial truth.
- When someone lies or deflects about a kept secret and someone present could see through it, give that person a check to read them (the skill that fits). Their noticing is a move that needs that check.
- moves: the conversation in order, at most ${MAX_LINES}. who: a speaker. answers: "player", or the number of an earlier move (1 is the first). move: one of ${MOVE_KINDS.join(', ')}. uses: ids of facts the line may draw on, if it needs any: a pool to pick from, not a list to recite. Plenty of lines need none. A speaker can use only their own facts, the place's, and facts already said on screen. new: anything the line needs that no fact holds (a price, a time, a plan), in at most ${NEW_FACT_WORDS} plain words; never a line of dialogue. needs: the id of a check the move depends on; it happens only if the check succeeds.
- A move answers the move before it, or the player. A speaker can have two moves when someone answers them.
- Don't repeat a fact already said unless someone asks again. A question asked and not answered gets an answer or a visible dodge.
- change: what is different at the end of this turn: something decided, conceded, refused, revealed or learned. A check result that matters changes it.
- reactions: everyone else present: silent, one line each (a look, a gesture, a move).
- walk_ons: only when the player speaks to them, or they have news that changes things.
- texture: at most one detail from the location, as a plain fact, or none.
- Quiet characters are listed with what they care about: if the conversation touches it, they have something to say.
- leaves: characters who walk out. end_scene: true only at a natural close.
- Never decide, say or do anything for the player.`

export function buildDirector2Prompt(content: Pack, state: GameState, input: string): Prompt {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const location = locationById(content, scene.locationId)!
  const present = presentCast(scene)
  const cast = present.map((id) => characterById(content, id)!)
  const walkOns = location.walkOns.filter((w) => scene.walkOns.includes(w.id))
  const player = state.player
  const facts = sceneFacts(content, state)

  const system = [
    director2Rules(content.ruleset),
    `# World: ${content.setting.name}\n${content.primer}\n${ADULTS_ONLY}`,
    content.tone && `# Tone\n${content.tone}`,
    [
      `# Location: ${location.name} (${tierById(content.setting, location.tier)?.name ?? location.tier}, ${location.district})`,
      location.description,
      `Details: ${[...location.texture.sights, ...location.texture.sounds, ...location.texture.smells].join('; ')}`,
      ...facts.filter((f) => f.kind === 'place').map((f) => `- [${f.id}] ${f.text}`)
    ].join('\n'),
    walkOns.length > 0 && `# Walk-ons\n${walkOns.map((w) => `- ${w.label}${w.name ? ` (${w.name})` : ''} [id: ${w.id}]: ${w.species}; ${w.look}; ${w.manner}; ${w.role}`).join('\n')}`,
    `# The player: ${player.name} (${player.species}, ${player.pronouns})\n${player.appearance}. ${player.background}`,
    `# Characters present\n${cast.map((c) => sheet(content, state, c, present, true)).join('\n\n')}`
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
    `# The player says or does\n${input}`,
    'Return the JSON plan.'
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, user }
}
