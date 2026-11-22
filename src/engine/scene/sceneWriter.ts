import { knows, writerStage } from '@engine/codex'
import { firstName, type Prompt } from '@engine/core'
import { characterById, knowerOf, locationById, type Pack } from '@engine/pack'
import type { Degree } from '@engine/rules'
import type { GameState, Scene } from '@engine/state'
import type { ParsedReply } from './beats'
import type { Problem } from './checks'
import { RECENT_TURNS, turnText } from './director'
import { canSay, sceneFacts } from './facts'
import { feelingsNow, feltWords, shown, shownWords } from './feelings'
import { childGuard } from './guard'
import { knowersOf } from '@engine/memory'
import { presentCast, type BeatPlan, type PlannedCheck } from './planShape'
import { RECENT_USE_TURNS, recentlyUsed } from './repeats'
import type { LivePressure } from './scenePlan'
import { FUNCTION_WORDS, OWNED_PHRASE_WORDS, plainWords, runs } from './phrases'
import { SCENE_LENGTH } from './style'
import { claimLines, knowledgeLines, speakerTies, voiceCard } from './writer'

/**
 * The `scene` pipeline's writer: the scene's author (scene system redesign §4, §6; Milestone 5 plan, task 3). It writes
 * the turn as one continuous short scene in a light script form, from the people present, each one's moment, what
 * presses on them as undercurrent, the facts they may draw on and what is at stake. It is free in order, length within
 * the budget, interruptions and silences; it is bound by who knows what, the check results, and never acting for the
 * player. The game cuts its paragraphs into beats (`parseReply`), as it does the situation writer's lines.
 */

/** How the scene should read (redesign §6.3): a few principles and short examples with made-up people, as engine text must. */
export const SCENE_STYLE = `How it should read:
- One continuous scene, written by one hand: each line comes out of the one before it, in what it means, not only its words. A question gets an answer, or a dodge the reader can see.
- People talk like people: complete, plain sentences that someone hearing them for the first time can follow.
- The moment comes first. What someone says and does comes from what just happened to them: what was said, who is there, how it lands.
- What presses on someone is an undercurrent. It shows in what they choose, avoid or notice, rarely in what they say outright.
- What each person knows comes first. Someone who doesn't know a secret may ask about it, guess, suspect or deny it, but never say it as something they know, and the narration never confirms it unless the turn shows it.
- A feeling shows only as much as the brief says. Name what someone feels only when it shows clearly or someone sees through to it; otherwise show the surface.
- Facts are there to draw on if a line needs one, never to recite. A fact marked new hasn't been said to the player yet: if it's used, say what it is.
- Each character sounds like their voice card. The card wins over everything else.
- An action only when it matters: a line of speech needs no gesture to carry it, and small business with a prop is filler. Narration only for what happens, and at most one detail of the place, from its own details. Never write the brief's notes out as prose.
- No sayings, maxims or riddles in place of an answer.
- The player is "you", in the present tense.
- A check result is what happens. A failure means it does not come off: show the attempt falling short, never a success.

Undercurrent, too loud: Ben: "I can't stop thinking about the money I owe you, Ada."
Better: Ben: He finds something to do with his cup when Ada mentions payday. "Busy night, then."

A failed check, played as a success: NARRATION: Ben studies Ada and sees straight through the lie.
Played honestly: NARRATION: Ben watches Ada a moment too long, then looks back at his cup. Whatever he was looking for, he didn't find it.`

/** The script form (redesign §6.1) and the tag footer (Q7). */
export const SCENE_FORMAT = `Output format, nothing else:
- A short scene, one paragraph per line. Start every paragraph with NARRATION: for what happens, or with a character's first name and a colon for what they say and do: what they say in double quotes and what they do, in the order it happens, as in written fiction. Someone who speaks gets their own paragraph.
- ${SCENE_LENGTH.paragraphs} paragraphs, ${SCENE_LENGTH.words} words in all; never more than ${SCENE_LENGTH.maxWords}.
- The people in the moment carry the scene. Anyone else present may react or say a little. Walk-ons speak only when listed. Nobody else speaks.
- Then the tags, one per line: [Name: EXPRESSION word] for each person who appears, for what their face shows; [Name: COMFORT 1-5 reason] when someone's comfort changes; [LEAVES: Name] for a departure the brief lists; [END SCENE] only when the brief says the scene ends.
- Never write the player's words, choices, thoughts or actions beyond what their input stated.

For example:
NARRATION: The kettle starts to tick on the stove.
Ada: She doesn't look up from the ledger. "You're late. Sit, the tea's nearly done."
Ben: "Traffic." He takes the chair nearest the door.
[Ada: EXPRESSION tired]
[Ben: EXPRESSION sheepish]`

