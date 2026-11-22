import { z } from 'zod'
import type { Prompt } from '@engine/core'
import { firstName } from '@engine/core'
import { characterById, locationById, type Pack } from '@engine/pack'
import { lineText, moodOf, planLines as exchangeOf, scenePlanLines } from '@engine/scene'
import { FLAG_REASONS, RATINGS, type FlagReason, type Rating } from './flags'
import { itemsFor, itemText, type ScorableTurn } from './rubric'

/**
 * Bumped when the scorer's prompt or reading changes, so scores from different scorers aren't mixed up. Version 2
 * (Milestone 5 task 6): three new items (16–18), the plan items worded for the scene plan, the scene plan shown as
 * itself and the situation plan with its exchange, and a scene turn's beats marked by paragraph. Version 3 (task 8):
 * item 6 judges the plan, not the prose (it was grading whether the beats paid off the stakes), and item 8 on a scene
 * turn no longer counts anyone present who isn't in focus as unlisted (the scene plan lets them say a little).
 */
export const SCORER_VERSION = 3

/** One rubric score, with the reason in a line. */
export interface ItemScore {
  id: number
  score: number
  reason: string
}

/** A beat the scorer thought stood out, good or bad, with reasons from the same fixed list human flags use. */
export interface BeatMark {
  beat: number
  rating: Rating
  reasons: FlagReason[]
  note: string
}

/** One line of a session's `scores.jsonl`. */
export interface ScoreRecord {
  /** The session that recorded the turn. */
  turnSession: string
  turnId: string
  scorer: { version: number; profile?: string; model?: string }
  at: string
  items: ItemScore[]
  beats: BeatMark[]
  /** The scorer's call, in the scoring session's `calls.jsonl`. */
  callId?: string
}

const SYSTEM = (items: ReturnType<typeof itemsFor>, turn: ScorableTurn) => `You review one turn of a visual-novel RPG scene for writing quality. A director planned the turn as JSON; the game rolled the checks; a writer wrote the beats the player read. You did not write any of it. Judge it strictly: a 5 is rare and earned, a 3 is serviceable, a 1 is a clear failure.

Score each item 1–5 with a one-line reason that points at the beat or plan field it is about:
${items.map((i) => `${i.id}. [${i.part}] ${itemText(i, turn)}`).join('\n')}

Then mark only the beats that clearly stand out, good or bad, with reasons from this list: ${FLAG_REASONS.join(', ')}.

Reply with only a JSON object:
{"items": [{"id": 1, "score": 3, "reason": "..."}], "beats": [{"beat": 2, "rating": "bad", "reasons": ["voice"], "note": "..."}]}
rating is one of: ${RATINGS.join(', ')}.`

/**
 * The scorer's prompt for one turn: the same material a person reviewing it would use. It never sees human flags,
 * so its scores stay independent of them. World material comes from the pack through the same slots the director
 * and writer use (tone, location, character cards).
 */
