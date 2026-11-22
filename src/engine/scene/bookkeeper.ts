import { isSuccess } from '@engine/rules'
import { firstName, traced, type CallTrace, type LlmReply, type Prompt } from '@engine/core'
import { readFeeling, shadeList } from '@engine/characters'
import { characterById, type Pack } from '@engine/pack'
import { knowersOf, learnedSecrets } from '@engine/memory'
import type { Beat, Bookkeeping, GameState } from '@engine/state'
import { speakerName, turnText } from './director'
import { NEW_FACT_WORDS } from './plan'
import { presentCast } from './planShape'
import { canSay, sceneFacts } from './facts'
import { statesFact } from './phrases'
import type { TurnWritten } from './turn'

/**
 * The bookkeeper (milestone 4c; milestone-4 plan Part 4c, decisions J–L, 2026-11-18, user): one call after each turn
 * is shown, while the player reads, that records what the turn did on screen. The director plans; this reads what
 * the writer actually wrote. The model judges language only (was a secret said as known, guessed at, or shown?); the
 * game decides authority: who could say it, whether that teaches anyone, and whether it was a leak.
 *
 * - **A secret comes out** only when it is confirmed by someone who could say it (its holder, not keeping it that
 *   turn; someone who knew it; the player, who knew it) or when the prose shows the fact itself. Then everyone present
 *   learns it (the shared-scene rule since 4b).
 * - **Part of a secret** said as true (Milestone 5 plan, Q11) is kept and shown and teaches no one; only all of it does.
 * - **A guess reveals nothing**, even a right one (J), and is only someone putting forward what the hidden part
 *   might be. A question, a dodge, a denial or a hint is talk **around** it, kept and teaching no one; a guess by
 *   someone who knows the secret is turned down. **A leak**, said as known by someone who couldn't know it, is
 *   recorded as their claim and teaches no one (K). The player saying, as known, a secret they don't know is a guess:
 *   they are bluffing or guessing, and a leak is the writer's fault, not theirs. A holder saying a secret they were keeping that turn is left for
 *   review, not taken as a confirmation (the proposal's §5.2).
 * - **The fallback** (decision L, change 1): when the call fails, times out or can't be read, the only secret record
 *   the plan can give is a holder's planned reveal or concede that they voiced while not keeping the secret; the turn
 *   is marked unaudited for anything else.
 */

/** Whether what a check would bring about happens in the prose, in the bookkeeper's words; the game compares it with the roll. */
export const CHECK_SHOWN = ['happens', 'at a cost', "doesn't happen", 'unclear'] as const

/** How a secret came up, in the bookkeeper's words. */
export const SECRET_HOW = ['stated', 'partial', 'guess', 'around', 'evidence', 'unclear'] as const
export type SecretHow = (typeof SECRET_HOW)[number]

/** A secret the bookkeeper is told to watch for: one held or learned by someone present, or one the player knows. */
export interface Candidate {
  id: string
  holder: string
  text: string
  /**
   * What is hidden, in a few words: a linked secret's codex title ("What the sealed case holds"), a personal one's
   * summary or first sentence. Only this coming out counts (bench run of 2026-11-19: with the full text alone, the
   * bookkeeper took talk about the job around a secret for the secret).
   */
  hidden: string
}

/** One secret observation as the bookkeeper wrote it, before the game checks it. */
export interface WrittenSecret {
  id: string
  at: unknown
  how: string
  words: string
  answers?: unknown
}

/** The bookkeeper's reply as written, before the game checks it. */
export interface WrittenBookkeeping {
  secrets: WrittenSecret[]
  /** Facts from the writer's pool that a line stated (the `scene` pipeline only). */
  facts: { id: string; at: unknown; words: string }[]
  new: { text: string; at: unknown }[]
  changed: string
  moods: Record<string, unknown>[]
  checks: Record<string, unknown>[]
}

/** The bookkeeper's call for one turn, for the logs: the call, the records the game kept, and why it fell back if it did. */
export interface BookkeeperTrace {
  turnId: string
  at: string
  calls: CallTrace[]
  records: Bookkeeping
  /** Why the plan-based records were used: the call failed, or its reply couldn't be read. */
  error?: string
}

