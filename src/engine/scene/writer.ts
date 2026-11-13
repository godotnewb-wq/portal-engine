import type { Prompt } from '@engine/core'
import { firstName } from '@engine/core'
import { tagWord, type VoiceCard } from '@engine/characters'
import type { GameState } from '@engine/state'
import type { Degree } from '@engine/rules'
import { characterById, locationById, type Pack } from '@engine/pack'
import type { Speaker } from './beats'
import { RECENT_TURNS, turnText } from './director'
import { sceneFacts } from './facts'
import { childGuard } from './guard'
import { presentCast, type BeatPlan, type Move, type PlannedCheck } from './planShape'
import { BEATS } from './style'
import { recentlyUsed } from './repeats'
import { writerStage } from '@engine/codex'

/** Everyone a beat or tag may name in this scene: the cast present, the walk-ons, and the player. */
export function sceneSpeakers(content: Pack, state: GameState): Speaker[] {
  const scene = state.scene!
  const location = locationById(content, scene.locationId)!
  const cast = presentCast(scene).map((id): Speaker => {
    const c = characterById(content, id)!
    return { id, names: [c.id, c.name, firstName(c.name)], kind: 'cast', display: firstName(c.name) }
  })
  const walkOns = location.walkOns
    .filter((w) => scene.walkOns.includes(w.id))
    .map((w): Speaker => ({ id: w.id, names: [w.id, w.label, w.label.replace(/^the\s+/i, ''), ...(w.name ? [w.name] : [])], kind: 'walk-on', display: w.name ?? w.label }))
  const player: Speaker = { id: 'player', names: [state.player.name, 'you', 'player'], kind: 'player' }
  return [...cast, ...walkOns, player]
}


/**
 * How the conversation should read (director writer review, option B). A few principles and one example in place of
 * a long rule list: what code checks (who knows what, what's new to the player, who may speak) arrives as data in
 * the brief instead. Examples use made-up people, as engine text must.
 */
export const WRITER_STYLE = `How it should read:
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

export const WRITER_FORMAT = `Output format, nothing else:
- One beat per line: a dialogue beat, Name: "spoken words" (first name; only the words said), or a narration beat, NARRATION: … (everything that isn't spoken; a character's action names them).
- Each move is one dialogue beat by its speaker, in the order given. Narration goes between them only when something happens.
- ${BEATS.target} beats, each under ${BEATS.targetWords} words.
- Only the speakers and planned walk-ons speak. Everyone else stays silent: no quoted or reported speech.
- Hidden tags at the end, one per line: [Name: EXPRESSION word] for each speaker; [Name: COMFORT 1-5 reason] when someone's comfort changes; [Name: MOOD words] when a mood shifts; [LEAVES: Name] for a planned departure; [END SCENE] only if the plan ends the scene.
- Never write the player's words, choices, thoughts or actions beyond what their input stated.
- Honor every check result exactly: a failed roll means it does not happen.`

/** "Ada", "Ada and Ben", "Ada, Ben and Cy". */
const listed = (names: string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** The writer's brief: the facts in play as facts, the moves as moves, and nothing in planner prose. */
export function buildWriterPrompt(content: Pack, state: GameState, plan: BeatPlan, input: string): Prompt {
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
    WRITER_STYLE,
    writerStage(content.tone, content.codex).text,
    WRITER_FORMAT,
    `The player is ${state.player.name} (${state.player.pronouns}), addressed as "you".`,
    ...speakers.map((c) => voiceCard(firstName(c.name), c.voice, c.portrait)),
    childGuard(content, state)
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
  // An aim reaches the writer only when it presses (scene system redesign.md §5.3): the weakest word keeps it out.
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
      s.framing ? ` What they say about the world comes with this view: ${s.framing.replace(/[.\s]+$/, '')}.` : '',
      aim(s.id, s.pressure),
      s.hiding && ` Keeping to themselves: ${s.hiding} (${s.approach ?? 'deflect'}).${s.tell ? ` It shows only as: ${s.tell}. Show it; nobody remarks on it unless their check to read them succeeded.` : ' It doesn\'t show.'}`
    ].join('')
  const ties = speakerTies(content, state, plan)
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
    ties.length > 0 && `# How the speakers stand with the others here (facts about them, not how to play them)\n${ties.join('\n')}`,
    moves.length > 0 && `# The conversation, in order\n${moves.map((m, i) => `${i + 1}. ${nameOf(m.who)}, answering ${answering(m)}: ${m.move}${m.says.length > 0 ? ` (may draw on: ${said(m)})` : ''}${m.needs ? ' (the check succeeded)' : ''}`).join('\n')}`,
    plan.lore && plan.lore.length > 0 && `# About the world, to draw on only if it fits (some, all or none; never recite)\n${plan.lore.map((l) => `- ${l.line}${l.who ? ` (only ${nameOf(l.who)} would say this)` : ''}`).join('\n')}`,
    plan.change && `# By the end of the turn\n${plan.change}`,
    plan.leaves.length > 0 && `# Leaving this turn\n${listed(plan.leaves.map(nameOf))} ${plan.leaves.length === 1 ? 'leaves' : 'leave'}. Show them going.`,
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

