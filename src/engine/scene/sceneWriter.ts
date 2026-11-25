import { knows, writerStage } from '@engine/codex'
import { firstName, keyWords, nameWords, sharedRun, type Prompt } from '@engine/core'
import { characterById, knowerOf, locationById, worldNames, type Pack } from '@engine/pack'
import type { Degree } from '@engine/rules'
import type { GameState, Scene } from '@engine/state'
import type { ParsedReply } from './beats'
import type { Problem } from './checks'
import { cutIn, RECENT_TURNS, turnText, whereSceneStands } from './director'
import { canSay, sceneFacts } from './facts'
import { feelingsNow, feltWords, shown, shownWords } from './feelings'
import { childGuard } from './guard'
import { knowersOf } from '@engine/memory'
import { presentCast, type BeatPlan, type PlannedCheck } from './planShape'
import { RECENT_USE_TURNS, recentlyUsed } from './repeats'
import type { Approach, LivePressure } from './scenePlan'
import { FUNCTION_WORDS, OWNED_PHRASE_WORDS, plainWords, runs, wholeWords } from './phrases'
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
- One scene, one story. Everything the scene has established stays true until a line on screen changes it: where people are and who is with whom; what they hold, ordered or put down; what was asked, offered, agreed or refused, and at what price; names given; what each person knows; how each feels and how they are getting on. "Where the scene stands", "How the scene opened", "Earlier in the scene" and "Last turns" are the story so far: only what they show has happened here, and nobody refers back to anything else. What happened before tonight comes from their cards.
- Each line, narration included, answers or follows the one before it, or what the player just did; a line that does neither doesn't belong. Each speaker has heard the line before theirs and responds to it, not to the brief. A question gets an answer, or a dodge the reader can see.
- People mean what they said: a later line agrees with their earlier ones, or shows them changing their mind and why.
- What someone says and does comes from what just happened to them: what was said, who is there, how it lands. What presses on them is an undercurrent: it shows in what they choose, avoid or notice, rarely in what they say outright.
- People talk like people: complete, plain sentences that someone hearing them for the first time can follow. No sayings, maxims, riddles or figures of speech a stranger couldn't follow. Each line means one plain thing and answers what was just said: no clever twist at the end, no echoing someone's words back for effect. When a short line could be taken several ways (dry, offended, joking), the words or a few words of narration make plain how it's meant.
- The player knows only what they have seen and heard, and what "What the player has been told this scene" lists. Someone bringing up something new to them says what it is first, before what it pays, where it is or what comes of it; nobody talks as if the player already knew.
- Whatever the player does is answered, not only what they say. When they look around, examine someone or something, search, listen, handle something, go somewhere or try something, the narration shows what comes of it from where they are: what they see, hear or find, or what happens, as something you see or hear. A real look or search gets the lines it needs: who is worth noticing and what they are doing, and what stands out, starting with what the scene hasn't shown yet, from the place's details and the people here. Examining someone shows what can be seen of them; what they hide shows only as the brief allows. A check result decides what an uncertain attempt finds. When the player also speaks, both are answered: the action is never dropped for the talk.
- Each person knows their own card, what they have seen and heard in this scene, and what anyone in their place would know; another person's aims, facts and notes about others are that person's. Someone who doesn't know something may ask about it, guess, suspect or deny it, but never say it as something they know, and the narration never confirms it unless the turn shows it. What someone only heard said, they pass on as heard, not as something they saw.
- A feeling shows only as much as the brief says. Name what someone feels only when it shows clearly or someone sees through to it; otherwise show the surface. When a tell or the way a feeling shows needs something that isn't in this scene, show the same feeling another way; never bring in an object or place for it.
- The brief is material, not lines. A fact a line uses comes out the way this person would say it here, to these people, never in the brief's words; what people are to each other is background; what a portrait says someone would talk about is small talk for when the moment has room, never a topic to raise. Never write the brief's notes out as prose.
- The scene is what you see and hear from where you are. Someone out of earshot hears only what is said loudly or to them, and shows only in what you can see them do; someone in the moment who is out of earshot is still shown, from where you are. To bring someone in, someone goes over or calls across; when someone moves, show who goes with them. People mind who can hear them.
- A voice card sets how someone sounds: their rhythm, their words, what they avoid. It never adds to what they know or say.
- An action only when it matters: a line of speech needs no gesture to carry it, and small business with a prop is filler. Narration only for what happens, and one or two of the place's own details, never generic ones.
- A check result is what happens. A failure means it does not come off: show the attempt falling short, never a success.
- Only this world's names: no real places, brands or people from outside it.