type Turned = Pick<TurnWritten, 'input' | 'beats' | 'plan'>

/** The facts the scene writer was offered this turn, by id, with who was offered each (empty on `situation`). */
function offered(written: Turned): Map<string, { text: string; to: string[] }> {
  const out = new Map<string, { text: string; to: string[] }>()
  for (const [who, pool] of Object.entries(written.plan.scene?.pools ?? {}))
    for (const f of pool) out.set(f.id, { text: f.text, to: [...(out.get(f.id)?.to ?? []), who] })
  return out
}

/**
 * A pool fact the prose said: the player has heard it, and `unowned` marks a speaker who couldn't have known it. A director's detail (`detail.*`) has no sheet behind it, so it
 * becomes a new detail anyone present may repeat, as a move's `new` did before (task 4).
 */
function heard(records: Bookkeeping, newFacts: { text: string }[], id: string, text: string, by: string, words: string, unowned = false): void {
  if (id.startsWith('detail.')) {
    if (![...newFacts, ...records.new].some((n) => n.text === text)) records.new.push({ text, by })
  } else if (!records.said.some((x) => x.fact === id)) records.said.push({ fact: id, text, by, words, ...(unowned && { unowned }) })
}

/** A character's secret by its fact id (`<holder>.<secret>`). */
function secretById(content: Pack, id: string): Candidate | undefined {
  const dot = id.indexOf('.')
  const c = dot > 0 ? characterById(content, id.slice(0, dot)) : undefined
  const s = c?.secrets.find((x) => `${c.id}.${x.id}` === id)
  if (!c || !s) return undefined
  const title = s.codex ? content.codex.find((e) => e.id === s.codex)?.title : undefined
  // A codex title reads as a phrase ("What the sealed case holds"), so it goes in lower case after "secret:"; a
  // summary or sentence keeps its case, since it may start with a name.
  const trim = (t: string) => t.replace(/[.\s]+$/, '')
  const hidden = title ? trim(title).charAt(0).toLowerCase() + trim(title).slice(1) : trim(s.summary ?? s.text.split(/(?<=[.!?])\s/)[0] ?? s.text)
  return { id, holder: c.id, text: s.text, hidden }
}

/**
 * The secrets the bookkeeper watches for, every turn whatever was said (so a paraphrase or a bare "yes" can be
 * recognized): those held by anyone present, those anyone present learned (holder here or not), and those the player
 * knows: found out before, or said on screen this scene.
 */
export function secretCandidates(content: Pack, state: GameState): Candidate[] {
  const scene = state.scene!
  const ids: string[] = []
  for (const who of presentCast(scene)) {
    const c = characterById(content, who)
    for (const s of c?.secrets ?? []) ids.push(`${who}.${s.id}`)
    for (const p of learnedSecrets(state, who)) ids.push(p.secret)
  }
  for (const [holder, texts] of Object.entries(state.facts)) for (const s of characterById(content, holder)?.secrets ?? []) if (texts.includes(s.text)) ids.push(`${holder}.${s.id}`)
  ids.push(...scene.told)
  return [...new Set(ids)].flatMap((id) => secretById(content, id) ?? [])
}

const numbered = (content: Pack, beats: Beat[]): string =>
  beats.map((b, i) => (b.kind === 'dialogue' ? `${i + 1}. ${speakerName(content, b.speaker)}: "${b.text}"` : `${i + 1}. (narration) ${b.text}`)).join('\n')