/**
 * The place's sights, sounds and smells for the writer to draw on (redesign §9: texture is no longer the director's
 * quota but something the writer may use), less any the last turns already used: a detail shown twice is a repeat.
 * A detail counts as used when two of its longer words came up in the last turns' narration.
 */
export function placeDetails(texture: { sights: string[]; sounds: string[]; smells: string[] }, scene: Scene): string[] {
  const recent = new Set(plainWords(scene.turns.slice(-RECENT_USE_TURNS).flatMap((t) => t.beats.filter((b) => b.kind === 'narration').map((b) => b.text)).join(' ')))
  const used = (d: string) => plainWords(d).filter((w) => w.length > 3 && !FUNCTION_WORDS.has(w) && recent.has(w)).length >= 2
  return [...texture.sights, ...texture.sounds, ...texture.smells].filter((d) => !used(d))
}

/** A check's result as what happens (Q9: results as events, not an attempt with a label). */
const EVENT: Record<Degree, (who: string, succeeds: string, fails: string, stakes: string) => string> = {
  strong: (w, ok, _no, s) => `${w} ${ok}, and then some: ${s}.`,
  success: (w, ok, _no, s) => `${w} ${ok}: ${s}.`,
  cost: (w, ok, _no, s) => `${w} ${ok}, at a cost: ${s}, and something goes wrong with it.`,
  failure: (w, _ok, no, s) => `${w} ${no}. This does not happen: ${s}. Show the attempt not coming off.`
}

const clip = (t: string) => t.trim().replace(/[.\s]+$/, '')

export function checkEvent(content: Pack, check: PlannedCheck): string {
  const you = check.who === 'player'
  const who = you ? 'You' : firstName(characterById(content, check.who)!.name)
  return `- ${check.result ? EVENT[check.result.degree](who, you ? 'succeed' : 'succeeds', you ? 'fail' : 'fails', clip(check.stakes)) : clip(check.stakes)}`
}

/** A live pressure as undercurrent, in words for the writer (redesign §5: at most one each, framed at its strength). */
function undercurrent(content: Pack, who: string, p: LivePressure, tell?: string): string {
  const name = (id: string) => (id === 'player' ? 'you' : firstName(characterById(content, id)?.name ?? id))
  const self = name(who)
  if (p.kind === 'secret') return ` Underneath, ${self} is keeping something (${p.approach ?? 'deflect'}): ${clip(p.text)}.${tell ? ` It shows only as: ${clip(tell)}. Show it; nobody remarks on it unless their check to read ${self} succeeded.` : " It doesn't show."}`
  if (p.kind === 'tie') return ` Underneath, what ${name(p.ref)} ${p.ref === 'player' ? 'are' : 'is'} to ${self} matters here: ${clip(p.text)}.`
  const words = content.ruleset.pressures
  const level = words.indexOf(p.strength ?? '')
  return level >= words.length - 1 ? ` Underneath, tonight's aim drives what ${self} does: ${clip(p.text)}.` : ` Underneath, tonight's aim is on ${self}'s mind and may come up if it fits: ${clip(p.text)}.`
}