A line that doesn't follow: Ada: "Sit down." Ben: "The boiler's leaking again."
One that does: Ada: "Sit down." Ben: "I'll stand. I'm not staying."

Undercurrent, too loud: Ben: "I can't stop thinking about the money I owe you, Ada."
Better, when Ada has just mentioned payday: Ben: "Busy night, then."

A fact recited (the brief says Ada has been late on her rent twice): Ben: "Ada has been late on her rent twice."
In the moment: Ben: "Ask her what day the rent's due. Go on, ask."

A failed check, played as a success: NARRATION: Ben studies Ada and sees straight through the lie.
Played honestly: NARRATION: Ben watches Ada a moment too long, then looks away. Whatever he was looking for, he didn't find it.`

/** The script form (redesign §6.1) and the tag footer (Q7). */
export const SCENE_FORMAT = `Output format, nothing else:
- A short scene, one beat per line, in the order it happens. NARRATION: for what happens or what someone does, as a whole sentence that names them, never a stage direction ("From the booth."). A character's first name and a colon for what they say, in double quotes, and nothing else.
- ${SCENE_LENGTH.lines} lines, ${SCENE_LENGTH.words} words in all, never more than ${SCENE_LENGTH.maxWords}: a length to stay within, not one to reach. End where the player can act: someone asked or called to answers, or the turn shows them about to; never add a line past that.
- The people in the moment carry the scene. Anyone else present may react to what was just said, briefly; they don't bring up a topic of their own, and calling someone over to talk is bringing one up. Not everyone present needs a line or an action each turn: leave out anyone the moment doesn't touch. Walk-ons speak only when listed. Nobody else speaks.
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
 * isn't that good") and a lying shift played when no one was lying (a clean glass wiped). What a sample line says is no
 * more real than its wording: one naming a job's details was taken as said, and someone else repeated them (task 8c
 * bench run, 2026-11-25). Nor is their subject: four machine lines out of five made a mechanic talk machines unasked
 * (play 2026-11-25_1242_a1af). The situation writer's card is unchanged.
 */
export function sceneVoiceCard(card: string): string {
  return card.replace(/^Sample lines: /m, "How they sound, not what they talk about (never use these lines; nothing in them has been said here, and nobody here has heard it): ").replace(/^When angry: /m, 'How they change, only when they feel it now. Angry: ')
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

/**
 * How someone keeps a live secret, in words (task 8c bench run, 2026-11-25): given only as "(deflect)", a fixer told to
 * deflect named part of what she was hiding. Each says what they do instead and that the hidden part stays unsaid.
 */
const KEEPING: Record<Approach, (self: string) => string> = {
  deflect: (s) => `${s} steers away from it and never says it, or any part of it`,
  'partial truth': (s) => `${s} may say something true near it, but never the hidden part`,
  lie: (s) => `${s} lies about it if it comes up, and never says the truth of it`
}

/** A live pressure as undercurrent, in words for the writer (redesign §5: at most one each, framed at its strength). */
function undercurrent(content: Pack, who: string, p: LivePressure, tell?: string): string {
  const name = (id: string) => (id === 'player' ? 'you' : firstName(characterById(content, id)?.name ?? id))
  const self = name(who)
  if (p.kind === 'secret') return ` Underneath, ${self} is keeping something: ${clip(p.text)}. ${KEEPING[p.approach ?? 'deflect'](self)}.${tell ? ` It shows only as: ${clip(tell)}. Show it; nobody remarks on it unless their check to read ${self} succeeded.` : " It doesn't show."}`
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
    `The player is ${state.player.name} (${state.player.pronouns}): "you", in the present tense.`,
    // A portrait read as a script is played in every line (2026-11-24 play: a bartender quoting prices nobody asked
    // for, a mechanic raising machines unprompted); npc design §5 has them as tendencies, not rules.
    'Each portrait below is how that person tends to be, not a script: show it when the moment calls for it, never in every line. What it says they would talk about is small talk for when the moment has room, never a topic to raise.',
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
  // A feeling's display line ("gets precise: numbers, valves…") only the first time someone is on screen, or when the
  // feeling is new this turn or has risen: a mood held all evening, given its display line every turn, was a standing
  // order to play the same business (2026-11-25: a worried mechanic talked machines in every turn he was in focus).
  // Held, it says so and shows nothing more.
  const feltLine = (id: string, display = true) => {
    const f = felt[id]
    const s = f && shown(content, state, id, f, view)
    if (!f || !s) return ''
    const before = scene.moods[id]
    const same = !!before && before.shade === f.shade
    const seen = scene.turns.some((t) => t.speakers.includes(id))
    const held = seen && same && f.intensity <= before!.intensity
    const how = held ? ', as before' : seen && same ? ', more than before' : ''
    const reads = (view.reads ?? []).filter((x) => x.target === id).map((x) => (x.by === 'player' ? ' You see through to it.' : ` ${nameOf(x.by)} sees through to it and may say so.`))
    return ` Feels ${feltWords(content.ruleset, f)}${how}. ${shownWords(display && !held ? s : { ...s, display: undefined })}.${[...new Set(reads)].join('')}`
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
  // What the people in the moment hold toward the others, notes only between them (2026-11-25 audit: fifteen lines,
  // both ways round, mostly about people who start no topic, were more wording to recite than help). A tie already
  // given as someone's undercurrent isn't given twice: said twice, it was said word for word.
  const undercurrentTies = new Set(plan.pressures.filter((p) => p.kind === 'tie').map((p) => `- ${nameOf(p.who)} → ${p.ref === 'player' ? 'you' : nameOf(p.ref)}:`))
  const ties = speakerTies(content, state, { ...view, speakers: plan.focus.map((id) => ({ id, intent: '' })) }).filter((l) => ![...undercurrentTies].some((p) => l.startsWith(p)))
  // A secret the brief doesn't give the writer can't be said by anyone; the line naming it only showed the machinery.
  const knowledge = knowledgeLines(content, state, view).filter((l) => !l.includes("which this brief doesn't give you"))
  const claims = claimLines(content, state)
  const recent = Object.entries(used).map(([id, u]) => `- ${nameOf(id)}: ${[...u.slang.map((t) => `"${t}"`), ...u.gestures.map(wholeWords)].join('; ')}`)
  const stands = whereSceneStands(scene)
  const doing = plan.player_action?.doing?.trim()
  const details = placeDetails(location.texture, scene)
  const listed = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

  const user = [
    `# Where you are\n${location.name}. ${location.description}`,
    details.length > 0 && `# The place's details (use one or two in the narration)\n${details.map((d) => `- ${d}`).join('\n')}`,
    told.length > 0 ? `# What the player has been told this scene\n${told.map((f) => `- ${f.text}`).join('\n')}` : '# What the player has been told this scene\nNothing yet beyond what they can see.',
    claims.length > 0 && `# Claimed but never confirmed (claims, not facts: anyone may doubt or deny them)\n${claims.join('\n')}`,
    // Material by person, labelled as material: laid out person by person and called "this moment", it was written as
    // each one's part rather than one exchange (2026-11-24 play: a fact and a want joined into a line that answered nothing).
    plan.focus.length > 0 && `# What each person brings to this exchange (one conversation, not a turn each; draw on it when the conversation reaches it)\n${plan.focus.map(momentLine).join('\n')}`,
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
    // The thread last, nearest the writing, in the order it happened: how the scene opened, the turns since, where that
    // left things, the last turns as written, what the player just did, and what the dice made of it.
    scene.opening && scene.opening.length > 0 && `# How the scene opened\n${scene.opening.map((b) => b.text).join('\n')}`,
    scene.summary && `# Earlier in the scene\n${scene.summary}`,
    stands.length > 0 && `# Where the scene stands (all of it stays true unless a line changes it)\n${stands.join('\n')}`,
    scene.turns.length > 0 && `# Last turns\n${scene.turns.slice(-RECENT_TURNS).map((t) => turnText(content, state.player.name, t)).join('\n\n')}`,
    cutIn(content, state) && `# Cut in\n${cutIn(content, state)}`,
    `# The player says or does\n${input}${doing ? `\nWhat they're doing: ${clip(doing)}.` : ''}`,
    view.checks.some((c) => c.result) && `# What the rolls decided (this happens; honor it)\n${view.checks.filter((c) => c.result).map((c) => checkEvent(content, c)).join('\n')}`,
    'Write the scene from where it stands: it answers everything the player just said and did, and every line after it follows from the one before it.'
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, user }
}