function task(content: Pack, limit: number, facts: boolean): string {
  const r = content.ruleset
  return `You keep the records for one turn of a visual-novel RPG scene. You read what was written and report what it did on screen. You don't judge whether anything was allowed; the game does that.

Reply with only a JSON object:
{"secrets": [{"id": "...", "at": 1, "how": "stated", "words": "...", "answers": "player"}], ${facts ? '"facts": [{"id": "...", "at": 1, "words": "..."}], ' : ''}"new": [{"text": "...", "at": 1}], "changed": "...", "moods": [{"id": "...", "shade": "...", "family": "...", "intensity": 1}], "checks": [{"id": "...", "shown": "doesn't happen", "at": 1, "words": "..."}]}

- secrets: each secret from the list whose hidden part this turn's lines or narration touched, in the order it happened. Each is listed by what is hidden, then in full. Only the hidden part counts: the background around it (a job, a place, a price, who is involved, what people there already know) is not the secret, and talk about it is none of these. id: from the list. at: "player" for the player's words, or the number of the line. words: the words that did it, copied exactly from that line. how is one of:
  - "stated": the whole hidden part said as true and known, outright or by confirming it ("Yes, that's what's in it", answering a question about it). Then answers: what it confirms, "player", an earlier line's number, or "earlier" for the turn before. A denial, or a line that says or implies the opposite, is never "stated", and neither is saying one doesn't know or won't say.
  - "partial": part of the hidden part said as true and known, but not all of it (what happened, but not who was behind it).
  - "guess": someone who doesn't know it puts forward what the hidden part might be ("I bet it's a weapon"), not as known, even when the guess is right.
  - "around": talk that touches the hidden part without saying it is true: asking about it, dodging, refusing to say, denying it ("It wasn't the courier"), hinting, wondering whether something is hidden.
  - "evidence": the prose shows the hidden part itself, so anyone looking would know (a box opened and its contents seen, a letter read out).
  - "unclear": you can't tell which.
  Most turns touch none: [].${facts ? `
- facts: each fact from the list below that a line said as true, or that the narration showed: id from the list, at the line's number, words copied exactly from that line. Asking about it, denying it or hinting at it doesn't count. Most turns use one or two, or none: [].` : ''}
- new: concrete details a line states as settled that no secret and no earlier turn holds: a price, a time, a place, a name, a promise. At most ${limit}, each in a few plain words, with the line it is from. A guess, or anything about a secret, is not a detail. Most turns have none: [].
- changed: one sentence on what is actually different after this turn; "" if nothing is.
- moods: each character present whose feeling the prose shows: where it seemed to land, as a shade from the list below (family only when the shade is listed under more than one) and intensity 1 to 5. Leave out anyone it doesn't show.
- checks: for each check below, whether what "If it works" describes happens in the lines: shown is "happens", "at a cost" (it happens, at a price the lines show), "doesn't happen" (the person misses it, fails, or is turned down) or "unclear" (the lines don't show either way). Judge that person's attempt only: someone else's dodge landing is the attempt failing. at and words: the line that shows it, copied exactly; for "unclear", none.
- Shades by family (usual intensity): ${shadeList(r)}.`
}

/** The bookkeeper's prompt for one written turn, read against the state before it (who knew what going in). */
export function buildBookkeeperPrompt(content: Pack, before: GameState, written: Turned): Prompt {
  const scene = before.scene!
  const player = before.player.name
  const present = presentCast(scene).map((id) => `${speakerName(content, id)} [${id}]`)
  const candidates = secretCandidates(content, before)
  const checks = written.plan.checks.filter((c) => c.line)
  const earlier = scene.turns.at(-1)
  const pool = offered(written)
  return {
    system: task(content, content.ruleset.bookkeeper.newDetails, !!written.plan.scene),
    user: [
      `Present: ${[...present, `and the player, ${player} (${before.player.pronouns})`].join(', ')}.`,
      `Secrets to watch:\n${candidates.length > 0 ? candidates.map((c) => `- [${c.id}] ${firstName(characterById(content, c.holder)!.name)}'s secret: ${c.hidden}. In full: ${c.text}`).join('\n') : '(none)'}`,
      written.plan.scene && `Facts the writer could use:\n${pool.size > 0 ? [...pool].map(([id, f]) => `- [${id}] ${f.text}`).join('\n') : '(none)'}`,
      // The attempt, never its result: asked whether the prose kept a result it was told, the bookkeeper said yes to
      // every check (13 of 13 in Milestone 5's third scene run, where the AI scorer found two played the wrong way).
      `Checks this turn:\n${checks.length > 0 ? checks.map((c) => `- [${c.id}] ${speakerName(content, c.who)} tries ${c.skill}${c.target ? ` on ${speakerName(content, c.target)}` : ''}. If it works: ${c.stakes}`).join('\n') : '(none)'}`,
      earlier && `Earlier:\n${turnText(content, player, earlier)}`,
      `This turn:\n${player} (player): ${written.input}\n${numbered(content, written.beats)}`
    ]
      .filter(Boolean)
      .join('\n\n')
  }
}

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : '')
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const objects = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter(isObject) : [])

