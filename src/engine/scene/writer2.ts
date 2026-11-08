import type { Prompt } from '@engine/core'
import { firstName } from '@engine/core'
import type { GameState } from '@engine/state'
import { characterById, locationById, type Pack } from '@engine/pack'
import { RECENT_TURNS, turnText } from './director'
import { sceneFacts } from './facts'
import type { BeatPlan, Move } from './plan'
import { ADULTS_ONLY, BEATS } from './style'
import { checkLine, voiceCard } from './writer'

/**
 * How the conversation should read (director-writer review, option B). A few principles and one example in place of
 * a long rule list: what code checks (who knows what, what's new to the player, who may speak) arrives as data in
 * the brief instead. Examples use made-up people, as engine text must.
 */
export const WRITER2_STYLE = `How it should read:
- People talk like people: complete, plain sentences that someone hearing them for the first time can follow.
- Each line answers the line before it: what that person actually said and meant. A question gets an answer, or a dodge the reader can see, in its own terms.
- Each line says what its move holds, in the speaker's own voice, and nothing more. What is marked new hasn't been said to the player yet: say what it is.
- Each character sounds like their voice card. The card wins over everything else.
- Narration only for what happens: an action that matters, a reaction, at most one detail of the place. Show what can be seen; never write the plan's notes out as prose.
- No sayings, maxims or riddles in place of an answer. A comparison only when it makes something clearer.
- The player is "you", in the present tense. A check result for the player is what you notice, manage or fail to.

Too clipped: Ada: "Mill. Bell's at six. Gate's a gate."
Better: Ada: "I work the night line at the mill, and the bell goes at six. If I'm not through that gate by then, I lose the shift."`

export const WRITER2_FORMAT = `Output format, nothing else:
- One beat per line: a dialogue beat, Name: "spoken words" (first name; only the words said), or a narration beat, NARRATION: … (everything that isn't spoken; a character's action names them).
- Each move is one dialogue beat by its speaker, in the order given. Narration goes between them only when something happens.
- ${BEATS.target} beats, each under ${BEATS.targetWords} words.
- Only the speakers and planned walk-ons speak. Everyone else stays silent: no quoted or reported speech.
- Hidden tags at the end, one per line: [Name: EXPRESSION word] for each speaker; [Name: COMFORT 1-5 reason] when someone's comfort changes; [Name: MOOD words] when a mood shifts; [LEAVES: Name] for a planned departure; [END SCENE] only if the plan ends the scene.
- Never write the player's words, choices, thoughts or actions beyond what their input stated.
- Honor every check result exactly: a failed roll means it does not happen.`

/** The writer's brief for a situation plan: the facts in play as facts, the moves as moves, and nothing in planner prose. */
export function buildWriter2Prompt(content: Pack, state: GameState, plan: BeatPlan, input: string): Prompt {
  const scene = state.scene!
  const location = locationById(content, scene.locationId)!
  const nameOf = (id: string) => {
    const c = characterById(content, id)
    if (c) return firstName(c.name)
    const w = location.walkOns.find((x) => x.id === id)
    return w?.name ?? w?.label ?? id
  }
  const speakers = plan.speakers.map((s) => characterById(content, s.id)!)

  const system = [
    "You write one turn of a visual-novel RPG scene from a director's plan: the conversation and what happens.",
    WRITER2_STYLE,
    content.tone && `Tone:\n${content.tone}`,
    ADULTS_ONLY,
    WRITER2_FORMAT,
    `The player is ${state.player.name} (${state.player.pronouns}), addressed as "you".`,
    ...speakers.map((c) => voiceCard(firstName(c.name), c.voice, c.portrait))
  ]
    .filter(Boolean)
    .join('\n\n')

  const facts = sceneFacts(content, state)
  const told = facts.filter((f) => f.kind === 'said' || scene.told.includes(f.id))
  // A plan without moves (the game planned the turn itself) still has its lines in the exchange.
  const moves: Move[] = plan.moves ?? plan.exchange.map((l) => ({ who: l.who, answers: l.answers, move: 'answer', says: [{ text: l.point, unheard: false }] }))
  const answering = (m: Move) => (m.answers === 'player' ? 'the player' : `${m.answers} (${nameOf(moves[m.answers - 1]?.who ?? '')})`)
  const said = (m: Move) => m.says.map((s) => (s.unheard ? `${s.text} [new to the player]` : s.text)).join('; ')
  const secrets = (id: string) => characterById(content, id)?.secrets ?? []

  const user = [
    `# Where you are\n${location.name}. ${location.description}`,
    told.length > 0 ? `# What the player has been told this scene\n${told.map((f) => `- ${f.text}`).join('\n')}` : '# What the player has been told this scene\nNothing yet beyond what they can see.',
    scene.summary && `# Earlier in the scene\n${scene.summary}`,
    scene.turns.length > 0 && `# Last turns\n${scene.turns.slice(-RECENT_TURNS).map((t) => turnText(content, state.player.name, t)).join('\n\n')}`,
    `# The player says or does\n${input}`,
    plan.checks.some((c) => c.result) && `# Check results (decided; honor them)\n${plan.checks.filter((c) => c.result).map((c) => checkLine(content, state, c)).join('\n')}`,
    plan.speakers.length > 0 &&
      `# Who speaks\n${plan.speakers
        .map((s) => {
          const tells = s.hiding ? secrets(s.id).filter((x) => s.hiding!.includes(x.text)).map((x) => x.tell) : []
          return [`- ${nameOf(s.id)}: wants this exchange to ${s.intent || 'answer what was asked'}. Mood: ${s.mood || 'as before'}.`, s.hiding && ` Keeping to themselves: ${s.hiding} (${s.approach ?? 'deflect'}).${tells.length > 0 ? ` It shows only as: ${tells.join('; ')}.` : ''}`]
            .filter(Boolean)
            .join('')
        })
        .join('\n')}`,
    moves.length > 0 && `# The conversation, in order\n${moves.map((m, i) => `${i + 1}. ${nameOf(m.who)}, answering ${answering(m)}: ${m.move}: ${said(m)}`).join('\n')}`,
    plan.change && `# By the end of the turn\n${plan.change}`,
    plan.reactions.length > 0 && `# Also present, silent\n${plan.reactions.map((r) => `- ${nameOf(r.id)}: ${r.beat}`).join('\n')}`,
    plan.walk_ons.length > 0 && `# Walk-ons\n${plan.walk_ons.map((w) => `- ${nameOf(w.id)}: ${w.line}`).join('\n')}`,
    plan.texture.length > 0 && `# A detail of the place, if it fits\n${plan.texture.join('\n')}`,
    plan.avoid.length > 0 && `# Avoid\n${plan.avoid.join('; ')}`,
    'Write the beats.'
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, user }
}
