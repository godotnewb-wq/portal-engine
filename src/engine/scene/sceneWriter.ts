import { knows, writerStage } from '@engine/codex'
import { firstName, type Prompt } from '@engine/core'
import { characterById, knowerOf, locationById, type Pack } from '@engine/pack'
import type { Degree } from '@engine/rules'
import type { GameState, Scene } from '@engine/state'
import type { ParsedReply } from './beats'
import type { Problem } from './checks'
import { cutIn, RECENT_TURNS, turnText } from './director'
import { canSay, sceneFacts } from './facts'
import { feelingsNow, feltWords, shown, shownWords } from './feelings'
import { childGuard } from './guard'
import { knowersOf } from '@engine/memory'
import { presentCast, type BeatPlan, type PlannedCheck } from './planShape'
import { RECENT_USE_TURNS, recentlyUsed } from './repeats'
import type { LivePressure } from './scenePlan'
import { FUNCTION_WORDS, OWNED_PHRASE_WORDS, plainWords, runs } from './phrases'
import { OVERUSED_PHRASES, SCENE_LENGTH } from './style'
import { claimLines, knowledgeLines, speakerTies, voiceCard } from './writer'

/**
 * The `scene` pipeline's writer: the scene's author (scene system redesign §4, §6; Milestone 5 plan, task 3). It writes
 * the turn as one continuous short scene in a light script form, from the people present, each one's moment, what
 * presses on them as undercurrent, the facts they may draw on and what is at stake. It is free in order, length within
 * the budget, interruptions and silences; it is bound by who knows what, the check results, and never acting for the
 * player. It writes one beat per line (since 2026-11-24: a paragraph form, cut into beats by code, guessed at subjects
 * and grammar); `parseReply` still cuts a line that mixes speech and action.
 */

/** How the scene should read (redesign §6.3): a few principles and short examples with made-up people, as engine text must. */
export const SCENE_STYLE = `How it should read:
- One continuous scene, written by one hand: each line, narration included, comes out of the one before it, in what it means, not only its words. A question gets an answer, or a dodge the reader can see.
- People talk like people: complete, plain sentences that someone hearing them for the first time can follow.
- The moment comes first. What someone says and does comes from what just happened to them: what was said, who is there, how it lands.
- What presses on someone is an undercurrent. It shows in what they choose, avoid or notice, rarely in what they say outright.
- What each person knows comes first. Each person knows their own card, what they have seen and heard in this scene, and what anyone in their place would know; another person's aims, facts and notes about others are that person's. Someone who doesn't know something may ask about it, guess, suspect or deny it, but never say it as something they know, and the narration never confirms it unless the turn shows it.
- A feeling shows only as much as the brief says. Name what someone feels only when it shows clearly or someone sees through to it; otherwise show the surface.
- Facts are there to draw on if a line needs one, never to recite: a fact a line uses comes out the way this person would say it here, to these people, never in the brief's words. What people are to each other is background, never said as written.
- People stay where the last turns put them. Someone across the room hears only what is said loudly or to them; to bring them in, someone goes over or calls across. When someone moves, show who goes with them. People mind who can hear them.
- The scene is what you see and hear from where you are. People out of earshot show only in what you can see them do; their words reach you only when said loudly or to you. Someone in the moment who is out of earshot is still shown, from where you are.
- Each character sounds like their voice card. The card wins over everything else.
- An action only when it matters: a line of speech needs no gesture to carry it, and small business with a prop is filler. Narration only for what happens, and one or two details of the place, from its own details, never generic ones. Never write the brief's notes out as prose.
- No sayings, maxims or riddles in place of an answer.
- The player is "you", in the present tense.
- A check result is what happens. A failure means it does not come off: show the attempt falling short, never a success.
- End the turn where the player can act: someone asked or called to answers, or the turn shows them about to.
- Only this world's names: no real places, brands or people from outside it.

Undercurrent, too loud: Ben: "I can't stop thinking about the money I owe you, Ada."
Better, when Ada has just mentioned payday: Ben: "Busy night, then."

A fact recited (the brief says Ada has been late on her rent twice): Ben: "Ada has been late on her rent twice."
In the moment: Ben: "Ask her what day the rent's due. Go on, ask."

A failed check, played as a success: NARRATION: Ben studies Ada and sees straight through the lie.
Played honestly: NARRATION: Ben watches Ada a moment too long, then looks away. Whatever he was looking for, he didn't find it.`