/** Reads the bookkeeper's reply; undefined when it isn't a JSON object. Nothing in it is trusted yet (`checkBookkeeping`). */
export function parseBookkeeping(reply: string): WrittenBookkeeping | undefined {
  const body = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  let raw: unknown
  try {
    raw = start < 0 || end < start ? undefined : JSON.parse(body.slice(start, end + 1))
  } catch {
    raw = undefined
  }
  if (!isObject(raw)) return undefined
  return {
    secrets: objects(raw['secrets']).map((o) => ({ id: str(o['id']), at: o['at'], how: str(o['how']).toLowerCase(), words: str(o['words']), ...(o['answers'] !== undefined && o['answers'] !== null && o['answers'] !== '' && { answers: o['answers'] }) })),
    facts: objects(raw['facts']).map((o) => ({ id: str(o['id']), at: o['at'], words: str(o['words']) })),
    new: objects(raw['new']).map((o) => ({ text: str(o['text']), at: o['at'] })),
    changed: str(raw['changed']),
    moods: objects(raw['moods']),
    checks: objects(raw['checks'])
  }
}

/** Letters, digits and apostrophes, any case, one space between words: quotes and punctuation don't decide a match. */
const norm = (t: string): string => t.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim()
/** Whether quoted words are in a line: every part between ellipses, word for word. */
function quoted(words: string, line: string): boolean {
  const parts = words.split(/\.{3}|…/).map(norm).filter(Boolean)
  const text = ` ${norm(line)} `
  return parts.length > 0 && parts.every((p) => text.includes(` ${p} `))
}
const overlaps = (a: string, b: string) => {
  const [x, y] = [norm(a), norm(b)]
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x))
}

/** Where a record came from: the player's words or a beat's number, read leniently ("3", 3, "line 3", "player"). */
function readAt(at: unknown, beats: Beat[]): 'player' | number | undefined {
  const s = str(at).toLowerCase()
  if (s === 'player' || s === 'p') return 'player'
  const n = Number(s.replace(/^(?:line|beat)\s*/, ''))
  return Number.isInteger(n) && n >= 1 && n <= beats.length ? n : undefined
}
const order = (at: 'player' | number) => (at === 'player' ? 0 : at)

/**
 * Checks the bookkeeper's reply against the turn and the state before it, and turns it into the turn's records.
 * Every secret observation needs a secret from the list, a real source and its words found there; who said it comes
 * from the beat, never from the reply. Observations are taken in the order they happened, from what each person knew
 * going in: a confirmation teaches everyone present, so someone may say it after it in the same turn; a leak
 * authorizes no one, its speaker included. New details are limited by the ruleset and can't carry a secret back in.
 * Moods and checks are checked against the ruleset and the turn's checks, and kept for the logs only.
 */
