import type { Ruleset } from '@engine/rules'
import { firstName, type Prompt } from '@engine/core'
import { characterById, type Pack } from '@engine/pack'
import type { GameState } from '@engine/state'
import type { Briefs } from './brief'
import { buildBriefs, directorContext, sceneSoFar, shadeNames } from './director'
import { gatherScene, type Gathered, type PoolFact } from './gather'
import { turnLore, type TurnLore } from './lore'
import { MAX_CHECKS, MAX_SPEAKERS, presentCast } from './planShape'
import { APPROACHES, MOMENT_WORDS } from './scenePlan'

/**
 * The `scene` pipeline's director: a game master, not a playwright (scene system redesign §4; Milestone 5 plan, task 2).
 * It sets up the moment and what's at stake and plans no lines: no order, no wording. What could press on each person
 * comes from the game (`gatherScene`), so it chooses among real options; the facts each may draw on are the game's pool.
 * Short rules and one example, in place of the situation director's long list (redesign §3, "examples over rules").
 */
export const sceneDirectorRules = (r: Ruleset): string => `You are the game master of a visual-novel RPG scene. A writer writes the scene; you set up the moment it comes out of. You don't write prose, dialogue, or the order of lines. Return JSON.

Return only this JSON object:
{
  "player_action": {"doing", "uncertain", "reading"},
  "checks": [{"id","who","skill","difficulty","target","stakes","edge","edge_reason"}],
  "focus": ["id"],
  "moments": [{"who","feels","lands","wants","pressure"}],
  "pressures": [{"who","kind","secret","with","touched","approach"}],
  "draws_on": [{"who","facts"}],
  "details": [{"who","text"}],
  "stakes": "...",
  "walk_ons": [{"id","line"}],
  "avoid": [], "leaves": [], "end_scene": false
}

- People are in the moment. What someone says and does comes first from what just happened: what was said to them, who is there, how they feel right now. Their aims, secrets and ties are part of them and press only when the moment touches them.
- player_action: what the player is doing, in plain words. uncertain: true only for an attempt whose outcome is in doubt (persuading, sneaking, climbing, fixing, studying someone closely). Talking and asking are not uncertain. reading: the id of the person the player is trying to read (watching their face, studying them, looking for a lie); leave it out otherwise. Asking a question is not reading.
- checks: only for an uncertain attempt by the player or a character, or someone reading another. At most ${MAX_CHECKS}. who is "player" or a character id. skill is one of: ${r.skills.map((x) => x.id).join(', ')}. difficulty is one of: ${r.difficulties.map((d) => d.word).join(', ')}; leave it out for a reading check, since the game sets it. target: the one being read. stakes: what success means.
- Seeing through someone: when a person in focus dodges or lies about a live secret, and "could see through" names someone below, give the first of them a ${r.skills.find((s) => s.id === r.people.reading.skill)?.name ?? r.people.reading.skill} check with the holder as target, unless the moment gives them no reason to look. Success means they notice the dodge, never what is hidden. The player reads only the person player_action.reading names.
- focus: who the moment is about, at most ${MAX_SPEAKERS}; usually whoever was spoken to and whoever would answer. Anyone else present may still react or say a little.
- moments: one for each person in focus. feels: what they really feel now, whatever they show: {"shade","family","intensity","reason"}; shade from the list below, family only when the shade is under more than one, intensity 1 to 5, reason in a few words. Leave it out to keep what they felt before. A mask hides a feeling and never lessens it; a feeling eases at most one step a turn. lands: how what just happened lands on them, in plain situational words. wants: what they want right now, in this exchange; often simply to answer, help, get it right, or be left alone. Each at most ${MOMENT_WORDS} words, never dialogue. pressure: how hard their aim for tonight presses now, one of: ${r.pressures.join(', ')} (weakest first); most of the time ${r.pressures[0]}; it moves at most one step a turn.
- pressures: at most one per person in focus, and usually none. Only from "What could press" below. kind is "secret" (secret: its id; approach: ${APPROACHES.join(', ')}; touched: the words that touched it), "tie" (with: the other person's id, or "player"), or "goal" (their aim for tonight, only above ${r.pressures[0]}). A pressure is an undercurrent: it shapes what they choose, avoid or notice, and is rarely what they talk about.
- draws_on: for a person in focus who needs a fact: ids from their list under "Facts they could draw on". A pool to choose from, not a list to recite; most turns need few.
- details: a concrete detail a person in focus will need that no listed fact holds (a price, a time, a place, a name), in a few plain words, never a line to say and never a secret. At most ${r.scene.details}; most turns need none.
- stakes: what this turn could settle or change, and what a check result would change. Not what will happen: the writer finds that in the moment.
- A plan gives nobody knowledge. Someone may ask about another's secret, guess, suspect or deny it; a secret is confirmed only by its holder, by someone who knows it, or by what is shown on screen.
- walk_ons: only when the player speaks to them, or they have news that changes things. leaves: characters who walk out. end_scene: true only at a natural close. avoid: phrases the writer should keep off, if any.
- Relationship tags (what people are to each other) change only after the scene, from what happened in it: play out a wedding, a breakup or a hiring, and never plan the tag change.
- Never decide, say or do anything for the player.
- Shades by family: ${shadeNames(r)}.

Example. The player asks Ada, a dock clerk, whether the night boat came in; Ben, who owes Ada money, is at the table. Nothing touches a secret.
{"player_action": {"doing": "asks Ada about the night boat", "uncertain": false}, "checks": [], "focus": ["ada", "ben"], "moments": [{"who": "ada", "lands": "a plain question about her own ledger; she likes being asked", "wants": "to get the time right", "pressure": "${r.pressures[0]}"}, {"who": "ben", "lands": "the boat means Ada will be paid tonight, and so will he be asked", "wants": "to stay out of it", "pressure": "${r.pressures[0]}"}], "pressures": [{"who": "ben", "kind": "tie", "with": "ada"}], "draws_on": [{"who": "ada", "facts": ["ada.k2"]}], "stakes": "whether the player learns when the boat docked, and whether Ben's debt comes up", "walk_ons": [], "avoid": [], "leaves": [], "end_scene": false}`