/** The script form (redesign §6.1) and the tag footer (Q7). */
export const SCENE_FORMAT = `Output format, nothing else:
- A short scene, one beat per line, in the order it happens. NARRATION: for what happens or what someone does, as a whole sentence that names them, never a stage direction ("From the booth."). A character's first name and a colon for what they say, in double quotes, and nothing else.
- ${SCENE_LENGTH.lines} lines, ${SCENE_LENGTH.words} words in all; never more than ${SCENE_LENGTH.maxWords}.
- The people in the moment carry the scene. Anyone else present may react to what was just said, briefly; they don't bring up a topic of their own. Not everyone present needs a line or an action each turn: leave out anyone the moment doesn't touch. Walk-ons speak only when listed. Nobody else speaks.
- Most lines of speech need no action beside them.
- Then the tags, one per line: [Name: EXPRESSION word] for each person who appears, for what their face shows; [Name: COMFORT 1-5 reason] when someone's comfort changes; [LEAVES: Name] for a departure the brief lists; [END SCENE] only when the brief says the scene ends.
- Never write the player's words, choices, thoughts or actions beyond what their input stated.

For example:
NARRATION: The kettle starts to tick on the stove.
NARRATION: Ada doesn't look up from the ledger.
Ada: "You're late. Sit, the tea's nearly done."
Ben: "Traffic."
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

/**
 * The voice card as the scene writer reads it (2026-11-24 writer replay): sample lines and the shifts are how someone
 * sounds, not lines to say. Read as material, a sample line came back word for word ("Six for the good stuff, and it
 * isn't that good") and a lying shift played when no one was lying (a clean glass wiped). The situation writer's card
 * is unchanged.
 */
export function sceneVoiceCard(card: string): string {
  return card.replace(/^Sample lines: /m, 'How they sound (never use these lines): ').replace(/^When angry: /m, 'How they change, only when they feel it now. Angry: ')
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
  // An aim is its holder's alone: given in the brief beside everyone else's, it turned up as another's knowledge
  // (2026-11-24 play: a mechanic naming the place a fixer's job was in before she'd said it).
  const own = ` It is ${self}'s own: nobody else here knows it.`
  return level >= words.length - 1 ? ` Underneath, tonight's aim drives what ${self} does: ${clip(p.text)}.${own}` : ` Underneath, tonight's aim is on ${self}'s mind and may come up if it fits: ${clip(p.text)}.${own}`
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
  // Portraits of everyone present; voice cards for the people in the moment (redesign §4, "The writer"). A portrait
  // holds no habits (decided 2026-11-24, user): a habit on the card came back in nearly every turn as filler.
  const used = recentlyUsed(content, scene, RECENT_USE_TURNS, scene.turns.length)
  const cards = people.map((c) => (plan.focus.includes(c.id) ? sceneVoiceCard(voiceCard(firstName(c.name), c.voice, c.portrait)) : `## ${firstName(c.name)}\n${c.portrait}`))

  const system = [
    'You write one turn of a visual-novel RPG scene as a short scene: the conversation and what happens, in one continuous piece.',
    SCENE_STYLE,
    // Shown, not only checked (2026-11-24 writer replays): a phrase caught only after the draft costs a rewrite.
    `Never write these; a draft that uses one is sent back: ${[...OVERUSED_PHRASES, ...content.phrases].map((x) => `"${x}"`).join(', ')}.`,
    writerStage(content.tone, content.codex).text,
    SCENE_FORMAT,
    `The player is ${state.player.name} (${state.player.pronouns}), addressed as "you".`,
    // A portrait read as a script is played in every line (2026-11-24 play: a bartender quoting prices nobody asked
    // for, a mechanic raising machines unprompted); npc design §5 has them as tendencies, not rules.
    'Each portrait below is how that person tends to be, not a script: show it when the moment calls for it, never in every line.',
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
  // Someone outside the moment gets how much their feeling shows, not its display line: given "gets precise: numbers,
  // valves, how long until", the writer had them volunteer a reading in every sample of the 2026-11-24 replays.
  const feltLine = (id: string, display = true) => {
    const f = felt[id]
    const s = f && shown(content, state, id, f, view)
    if (!f || !s) return ''
    const reads = (view.reads ?? []).filter((x) => x.target === id).map((x) => (x.by === 'player' ? ' You see through to it.' : ` ${nameOf(x.by)} sees through to it and may say so.`))
    return ` Feels ${feltWords(content.ruleset, f)}. ${shownWords(display ? s : { ...s, display: undefined })}.${[...new Set(reads)].join('')}`
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
  const recent = Object.entries(used).map(([id, u]) => `- ${nameOf(id)}: ${[...u.slang.map((t) => `"${t}"`), ...u.gestures].join('; ')}`)
  const details = placeDetails(location.texture, scene)
  const listed = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

  const user = [
    `# Where you are\n${location.name}. ${location.description}`,
    details.length > 0 && `# The place's details (use one or two in the narration)\n${details.map((d) => `- ${d}`).join('\n')}`,
    told.length > 0 ? `# What the player has been told this scene\n${told.map((f) => `- ${f.text}`).join('\n')}` : '# What the player has been told this scene\nNothing yet beyond what they can see.',
    claims.length > 0 && `# Claimed but never confirmed (claims, not facts: anyone may doubt or deny them)\n${claims.join('\n')}`,
    scene.summary && `# Earlier in the scene\n${scene.summary}`,
    // Material by person, labelled as material: laid out person by person and called "this moment", it was written as
    // each one's part rather than one exchange (2026-11-24 play: a fact and a want joined into a line that answered nothing).
    plan.focus.length > 0 && `# What each person brings (draw on it when the conversation reaches it)\n${plan.focus.map(momentLine).join('\n')}`,
    around.length > 0 && `# Also here (they may react to what was just said, briefly, but start no topic; a feeling that shows is in how they react, not something they bring up)\n${around.map((id) => `- ${nameOf(id)}.${feltLine(id, false)}`).join('\n')}`,
    ties.length > 0 && `# How people here stand with each other (background, never said as written; each line is what the first person knows of the second, and theirs alone)\n${ties.join('\n')}`,
    knowledge.length > 0 && `# Who knows what\n${knowledge.join('\n')}`,
    plan.stakes && `# What's at stake\n${plan.stakes}`,
    plan.leaves.length > 0 && `# Leaving this turn\n${listed(plan.leaves.map(nameOf))} ${plan.leaves.length === 1 ? 'leaves' : 'leave'}. Show them going.`,
    plan.walk_ons.length > 0 && `# Walk-ons\n${plan.walk_ons.map((w) => `- ${nameOf(w.id)}: ${w.line}`).join('\n')}`,
    // The writer is told when the plan ends the scene (a gap found in Milestone 3.6: it was asked to tag it "only then").
    plan.end_scene && '# The scene ends this turn\nBring it to a close, and add [END SCENE].',
    recent.length > 0 && `# Used already: slang in the last turns, gestures this scene (don't repeat these, or bring back the things in them)\n${recent.join('\n')}`,
    plan.avoid.length > 0 && `# Avoid\n${plan.avoid.join('; ')}`,
    // The thread last, nearest the writing: how the scene opened, the scene so far, what the player just did, and what
    // the dice made of it.
    scene.opening && scene.opening.length > 0 && `# How the scene opened\n${scene.opening.map((b) => b.text).join('\n')}`,
    scene.turns.length > 0 && `# Last turns\n${scene.turns.slice(-RECENT_TURNS).map((t) => turnText(content, state.player.name, t)).join('\n\n')}`,
    cutIn(content, state) && `# Cut in\n${cutIn(content, state)}`,
    `# The player says or does\n${input}`,
    view.checks.some((c) => c.result) && `# What the rolls decided (this happens; honor it)\n${view.checks.filter((c) => c.result).map((c) => checkEvent(content, c)).join('\n')}`,
    'Write the scene: the first line answers what the player just said or did, and every line after it follows from the one before it.'
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
  const present = presentCast(scene)
  const privateMaterial = [
    ...present.flatMap((id) => {
      const c = characterById(content, id)
      return c ? [{ owner: id, about: [id], text: c.agenda.current }] : []
    }),
    ...state.relations.filter((r) => present.includes(r.from) && r.note).map((r) => ({ owner: r.from, about: [r.from, r.to], text: r.note! })),
    ...Object.entries(state.playerTies).flatMap(([id, t]) => (present.includes(id) && t.note ? [{ owner: id, about: [id], text: t.note }] : []))
  ]
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
      return
    }
    // Another person's aim for tonight, or their note about someone, in the words the brief gives it (2026-11-24 play:
    // what the writer sees for everyone came out of someone it doesn't belong to). Word for word only: a rewording
    // isn't caught here, and the style guide's rule on what each person knows does the rest.
    for (const m of privateMaterial) {
      if (m.about.includes(b.speaker)) continue
      const hit = runs(m.text, OWNED_PHRASE_WORDS).find((r) => said.includes(` ${r} `) && !ownWords(b.speaker).includes(` ${r} `))
      if (!hit) continue
      const holder = firstName(characterById(content, m.owner)?.name ?? m.owner)
      const speaker = firstName(characterById(content, b.speaker)?.name ?? b.speaker)
      problems.push({ kind: 'unowned-fact', beat: i + 1, text: hit, fix: `Beat ${i + 1}: ${speaker} says what is ${holder}'s own ("${hit}"). Have ${speaker} ask, guess or say nothing about it.` })
      return
    }
  })
  return problems
}