export function checkBookkeeping(content: Pack, before: GameState, written: Turned, raw: WrittenBookkeeping): Bookkeeping {
  const scene = before.scene!
  const present = presentCast(scene)
  const refused: string[] = []
  const records: Bookkeeping = { source: 'bookkeeper', out: [], leaks: [], guesses: [], around: [], unresolved: [], partial: [], said: [], new: [], moods: [], checks: [], refused }
  const candidates = new Map(secretCandidates(content, before).map((c) => [c.id, c]))
  const knows = new Map([...candidates.values()].map((c) => [c.id, new Set([c.holder, ...knowersOf(before, c.id, c.text)])]))
  const kept = new Set(written.plan.speakers.flatMap((s) => s.kept ?? []))
  const lineOf = (at: 'player' | number) => (at === 'player' ? written.input : written.beats[at - 1]!.text)
  const byOf = (at: 'player' | number) => {
    if (at === 'player') return 'player'
    const b = written.beats[at - 1]!
    return b.kind === 'dialogue' ? b.speaker : 'narration'
  }
  const where = (at: 'player' | number) => (at === 'player' ? "the player's words" : `line ${at}`)

  const refuse = (why: string): [] => {
    refused.push(why)
    return []
  }
  const observed = raw.secrets.flatMap((o) => {
    const at = readAt(o.at, written.beats)
    const what = `secret ${o.id || '(no id)'}`
    if (!candidates.has(o.id)) return refuse(`${what}: not on the list`)
    if (at === undefined) return refuse(`${what}: no such line (${str(o.at) || 'none given'})`)
    if (!(SECRET_HOW as readonly string[]).includes(o.how)) return refuse(`${what}: "${o.how}" isn't a way it came up`)
    // Words that aren't in the line given but are in exactly one other line moved there: who said them comes from
    // where they are, never from the reply (bench run of 2026-11-19: the player's words given as line 1).
    let found: 'player' | number = at
    if (!quoted(o.words, lineOf(at))) {
      const elsewhere = (['player', ...written.beats.map((_, i) => i + 1)] as ('player' | number)[]).filter((x) => quoted(o.words, lineOf(x)))
      if (elsewhere.length !== 1) return refuse(`${what}: "${o.words}" isn't in ${where(at)}`)
      found = elsewhere[0]!
      refused.push(`${what}: "${o.words}" is in ${where(found)}, not ${where(at)}; taken from there`)
    }
    // What it answers only says what a "yes" confirms; one that isn't before it is dropped, not the observation.
    if (o.answers !== undefined) {
      const answers = str(o.answers).toLowerCase() === 'earlier' ? 'earlier' : readAt(o.answers, written.beats)
      const fits = answers === 'earlier' ? scene.turns.length > 0 : answers !== undefined && order(answers) < order(found)
      if (!fits) refused.push(`${what}: what it answers (${str(o.answers)}) isn't before it; left out`)
    }
    return [{ ...o, at: found, how: o.how as SecretHow }]
  })
  const done = new Set<string>()
  for (const o of observed.sort((a, b) => order(a.at) - order(b.at))) {
    const secret = candidates.get(o.id)!
    const by = byOf(o.at)
    const note = { secret: o.id, by, at: o.at, words: o.words }
    // Nobody guesses what they know: a holder's dodge or a knower's coyness read as a guess (manual runs of
    // 2026-11-19, where a holder's own dodge was logged as a guess at her secret) is turned down, not counted.
    // Talk around a secret teaches no one and is only kept (manual runs and bench run of 2026-11-19: with no kind for a
    // denial, a holder's "it wasn't them" was read as stating that it was).
    // Part of a secret said as true (Q11, decided 2026-11-19): kept and shown, teaching no one; only all of it does.
    if (o.how === 'around') records.around.push(note)
    else if (o.how === 'partial') records.partial.push(note)
    else if (o.how === 'guess' && (by === secret.holder || knows.get(o.id)!.has(by))) refused.push(`${o.id} at ${where(o.at)}: a guess by ${by}, who knows it`)
    else if (o.how === 'guess') records.guesses.push(note)
    else if (o.how === 'unclear') records.unresolved.push({ ...note, why: 'the bookkeeper couldn\'t tell' })
    else if (done.has(o.id)) continue
    else if (o.how === 'stated' && by === secret.holder && kept.has(o.id)) records.unresolved.push({ ...note, why: `${by} said it while keeping it` })
    else if (o.how === 'evidence' || knows.get(o.id)!.has(by)) {
      records.out.push({ ...note, how: o.how === 'evidence' ? 'discovered' : 'confirmed', to: present.filter((x) => x !== secret.holder) })
      done.add(o.id)
      for (const who of [...present, 'player']) knows.get(o.id)!.add(who)
    } else if (by === 'player') records.guesses.push({ ...note, why: "the player didn't know it" })
    else records.leaks.push({ ...note, why: by === 'narration' ? 'the narration said it as fact without showing it' : `${by} couldn't know it` })
  }

  // Facts the prose stated: on the list, the words in that line, and said by someone who could say it, or shown by
  // the narration. A line by someone who couldn't know it is the writer's leak (`ownedProblems`): it teaches no one.
  const pool = offered(written)
  const facts = new Map(sceneFacts(content, before).map((f) => [f.id, f]))
  for (const f of raw.facts) {
    const at = readAt(f.at, written.beats)
    const what = `fact ${f.id || '(no id)'}`
    const fact = pool.get(f.id)
    if (!fact) refused.push(`${what}: not on the list`)
    else if (at === undefined) refused.push(`${what}: no such line (${str(f.at) || 'none given'})`)
    else if (at === 'player') refused.push(`${what}: the player's words`)
    else if (!quoted(f.words, lineOf(at))) refused.push(`${what}: "${f.words}" isn't in line ${at}`)
    else {
      // Said aloud, it was heard, whoever said it: refused, it stayed "new to the player" and came back (m5-task4, 32
      // refusals). Whether the speaker could know it is the writer's check; the record only marks that they couldn't.
      const by = byOf(at)
      const sheet = facts.get(f.id)
      const could = by === 'narration' || fact.to.includes(by) || (sheet !== undefined && canSay(scene, sheet, by))
      heard(records, scene.newFacts, f.id, fact.text, by, f.words, !could)
    }
  }

  // A detail can't bring back as common ground what was only claimed or guessed about a secret.
  const claims = [...records.leaks, ...records.guesses, ...records.around, ...records.partial, ...records.unresolved].map((n) => n.words)
  const limit = content.ruleset.bookkeeper.newDetails
  for (const n of raw.new) {
    const at = readAt(n.at, written.beats)
    const what = `new "${n.text}"`
    if (!n.text) continue
    if (at === undefined) refused.push(`${what}: no such line (${str(n.at) || 'none given'})`)
    else if (n.text.split(/\s+/).length > NEW_FACT_WORDS) refused.push(`${what}: over ${NEW_FACT_WORDS} words`)
    else if (claims.some((c) => overlaps(c, n.text))) refused.push(`${what}: it is a claim or a guess about a secret`)
    else if ([...scene.newFacts, ...records.new].some((f) => norm(f.text) === norm(n.text))) continue
    else if (records.new.length >= limit) refused.push(`${what}: over the limit of ${limit}`)
    else records.new.push({ text: n.text, by: byOf(at) })
  }
  if (raw.changed) records.changed = raw.changed

  for (const m of raw.moods) {
    const id = str(m['id'])
    if (!present.includes(id)) {
      refused.push(`mood for ${id || '(no id)'}: not present`)
      continue
    }
    const read = readFeeling(content.ruleset, { shade: m['shade'], family: m['family'], intensity: m['intensity'] })
    if ('problem' in read) refused.push(`mood for ${id}: ${read.problem}`)
    else records.moods.push({ id, feeling: read.feeling })
  }
  // What the prose showed, against the roll: the game decides whether the result was kept (decided in task 4).
  const rolled = new Map(written.plan.checks.filter((c) => c.line && c.result).map((c) => [c.id, c.result!.degree]))
  for (const c of raw.checks) {
    const id = str(c['id'])
    const shown = str(c['shown']).toLowerCase()
    const degree = rolled.get(id)
    if (!degree) refused.push(`check ${id || '(no id)'}: not one of this turn's`)
    else if (!(CHECK_SHOWN as readonly string[]).includes(shown)) refused.push(`check ${id}: "${shown || 'nothing'}" isn't what a line can show`)
    else if (records.checks.some((x) => x.id === id)) continue
    else if (shown === 'unclear') records.checks.push({ id, shown })
    else {
      const at = readAt(c['at'], written.beats)
      const words = str(c['words'])
      if (at === undefined || at === 'player' || !quoted(words, lineOf(at))) {
        refused.push(`check ${id}: "${words}" isn't in ${at === undefined ? 'any line given' : where(at)}`)
        continue
      }
      const honored = shown === "doesn't happen" ? !isSuccess(degree) : isSuccess(degree)
      records.checks.push({ id, honored, shown, at, words, ...(!honored && { note: `rolled ${degree}; in the prose it ${shown === "doesn't happen" ? "doesn't happen" : shown === 'at a cost' ? 'happens at a cost' : 'happens'}` }) })
    }
  }
  return records
}