/** What the game gathered, for the director: what could press on each person, who could see through them, and what was live lately. */
function pressureLines(content: Pack, state: GameState, g: Gathered): string[] {
  const name = (id: string) => (id === 'player' ? state.player.name : (characterById(content, id)?.name ?? id))
  const first = (id: string) => (id === 'player' ? state.player.name : firstName(name(id)))
  return presentCast(state.scene!).flatMap((id) => {
    const o = g.options[id]
    if (!o) return []
    const parts = [`Aim for tonight (${o.goal.strength}): ${o.goal.text.replace(/[.\s]+$/, '')}`]
    for (const s of o.secrets) parts.push(`Secret [${s.id}], touched by "${s.by}"`)
    const readers = g.readers[id] ?? []
    if (readers.length > 0) parts.push(`Could see through ${first(id)}: ${readers.map((r) => `${first(r.who)} [${r.who}], who knows ${first(id)} (${r.knows.replace(/[.\s]+$/, '')})`).join('; then ')}`)
    if (o.ties.length > 0) parts.push(`Ties in play: ${o.ties.map((t) => `${first(t.with)} [${t.with}]${t.words ? ` (${t.words})` : ''}${t.how === 'named' ? ', not here, just named' : ''}`).join('; ')}`)
    const recent = g.recent[id] ?? []
    if (recent.length > 0) parts.push(`Live lately: ${recent.map((x) => (x.kind === 'tie' ? `tie to ${first(x.ref)}` : x.kind === 'secret' ? `secret [${x.ref}]` : 'aim')).join(', ')}`)
    return [`- ${name(id)} [${id}]. ${parts.join('. ')}.`]
  })
}

const factLine = (f: PoolFact) => `- [${f.id}] ${f.text}${f.unheard ? '' : ' (the player has heard this)'}`

/**
 * Each person's fact pool, by id, marked when the player has heard it. The place's news is anyone's, so it is listed
 * once rather than under every name (on the bar scene, four times).
 */
function poolLines(content: Pack, state: GameState, g: Gathered): string[] {
  const present = presentCast(state.scene!)
  const place = [...new Map(present.flatMap((id) => (g.pools[id] ?? []).filter((f) => f.source === 'place')).map((f) => [f.id, f])).values()]
  const own = present.flatMap((id) => {
    const pool = (g.pools[id] ?? []).filter((f) => f.source !== 'place')
    if (pool.length === 0) return []
    return [`${characterById(content, id)?.name ?? id} [${id}]:\n${pool.map(factLine).join('\n')}`]
  })
  return [...own, ...(place.length > 0 ? [`Anyone here (the place's news):\n${place.map(factLine).join('\n')}`] : [])]
}

/** What the bookkeeper recorded as changed last turn (Q4: the next turn's director reads it, for that turn only). */
function lastChanged(state: GameState): string | undefined {
  const changed = state.scene!.turns.at(-1)?.records?.changed?.trim()
  return changed || undefined
}

/** The scene director's prompt, from what the game gathered this turn. */
export function buildSceneDirectorPrompt(content: Pack, state: GameState, input: string, lore: TurnLore = turnLore(content, state, input), briefs: Briefs = buildBriefs(content, state, input, lore), gathered: Gathered = gatherScene(content, state, input, lore, briefs)): Prompt {
  if (!state.scene) throw new Error('No scene in progress')
  const system = [sceneDirectorRules(content.ruleset), ...directorContext(content, state, lore, briefs)].join('\n\n')
  const so = sceneSoFar(content, state, lore)
  const changed = lastChanged(state)
  const pools = poolLines(content, state, gathered)
  const user = [
    ...so.before,
    changed && `# Last turn changed\n${changed}`,
    ...so.after,
    `# What could press on each person this turn (at most one each; usually none)\n${pressureLines(content, state, gathered).join('\n')}`,
    pools.length > 0 ? `# Facts they could draw on (ids for draws_on)\n${pools.join('\n\n')}` : '# Facts they could draw on: none this turn.',
    `# The player says or does\n${input}`,
    'Return the JSON plan.'
  ]
    .filter(Boolean)
    .join('\n\n')
  return { system, user }
}