/** Words in a row a spoken line may share with a fact or note in the brief before it reads as recited (*tune*). */
export const RECITED_WORDS = 5
/** Content words such a run needs, so "on the first of" alone isn't recitation. */
export const RECITED_CONTENT_WORDS = 2
/**
 * Key words in a row (`keyWords`: no pronouns, small words or names) a spoken line may share with one fact or note
 * (writing issue 2, 2026-11-25): "she has heard his work is good" said as "I've heard your work is good" kept its
 * key words and their order, and five words in a row missed it. *tune*: on the 2026-11-24 full bench, 3 flagged 7.6%
 * of dialogue lines against 5.2% for the runs alone, nearly all of them facts said as written.
 */
export const RECITED_KEY_WORDS = 3

/**
 * A fact or a note said in the brief's own words (2026-11-25 play: asked who a fixer was, a bartender gave his card's line
 * about her tab word for word and a runner her note about the work she'd done for her). The style guide asks for a fact
 * the way this person would say it here; this sends back a line that carries `RECITED_WORDS` of the brief's words in a
 * row, or `RECITED_KEY_WORDS` of a fact's key words in order, instead: the facts and details on hand (not secrets, nor what was already said on screen) and every note about
 * people present. A beat already sent back for saying someone else's is left to that.
 */