/** The writer's brief from the scene plan and its view (redesign §6.2). */
export function buildSceneWriterPrompt(content: Pack, state: GameState, view: BeatPlan, input: string): Prompt {
  const plan = view.scene!
  const scene = state.scene!
  const location = locationById(content, scene.locationId)!
  const present = presentCast(scene)
  const nameOf = (id: string) => {
    const c = characterById(content, id)
    if (c) return firstName(c.name)
    const w = location.walkOns.find((x) => x.id === id)
    return w?.name ?? w?.label ?? id
  }
  const people = present.map((id) => characterById(content, id)!)
  // Portraits of everyone present; voice cards for the people in the moment (redesign §4, "The writer").
  const cards = people.map((c) => (plan.focus.includes(c.id) ? voiceCard(firstName(c.name), c.voice, c.portrait) : `## ${firstName(c.name)}\n${c.portrait}`))

  const system = [
    'You write one turn of a visual-novel RPG scene as a short scene: the conversation and what happens, in one continuous piece.',
    SCENE_STYLE,
    writerStage(content.tone, content.codex).text,
    SCENE_FORMAT,
    `The player is ${state.player.name} (${state.player.pronouns}), addressed as "you".`,
    ...cards,
    childGuard(content, state)
  ]
    .filter(Boolean)
    .join('\n\n')

  const facts = sceneFacts(content, state)
  // What the player has heard: sheet facts by id, and lore or memories said on screen, which no sheet holds (task 4).
  const sheets = new Set(facts.map((f) => f.id))
  const heard = scene.turns.flatMap((t) => (t.records?.said ?? []).filter((f) => !sheets.has(f.fact) && scene.told.includes(f.fact)))
  const told = [...facts.filter((f) => f.kind === 'said' || scene.told.includes(f.id)), ...heard.filter((f, i) => heard.findIndex((x) => x.fact === f.fact) === i).map((f) => ({ text: f.text }))]
  const felt = feelingsNow(state, view)
  const feltLine = (id: string) => {
    const f = felt[id]
    const s = f && shown(content, state, id, f, view)
    if (!f || !s) return ''
    const reads = (view.reads ?? []).filter((x) => x.target === id).map((x) => (x.by === 'player' ? ' You see through to it.' : ` ${nameOf(x.by)} sees through to it and may say so.`))
    return ` Feels ${feltWords(content.ruleset, f)}. ${shownWords(s)}.${[...new Set(reads)].join('')}`
  }
  const tells = new Map(view.speakers.flatMap((s) => (s.tell ? [[s.id, s.tell]] : [])))
  const momentLine = (who: string) => {
    const m = plan.moments.find((x) => x.who === who)
    const pressure = plan.pressures.find((p) => p.who === who)
    const pool = plan.pools[who] ?? []
    return [
      `- ${nameOf(who)}:${m?.lands ? ` ${clip(m.lands)}.` : ''} Right now ${nameOf(who)} wants ${clip(m?.wants || 'to answer what was asked')}.${feltLine(who)}`,
      pressure ? undercurrent(content, who, pressure, tells.get(who)) : '',
      pool.length > 0 ? ` May draw on, if a line needs it: ${pool.map((f) => `${clip(f.text)} ${f.unheard ? '[new to the player]' : "[already said; don't repeat it]"}`).join('; ')}.` : ''
    ].join('')
  }
  const around = present.filter((id) => !plan.focus.includes(id))
  const ties = speakerTies(content, state, { ...view, speakers: present.map((id) => ({ id, intent: '' })) })
  const knowledge = knowledgeLines(content, state, view)
  const claims = claimLines(content, state)
  const recent = Object.entries(recentlyUsed(content, scene)).map(([id, u]) => `- ${nameOf(id)}: ${[...u.slang.map((t) => `"${t}"`), ...u.gestures].join('; ')}`)
  const details = placeDetails(location.texture, scene)
  const listed = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

  const user = [
    `# Where you are\n${location.name}. ${location.description}`,
    details.length > 0 && `# The place's details (one, if a line needs it)\n${details.map((d) => `- ${d}`).join('\n')}`,
    told.length > 0 ? `# What the player has been told this scene\n${told.map((f) => `- ${f.text}`).join('\n')}` : '# What the player has been told this scene\nNothing yet beyond what they can see.',
    claims.length > 0 && `# Claimed but never confirmed (claims, not facts: anyone may doubt or deny them)\n${claims.join('\n')}`,
    scene.summary && `# Earlier in the scene\n${scene.summary}`,
    scene.turns.length > 0 && `# Last turns\n${scene.turns.slice(-RECENT_TURNS).map((t) => turnText(content, state.player.name, t)).join('\n\n')}`,
    `# The player says or does\n${input}`,
    view.checks.some((c) => c.result) && `# What the rolls decided (this happens; honor it)\n${view.checks.filter((c) => c.result).map((c) => checkEvent(content, c)).join('\n')}`,
    plan.focus.length > 0 && `# This moment\n${plan.focus.map(momentLine).join('\n')}`,
    around.length > 0 && `# Also here (they may react or say a little)\n${around.map((id) => `- ${nameOf(id)}.${feltLine(id)}`).join('\n')}`,
    ties.length > 0 && `# How people here stand with each other (facts about them, not how to play them)\n${ties.join('\n')}`,
    knowledge.length > 0 && `# Who knows what\n${knowledge.join('\n')}`,
    plan.stakes && `# What's at stake\n${plan.stakes}`,
    plan.leaves.length > 0 && `# Leaving this turn\n${listed(plan.leaves.map(nameOf))} ${plan.leaves.length === 1 ? 'leaves' : 'leave'}. Show them going.`,
    plan.walk_ons.length > 0 && `# Walk-ons\n${plan.walk_ons.map((w) => `- ${nameOf(w.id)}: ${w.line}`).join('\n')}`,
    // The writer is told when the plan ends the scene (a gap found in Milestone 3.6: it was asked to tag it "only then").
    plan.end_scene && '# The scene ends this turn\nBring it to a close, and add [END SCENE].',
    recent.length > 0 && `# Used in the last turns (don't repeat these, or bring back the things in them)\n${recent.join('\n')}`,
    plan.avoid.length > 0 && `# Avoid\n${plan.avoid.join('; ')}`,
    'Write the scene.'
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, user }
}

