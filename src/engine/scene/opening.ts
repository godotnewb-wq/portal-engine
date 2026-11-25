import { writerStage } from '@engine/codex'
import { firstName, traced, TracedError, type CallTrace, type Prompt } from '@engine/core'
import { characterById, locationById, type Pack } from '@engine/pack'
import type { Beat, GameState } from '@engine/state'
import { parseReply, type ParsedReply } from './beats'
import { loreProblems } from './checks'
import { childGuard } from './guard'
import { presentCast } from './planShape'
import { OVERUSED_PHRASES } from './style'
import type { TurnLlm } from './runTurn'
import { buildRewritePrompt, sceneSpeakers } from './writer'

/**
 * The scene's opening (Milestone 5 task 8, decided 2026-11-24, user): an establishing shot written when a scene opens,
 * before the player's first input. Without one, the director and the writer each guessed from a blank start where
 * everyone was, and disagreed (a fixer in her booth for one, at the bar for the other), so people overheard what they
 * couldn't and joined conversations they weren't in. The opening says where everyone is and what they're doing; the
 * player sees it as the scene's first narration, and both calls read it every turn. Narration only (user): a line of
 * speech before the player has said anything would start a conversation for them. Always generated, from the place
 * and the cards, so it works for any place and cast. One call, and one rewrite if a check fails; outside the turn's
 * call budget, since no turn is running.
 */
export const OPENING_STYLE = `You write the opening of a scene in a visual-novel RPG: the establishing shot as the player arrives, before anyone speaks.

How it should read:
- 2 to 4 lines of narration, and nothing else: nobody speaks.
- Say where each person present is and what they're doing, so a reader knows who is near whom and who could hear whom. People who came together are together; someone on their own business may be apart, where their card puts them.
- The player has just arrived, with anyone in their party. Say where they are, and nothing more for them: no words, choices, thoughts or actions.
- One or two details of the place, from its own details.
- What people show is only what anyone could see: no one's secrets, aims or hidden feelings.
- Each line is a whole sentence that names who it's about. The player is "you", in the present tense.
- Only this world's names.

Output format, nothing else: one line per beat, each starting NARRATION:

For example:
NARRATION: The kettle ticks on the stove, and the yard office smells of wet coats.
NARRATION: Ada is at the counter with the ledger open, and Ben sits by the door with his cap on his knee.
NARRATION: You come in from the rain with Cole at your shoulder.`

export interface OpeningTrace {
  sceneId: string
  at: string
  /** The narration kept, as shown. */
  beats: Beat[]
  /** Lines the reply had that weren't narration, left out. */
  dropped: number
  /** What the checks found in the draft, which the one rewrite was asked to fix. */
  findings: string[]
  calls: CallTrace[]
}

/** The opening's brief: the place, then who is here, what they are and where their card puts them. */
export function buildOpeningPrompt(content: Pack, state: GameState): Prompt {
  const scene = state.scene!
  const location = locationById(content, scene.locationId)!
  const t = location.texture
  const details = [...t.sights, ...t.sounds, ...t.smells]
  const party = state.party.filter((id) => presentCast(scene).includes(id))
  const person = (id: string) => {
    const c = characterById(content, id)!
    return `- ${firstName(c.name)}${party.includes(id) ? ' (came with you)' : ''}: ${c.role}. ${c.appearance}`
  }
  const walkOns = location.walkOns.filter((w) => scene.walkOns.includes(w.id))
  const system = [
    OPENING_STYLE,
    `Never write these: ${[...OVERUSED_PHRASES, ...content.phrases].map((x) => `"${x}"`).join(', ')}.`,
    writerStage(content.tone, content.codex).text,
    `The player is ${state.player.name} (${state.player.pronouns}), addressed as "you": ${state.player.appearance}.`,
    childGuard(content, state)
  ]
    .filter(Boolean)
    .join('\n\n')
  const user = [
    `# Where you are\n${location.name}. ${location.description}`,
    details.length > 0 && `# The place's details (use one or two)\n${details.map((d) => `- ${d}`).join('\n')}`,
    `# Who is here\n${presentCast(scene).map(person).join('\n')}`,
    // The walk-on as anyone would see them, not only their label (2026-11-24 play: a card player given the wrong sex).
    walkOns.length > 0 && `# Also around (not by name)\n${walkOns.map((w) => `- ${w.label}: ${w.look}`).join('\n')}`,
    'Write the opening.'
  ]
    .filter(Boolean)
    .join('\n\n')
  return { system, user }
}