export function recitedProblems(content: Pack, state: GameState, plan: Pick<BeatPlan, 'scene'>, parsed: ParsedReply, skip: Set<number> = new Set()): Problem[] {
  const scene = state.scene!
  const present = presentCast(scene)
  const material = [
    ...sceneFacts(content, state).filter((f) => f.kind === 'knows' || f.kind === 'place').map((f) => f.text),
    ...Object.values(plan.scene?.pools ?? {}).flatMap((p) => p.map((f) => f.text)),
    ...state.relations.filter((r) => present.includes(r.from) && r.note).map((r) => r.note!),
    ...Object.entries(state.playerTies).flatMap(([id, t]) => (present.includes(id) && t.note ? [t.note] : []))
  ]
  const phrases = [...new Set(material.flatMap((t) => runs(t, RECITED_WORDS, RECITED_CONTENT_WORDS)))]
  const names = nameWords(worldNames(content))
  const keyed = material.map((t) => keyWords(t, names))
  const problems: Problem[] = []
  parsed.beats.forEach((b, i) => {
    if (b.kind !== 'dialogue' || skip.has(i + 1)) return
    const said = ` ${plainWords(b.text).join(' ')} `
    const line = keyWords(b.text, names)
    const hit = phrases.find((r) => said.includes(` ${r} `)) ?? keyed.map((k) => sharedRun(line, k, RECITED_KEY_WORDS)).find(Boolean)?.split(' ').join(' … ')
    if (!hit) return
    const speaker = firstName(characterById(content, b.speaker)?.name ?? b.speaker)
    problems.push({ kind: 'recited', beat: i + 1, text: hit, fix: `Beat ${i + 1}: ${speaker} says it in the brief's words ("${hit}"). Say it the way ${speaker} would here, to these people, or leave it out.` })
  })
  return problems
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