/**
 * The records the plan gives when the bookkeeper can't (decision L, change 1, 2026-11-18, user): a holder who voiced a
 * line the director planned as a reveal or concede, drawing on their own secret while not keeping it, gives it away;
 * nothing else about secrets is taken from the plan (no keyword answers, no one telling another's secret, no player
 * keyword rule). New details are the plan's, as before 4c; on the `scene` pipeline, a pool fact a line repeats is said.
 * The turn is marked unaudited.
 */
export function planBookkeeping(content: Pack, before: GameState, written: Turned): Bookkeeping {
  const present = presentCast(before.scene!)
  const kept = new Set(written.plan.speakers.flatMap((s) => s.kept ?? []))
  const lineBy = (who: string) => written.beats.findIndex((b) => b.kind === 'dialogue' && b.speaker === who) + 1
  const records: Bookkeeping = { source: 'plan', out: [], leaks: [], guesses: [], around: [], unresolved: [], partial: [], said: [], new: [], moods: [], checks: [], refused: [], unaudited: true }
  // The `scene` pipeline has no moves (Milestone 5 plan, task 4): a fact counts as said when a line by someone it was
  // offered to carries a run of its words, the same test as `ownedProblems`. Secrets aren't taken from the plan at all.
  for (const [id, f] of offered(written)) {
    const line = written.beats.find((b) => b.kind === 'dialogue' && f.to.includes(b.speaker) && statesFact(f.text, b.text))
    if (line && line.kind === 'dialogue') heard(records, before.scene!.newFacts, id, f.text, line.speaker, '')
  }
  for (const m of written.plan.moves ?? []) {
    const at = lineBy(m.who)
    if (at === 0) continue
    for (const s of m.says) {
      const secret = s.id ? secretById(content, s.id) : undefined
      if (secret) {
        const out = secret.holder === m.who && (m.move === 'reveal' || m.move === 'concede') && !kept.has(secret.id) && !records.out.some((o) => o.secret === secret.id)
        if (out) records.out.push({ secret: secret.id, by: m.who, at, words: '', how: 'confirmed', to: present.filter((x) => x !== secret.holder) })
      } else if (!s.id && ![...before.scene!.newFacts, ...records.new].some((f) => f.text === s.text)) records.new.push({ text: s.text, by: m.who })
    }
  }
  return records
}