/** What the opening's checks find: speech, nothing kept, a wrong or invented name, an overused phrase. */
function openingProblems(content: Pack, state: GameState, parsed: ParsedReply): string[] {
  const problems: string[] = []
  const narration = parsed.beats.filter((b) => b.kind === 'narration')
  if (narration.length === 0) problems.push('Write 2 to 4 NARRATION: lines.')
  if (parsed.beats.some((b) => b.kind === 'dialogue')) problems.push('Nobody speaks in the opening: narration only.')
  narration.forEach((b, i) => {
    const lower = b.text.toLowerCase()
    for (const phrase of [...OVERUSED_PHRASES, ...content.phrases]) {
      if (phrase.trim().length >= 4 && lower.includes(phrase.toLowerCase())) problems.push(`Line ${i + 1} uses "${phrase}". Say it another, specific way.`)
    }
  })
  return [...problems, ...loreProblems(content, state, { ...parsed, beats: narration }).map((p) => p.fix)]
}

/**
 * Writes the opening of the scene in progress and puts it on the scene. A scene that already has an opening, or turns,
 * is left as it is. A reply with no narration after its rewrite leaves the scene without one (the app then shows its
 * plain opening), and the trace says so. A failed call throws a `TracedError` with the calls made.
 */
export async function establishScene(
  content: Pack,
  state: GameState,
  write: TurnLlm['write'],
  emit: (text: string) => void = () => {},
  now: () => number = Date.now
): Promise<{ state: GameState; beats: Beat[]; trace: OpeningTrace }> {
  const scene = state.scene
  if (!scene) throw new Error('No scene in progress')
  const at = new Date(now()).toISOString()
  if (scene.opening || scene.turns.length > 0) return { state, beats: scene.opening ?? [], trace: { sceneId: scene.id, at, beats: scene.opening ?? [], dropped: 0, findings: [], calls: [] } }
  const calls: CallTrace[] = []
  const speakers = sceneSpeakers(content, state)
  // Both calls have the role `opening`, so a turn's counts (rewrites among them) never include them.
  const call = (part: 'opening' | 'opening-rewrite', prompt: Prompt) =>
    traced(calls, { id: `${scene.id}:${part}`, role: 'opening', sceneId: scene.id }, prompt, now, (hooks) =>
      write(prompt, (text) => (hooks.first(), emit(text)), () => hooks.restart())
    )
  try {
    const prompt = buildOpeningPrompt(content, state)
    const draft = await call('opening', prompt)
    let parsed = parseReply(draft, speakers, { script: true })
    const findings = openingProblems(content, state, parsed)
    if (findings.length > 0) parsed = parseReply(await call('opening-rewrite', buildRewritePrompt(prompt, draft, findings)), speakers, { script: true })
    const kept = parsed.beats.filter((b) => b.kind === 'narration')
    const trace: OpeningTrace = { sceneId: scene.id, at, beats: kept, dropped: parsed.beats.length - kept.length, findings, calls }
    if (kept.length === 0) return { state, beats: [], trace }
    return { state: { ...state, scene: { ...scene, opening: kept } }, beats: kept, trace }
  } catch (error) {
    if (error instanceof TracedError) throw error
    throw new TracedError((error as Error).message, calls)
  }
}