/**
 * This turn's speakers toward the others present and toward the player (relationships §3, director writer §7): the
 * tags in the card's words and, between two speakers or toward the player, the line of history, so delivery fits who they are to each other. No meter bands (the
 * plan carries how they feel) and no private tags: the director has no way to keep one yet, so none reaches the writer.
 */
export function speakerTies(content: Pack, state: GameState, plan: BeatPlan): string[] {
  const r = content.ruleset
  const present = new Set(presentCast(state.scene!))
  const name = (id: string) => firstName(characterById(content, id)?.name ?? id)
  const line = (from: string, to: string, tags: { tag: string; word?: string; private?: boolean }[], note?: string) => {
    const words = tags.filter((t) => !t.private).map((t) => tagWord(r, t))
    return words.length > 0 || note ? [`- ${from} → ${to}: ${[words.join(', '), note].filter(Boolean).join('; ')}`] : []
  }
  const speaking = new Set(plan.speakers.map((s) => s.id))
  return plan.speakers.flatMap((s) => {
    const toPlayer = state.playerTies[s.id]
    return [
      ...(toPlayer ? line(name(s.id), 'you', toPlayer.tags, toPlayer.note) : []),
      // The history line only between two people speaking this turn; toward a silent bystander, what they are is enough.
      ...state.relations.filter((x) => x.from === s.id && present.has(x.to)).flatMap((x) => line(name(s.id), name(x.to), x.tags, speaking.has(x.to) ? x.note : undefined))
    ]
  })
}

/** A speaker as the writer sees them: the person first, then how they talk. */
export function voiceCard(name: string, v: VoiceCard, portrait?: string): string {
  return [
    portrait ? `## ${name}\n${portrait}\n\n### ${name}'s voice` : `## ${name}'s voice`,
    `Rhythm: ${v.rhythm}`,
    `Vocabulary: ${v.vocabulary}`,
    v.slang.length > 0 && `Words they might use, rarely: ${v.slang.join(', ')}`,
    v.avoids.length > 0 && `Avoids: ${v.avoids.join('; ')}`,
    `Sample lines: ${v.sampleLines.map((l) => `"${l}"`).join(' ')}`,
    `When angry: ${v.shifts.angry}. Warm: ${v.shifts.warm}. Lying: ${v.shifts.lying}.${v.shifts.afraid ? ` Afraid: ${v.shifts.afraid}.` : ''}`
  ]
    .filter(Boolean)
    .join('\n')
}

const OUTCOME: Record<Degree, (stakes: string) => string> = {
  strong: (s) => `strong success: ${s}, with an extra benefit`,
  success: (s) => `success: ${s}`,
  cost: (s) => `success at a cost: ${s}, but add a complication`,
  failure: (s) => `FAILURE: this does not happen: ${s}`
}

export function checkLine(content: Pack, state: GameState, check: PlannedCheck): string {
  const who = check.who === 'player' ? state.player.name : firstName(characterById(content, check.who)!.name)
  return `- ${who}'s ${check.skill} check [${check.id}]: ${check.result ? OUTCOME[check.result.degree](check.stakes) : check.stakes}`
}

/** The one targeted rewrite (call 3), told exactly what to fix. */
export function buildRewritePrompt(writer: Prompt, reply: string, problems: string[]): Prompt {
  return {
    system: writer.system,
    user: `${writer.user}\n\n# Your draft\n${reply}\n\n# Fix these, change nothing else, and return the whole turn in the same format\n${problems.map((p) => `- ${p}`).join('\n')}`
  }
}