export function buildScorerPrompt(content: Pack, turn: ScorableTurn, locationId: string, earlier: string[] = []): Prompt {
  const plan = turn.director.plan
  const location = locationById(content, locationId)
  const nameOf = (id: string) => {
    const c = characterById(content, id)
    if (c) return firstName(c.name)
    const w = location?.walkOns.find((x) => x.id === id)
    return w?.name ?? w?.label ?? id
  }
  const cards = turn.cast.before.flatMap(({ id, mood, comfort }) => {
    const c = characterById(content, id)
    if (!c) return []
    const v = c.voice
    return [
      [
        `## ${firstName(c.name)} [${id}]`,
        `Agenda: ${c.agenda.longTerm.join('; ')}. Tonight: ${c.agenda.current}`,
        `Voice: ${v.rhythm}. ${v.vocabulary}.${v.avoids.length ? ` Avoids: ${v.avoids.join('; ')}.` : ''} Sample lines: ${v.sampleLines.map((l) => `"${l}"`).join(' ')}`,
        `Lying: ${v.shifts.lying}`,
        ...c.secrets.map((s) => `Secret: ${s.text} Tell: ${s.tell}.`),
        `Going in: mood ${mood}, comfort ${comfort}/5.`
      ].join('\n')
    ]
  })
  const system = [
    SYSTEM(itemsFor(turn), turn),
    content.tone && `# The pack's tone\n${content.tone}`,
    location && `# Location: ${location.name}, ${location.district}\nSights: ${location.texture.sights.join('; ')}\nSounds: ${location.texture.sounds.join('; ')}\nSmells: ${location.texture.smells.join('; ')}`,
    `# Characters\n${cards.join('\n\n')}`
  ]
    .filter(Boolean)
    .join('\n\n')

  // The plan as its own shape: a scene plan's moments, pressures and stakes; the situation plan's exchange, which it
  // didn't list before version 2, as well as its speakers and reactions.
  const scene = plan.scene
  const exchange = exchangeOf(plan)
  const secretText = (ref: string) => turn.cast.before.flatMap(({ id }) => characterById(content, id)?.secrets.filter((x) => `${id}.${x.id}` === ref || x.id === ref).map((x) => x.text) ?? [])[0]
  const planLines = scene
    ? [
        ...scenePlanLines(scene, nameOf).filter((l) => !l.startsWith('Underneath') && !l.includes(' may draw on: ')).map((l) => `- ${l}`),
        ...scene.pressures.map((x) => `- Underneath, ${nameOf(x.who)}: ${x.kind === 'secret' ? `keeping ${secretText(x.ref) ?? x.text} (${x.approach ?? 'deflect'})` : x.kind === 'tie' ? `the tie with ${x.ref === 'player' ? 'the player' : nameOf(x.ref)}: ${x.text}` : `the aim${x.strength ? ` (${x.strength})` : ''}: ${x.text}`}`),
        ...Object.entries(scene.pools).map(([who, pool]) => `- ${nameOf(who)} may draw on: ${pool.map((f) => f.text).join('; ')}`),
        ...plan.walk_ons.map((w) => `- Walk-on ${nameOf(w.id)}: ${w.line}`)
      ]
    : [
        ...exchange.map((_, i) => `- Line ${lineText(exchange, i, nameOf)}`),
        ...plan.speakers.map((s) => `- ${nameOf(s.id)} speaks. Intent: ${s.intent}${moodOf(s) ? `; feels: ${moodOf(s)}` : ''}${s.hiding ? `; hiding: ${s.hiding} (${s.approach ?? 'deflect'})` : ''}${s.depends_on_check ? `; depends on check ${s.depends_on_check}` : ''}`),
        ...plan.reactions.map((r) => `- ${nameOf(r.id)} reacts (no dialogue): ${r.beat}${r.feels ? `; feels: ${moodOf(r)}` : ''}`),
        ...plan.walk_ons.map((w) => `- Walk-on ${nameOf(w.id)}: ${w.line}`),
        plan.texture.length > 0 && `- Texture: ${plan.texture.join('; ')}`,
        plan.contrast && `- Contrast: ${plan.contrast}`,
        plan.avoid.length > 0 && `- Avoid: ${plan.avoid.join('; ')}`
      ].filter(Boolean)
  // A scene turn is written in paragraphs the game cuts into beats; ¶ marks where the writer's paragraphs begin, so
  // pacing is judged on what was written (m5-scene-3: the scorer counted the cut beats, "sixteen beats for one exchange").
  const paragraph = new Map<number, number>()
  turn.beats.forEach((b, i) => {
    const prev = turn.beats[i - 1]
    paragraph.set(b.index, !prev || prev.source !== b.source || prev.line !== b.line ? (paragraph.get(prev?.index ?? -1) ?? 0) + 1 : paragraph.get(prev.index)!)
  })
  const mark = (b: ScorableTurn['beats'][number], i: number) => (scene && (i === 0 || paragraph.get(b.index) !== paragraph.get(turn.beats[i - 1]!.index)) ? `¶${paragraph.get(b.index)} ` : '')
  const user = [
    earlier.length > 0 && `# Earlier turns\n${earlier.join('\n\n')}`,
    `# The player says or does\n${turn.input}`,
    `# The director's plan\n${planLines.join('\n')}`,
    turn.checks.length > 0 && `# Check results\n${turn.checks.map((c) => `- [${c.id}] ${c.line}. Stakes: ${c.stakes}`).join('\n')}`,
    `# The beats as shown\n${turn.beats.map((b, i) => `${mark(b, i)}${b.index}. ${b.beat.kind === 'narration' ? `NARRATION: ${b.beat.text}` : `${nameOf(b.beat.speaker)}: ${b.beat.text}`}`).join('\n')}`,
    'Return the JSON review.'
  ]
    .filter(Boolean)
    .join('\n\n')
  return { system, user }
}

const ReplySchema = z.object({
  items: z.array(z.unknown()).catch([]),
  beats: z.array(z.unknown()).catch([])
})
const ItemSchema = z.object({ id: z.coerce.number().int(), score: z.coerce.number(), reason: z.string().catch('') })
const MarkSchema = z.object({
  beat: z.coerce.number().int(),
  rating: z.enum(RATINGS),
  reasons: z.array(z.string()).catch([]),
  note: z.string().catch('')
})

/**
 * Reads the scorer's reply, keeping only what makes sense for the turn: items it was asked about, scores clamped to
 * 1–5, beats that exist, reasons on the list. An unreadable reply scores nothing.
 */
export function parseScore(reply: string, turn: ScorableTurn): { items: ItemScore[]; beats: BeatMark[] } | null {
  const body = reply.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
  const parsed = ReplySchema.safeParse(raw)
  if (!parsed.success) return null
  const asked = new Set(itemsFor(turn).map((i) => i.id))
  const items = parsed.data.items.flatMap((x) => {
    const item = ItemSchema.safeParse(x)
    if (!item.success || !asked.has(item.data.id) || !Number.isFinite(item.data.score)) return []
    return [{ id: item.data.id, score: Math.min(5, Math.max(1, Math.round(item.data.score))), reason: item.data.reason.trim() }]
  })
  const reasons = new Set<string>(FLAG_REASONS)
  const beats = parsed.data.beats.flatMap((x) => {
    const mark = MarkSchema.safeParse(x)
    if (!mark.success || mark.data.beat < 1 || mark.data.beat > turn.beats.length) return []
    return [{ beat: mark.data.beat, rating: mark.data.rating, reasons: mark.data.reasons.map((r) => r.trim().toLowerCase()).filter((r): r is FlagReason => reasons.has(r)), note: mark.data.note.trim() }]
  })
  // The same item twice: the first answer stands.
  const seen = new Set<number>()
  return { items: items.filter((i) => !seen.has(i.id) && (seen.add(i.id), true)), beats }
}
