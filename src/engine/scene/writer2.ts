import type { Prompt } from '@engine/core'
import { firstName } from '@engine/core'
import type { GameState } from '@engine/state'
import { characterById, locationById, type Pack } from '@engine/pack'
import { RECENT_TURNS, turnText } from './director'
import { sceneFacts } from './facts'
import type { BeatPlan, Move } from './plan'
import { ADULTS_ONLY, BEATS } from './style'
import { checkLine, voiceCard } from './writer'
import { recentlyUsed } from './repeats'
import { writerStage } from '@engine/codex'

/**
 * How the conversation should read (director-writer review, option B). A few principles and one example in place of
 * a long rule list: what code checks (who knows what, what's new to the player, who may speak) arrives as data in
 * the brief instead. Examples use made-up people, as engine text must.
 */
export const WRITER2_STYLE = `How it should read:
- People talk like people: complete, plain sentences that someone hearing them for the first time can follow.
- Each line answers the line before it: what that person actually said and meant. A question gets an answer, or a dodge the reader can see, in its own terms.
- People are in the moment. Their aims and secrets show in what they choose, avoid or notice, rarely in what they say outright.
- A move's facts are there to draw on if the line needs them, never to recite. A line can bring nothing new; what matters is that it answers. A fact marked new hasn't been said to the player yet: if it's used, say what it is.
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
    writerStage(content.tone, content.codex).text,
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
  // A fact already said is marked, so it isn't said again in other words (session 2026-11-07_1949_ffec: "a crew is on
  // its way" three times, "five minutes" four).
  const said = (m: Move) => m.says.map((s) => `${s.text} ${s.unheard ? '[new to the player]' : "[already said; don't repeat it]"}`).join('; ')
  // An aim reaches the writer only when it presses (claude/scene-system-redesign.md §5.3): the weakest word keeps it out.
  const words = content.ruleset.pressures
  const aim = (id: string, pressure?: string) => {
    const level = pressure ? words.indexOf(pressure) : 0
    const goal = characterById(content, id)?.agenda.current
    if (!goal || level <= 0) return ''
    return level >= words.length - 1 ? ` Tonight's aim drives what they do: ${goal}.` : ` Tonight's aim is on their mind and may come up if it fits: ${goal}.`
  }
  const speakerLine = (s: BeatPlan['speakers'][number]) =>
    [
      `- ${nameOf(s.id)}: in this exchange, ${(s.intent || 'answer what was asked').replace(/[.\s]+$/, '')}. Mood: ${(s.mood || 'as before').replace(/[.\s]+$/, '')}.`,
      aim(s.id, s.pressure),
      s.hiding && ` Keeping to themselves: ${s.hiding} (${s.approach ?? 'deflect'}).${s.tell ? ` It shows only as: ${s.tell}. Show it; nobody remarks on it unless their check to read them succeeded.` : ' It doesn\'t show.'}`
    ].join('')
  const recent = Object.entries(recentlyUsed(content, scene)).map(([id, u]) =>
    `- ${nameOf(id)}: ${[...u.slang.map((t) => `"${t}"`), ...u.gestures].join('; ')}`
  )

  const user = [
    `# Where you are\n${location.name}. ${location.description}`,
    told.length > 0 ? `# What the player has been told this scene\n${told.map((f) => `- ${f.text}`).join('\n')}` : '# What the player has been told this scene\nNothing yet beyond what they can see.',
    scene.summary && `# Earlier in the scene\n${scene.summary}`,
    scene.turns.length > 0 && `# Last turns\n${scene.turns.slice(-RECENT_TURNS).map((t) => turnText(content, state.player.name, t)).join('\n\n')}`,
    `# The player says or does\n${input}`,
    plan.checks.some((c) => c.result) && `# Check results (decided; honor them)\n${plan.checks.filter((c) => c.result).map((c) => checkLine(content, state, c)).join('\n')}`,
    plan.speakers.length > 0 && `# Who speaks\n${plan.speakers.map(speakerLine).join('\n')}`,
    moves.length > 0 && `# The conversation, in order\n${moves.map((m, i) => `${i + 1}. ${nameOf(m.who)}, answering ${answering(m)}: ${m.move}${m.says.length > 0 ? ` (may draw on: ${said(m)})` : ''}${m.needs ? ' (the check succeeded)' : ''}`).join('\n')}`,
    plan.change && `# By the end of the turn\n${plan.change}`,
    plan.reactions.length > 0 && `# Also present, silent\n${plan.reactions.map((r) => `- ${nameOf(r.id)}: ${r.beat}`).join('\n')}`,
    plan.walk_ons.length > 0 && `# Walk-ons\n${plan.walk_ons.map((w) => `- ${nameOf(w.id)}: ${w.line}`).join('\n')}`,
    plan.texture.length > 0 && `# A detail of the place, if it fits\n${plan.texture.join('\n')}`,
    recent.length > 0 && `# Used in the last turns (don't repeat)\n${recent.join('\n')}`,
    plan.avoid.length > 0 && `# Avoid\n${plan.avoid.join('; ')}`,
    'Write the beats.'
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, user }
}