/**
 * Runs the bookkeeper for one turn and returns its records: the call's, checked, or the plan's when the call fails or
 * its reply can't be read. Waiting for it (and giving up past the role's timeout) is the caller's: the turn is shown
 * before this runs.
 */
export async function bookkeep(
  content: Pack,
  before: GameState,
  written: Turned & { id: string },
  call: (prompt: Prompt) => Promise<LlmReply>,
  now: () => number = Date.now
): Promise<{ records: Bookkeeping; trace: BookkeeperTrace }> {
  const calls: CallTrace[] = []
  const prompt = buildBookkeeperPrompt(content, before, written)
  const trace = (records: Bookkeeping, error?: string): BookkeeperTrace => ({ turnId: written.id, at: new Date(now()).toISOString(), calls, records, ...(error && { error }) })
  let error: string
  try {
    const reply = await traced(calls, { id: `${written.id}:bookkeeper`, role: 'bookkeeper', turnId: written.id, sceneId: before.scene!.id }, prompt, now, () => call(prompt))
    const raw = parseBookkeeping(reply)
    if (raw) {
      const records = checkBookkeeping(content, before, written, raw)
      return { records, trace: trace(records) }
    }
    error = 'the reply was not a JSON object'
  } catch (e) {
    error = (e as Error).message
  }
  const records = planBookkeeping(content, before, written)
  return { records, trace: trace(records, error) }
}