/**
 * Someone saying what only another knows (redesign §6.4, new): a dialogue beat that carries a run of
 * `OWNED_PHRASE_WORDS` words, at least `OWNED_CONTENT_WORDS` of them content words, from a fact or secret its speaker
 * can't say (another's knowledge they haven't heard, a secret they don't hold or know). Matched on whole runs of words,
 * not keywords: a secret's keywords are what touch it, and saying "the client" gives nothing away. A run that is also in
 * what the speaker knows (lore open to them, their own facts) is theirs to say: a place's news is often in a card too.
 */
export function ownedProblems(content: Pack, state: GameState, parsed: ParsedReply): Problem[] {
  const scene = state.scene!
  const facts = sceneFacts(content, state).filter((f) => f.kind === 'knows' || f.kind === 'secret')
  const theirs = new Map<string, string>()
  const ownWords = (speaker: string): string => {
    if (!theirs.has(speaker)) {
      const c = characterById(content, speaker)
      const lore = c ? content.codex.filter((e) => knows(content.setting, e, knowerOf(c))).flatMap((e) => [e.summary, e.full, e.stage ?? '']) : []
      const said = facts.filter((f) => canSay(scene, f, speaker)).map((f) => f.text)
      theirs.set(speaker, ` ${plainWords([...lore, ...said].join(' . ')).join(' ')} `)
    }
    return theirs.get(speaker)!
  }
  const problems: Problem[] = []
  parsed.beats.forEach((b, i) => {
    if (b.kind !== 'dialogue') return
    const said = ` ${plainWords(b.text).join(' ')} `
    for (const f of facts) {
      const knows = canSay(scene, f, b.speaker) || (f.kind === 'secret' && knowersOf(state, f.id, f.text).includes(b.speaker))
      if (knows) continue
      const hit = runs(f.text, OWNED_PHRASE_WORDS).find((r) => said.includes(` ${r} `) && !ownWords(b.speaker).includes(` ${r} `))
      if (!hit) continue
      const holder = firstName(characterById(content, f.owner)?.name ?? f.owner)
      const speaker = firstName(characterById(content, b.speaker)?.name ?? b.speaker)
      problems.push({ kind: 'unowned-fact', beat: i + 1, text: hit, fix: `Beat ${i + 1}: ${speaker} says what only ${holder} knows ("${hit}"). Have ${speaker} ask, guess or say nothing about it.` })
      break
    }
  })
  return problems
}
