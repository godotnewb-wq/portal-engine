import type { Character, Haunt } from '@engine/characters'
import { GATED_ACTIONS, type Ruleset } from '@engine/rules'
import type { CodexEntry } from '@engine/codex'

/**
 * Checks a character card's milestone-4a fields against the ruleset's vocabularies (npc design §3–8): age, haunts,
 * layers, expression, gates and blockers, motives, growth words, and per-secret disclosure minimums. Problems stop the
 * pack, as does a card incomplete for its tier (`cardFormProblems`).
 */
export function cardProblems(r: Ruleset, codex: CodexEntry[], c: Character): string[] {
  const p = r.people
  const problems: string[] = []
  const bad = (what: string, w: string, list: readonly string[]) => {
    if (!list.includes(w)) problems.push(`${c.id}: ${what} "${w}" isn't one of: ${list.join(', ')}`)
  }
  const meters = r.meters.list.map((m) => m.id)
  const rungs = p.ladder.map((x) => x.word)
  const meterWords = (where: string, m: Record<string, string>) => {
    for (const [meter, w] of Object.entries(m)) {
      if (!meters.includes(meter)) problems.push(`${c.id}: ${where} names unknown meter "${meter}"`)
      else bad(`${where}'s ${meter}`, w, rungs)
    }
  }

  if (c.age !== undefined) bad('age', c.age, p.ages.stages)

  const places = new Set(codex.filter((e) => e.kind === 'location').map((e) => e.id))
  c.haunts.forEach((h, i) => {
    if (!places.has(h.location)) problems.push(`${c.id}: haunt ${i + 1} is at "${h.location}", which isn't a codex location`)
    if (h.from === h.to) problems.push(`${c.id}: haunt ${i + 1} starts and ends at ${h.from}`)
    if (Array.isArray(h.days)) for (const d of h.days) if (!DAYS.includes(d)) problems.push(`${c.id}: haunt ${i + 1} names unknown day "${d}"`)
  })
  for (let i = 0; i < c.haunts.length; i++) {
    for (let j = i + 1; j < c.haunts.length; j++) if (hauntsOverlap(c.haunts[i]!, c.haunts[j]!)) problems.push(`${c.id}: haunts ${i + 1} and ${j + 1} overlap`)
  }

  const L = c.layers
  if (L) {
    const axes = (where: string, given: Record<string, string>, list: Ruleset['people']['axes']) => {
      for (const [id, stage] of Object.entries(given)) {
        const a = list.find((x) => x.id === id)
        if (!a) problems.push(`${c.id}: ${where} names unknown axis "${id}"`)
        else bad(`${a.name}`, stage, a.stages)
      }
    }
    axes('layers.axes', L.axes, p.axes)
    axes('layers.attachment', L.attachment, p.attachment)
    const values = p.values.list.map((v) => v.id)
    L.values.forEach((v) => {
      bad('value', v.value, values)
      bad(`strength of "${v.value}"`, v.strength, p.values.strengths)
    })
    for (const v of L.values.filter((v, i) => L.values.findIndex((w) => w.value === v.value && w.personal === v.personal) !== i)) problems.push(`${c.id}: value "${v.value}" is listed twice`)
    for (const [id, s] of Object.entries(L.foundations)) {
      bad('foundation', id, p.foundations.list.map((f) => f.id))
      bad(`sensitivity for "${id}"`, s, p.foundations.sensitivities)
    }
  }

  const E = c.expression
  if (E) {
    const families = p.emotions.families.filter((f) => !f.moodOnly).map((f) => f.id)
    for (const [f, level] of Object.entries(E.masking)) {
      bad('masked family', f, families)
      bad(`masking for "${f}"`, level, p.masking.levels)
    }
    for (const f of Object.keys(E.display)) bad('display family', f, families)
    for (const s of Object.keys(E.shades)) bad('display shade', s, p.emotions.shades.map((x) => x.word))
  }

  for (const [action, g] of Object.entries(c.gates)) {
    bad('gated action', action, GATED_ACTIONS)
    if (g.base) meterWords(`gates.${action}.base`, g.base)
    if (g.fixed) meterWords(`gates.${action}.fixed`, g.fixed)
  }
  for (const b of c.blockers) bad('blocked action', b.action, GATED_ACTIONS)

  const types = p.motives.types.map((t) => t.id)
  for (const m of c.motives) {
    bad('motive type', m.type, types)
    bad(`strength of the ${m.type} motive`, m.strength, p.motives.strengths.map((s) => s.word))
  }
  if (c.motives.length > p.motives.max) problems.push(`${c.id}: ${c.motives.length} motives; at most ${p.motives.max}`)
  for (const m of c.motives.filter((m, i) => c.motives.findIndex((n) => n.type === m.type && n.evidence === m.evidence) !== i)) {
    problems.push(`${c.id}: two ${m.type} motives with the same evidence "${m.evidence}" are one motive`)
  }

  if (c.malleability !== undefined) bad('malleability', c.malleability, p.malleability)
  const lockable = [...p.axes.map((a) => a.id), ...p.attachment.map((a) => a.id), 'values', 'foundations', 'malleability']
  for (const [field, lock] of Object.entries(c.fieldLocks)) {
    bad('locked field', field, lockable)
    bad(`lock on "${field}"`, lock, p.fieldLocks)
  }

  for (const s of c.secrets) if (s.disclose) meterWords(`secret "${s.id}"'s disclose`, s.disclose)
  return problems
}

/**
 * Relationship tags across the cast (relationships §3): only the ruleset's tags, at most its limit per direction, no tag
 * twice, and every tag that isn't one-sided mirrored by its counterpart on the other side. Tags toward the player
 * aren't mirrored: the player holds none.
 */
export function tieProblems(r: Ruleset, characters: Character[]): string[] {
  const t = r.ties
  const problems: string[] = []
  const byId = new Map(t.tags.map((x) => [x.id, x]))
  const direction = (where: string, tags: { tag: string }[]) => {
    for (const x of tags) if (!byId.has(x.tag)) problems.push(`${where} uses unknown tag "${x.tag}"`)
    if (tags.length > t.max) problems.push(`${where} holds ${tags.length} tags; at most ${t.max}`)
    for (const x of tags.filter((x, i) => tags.findIndex((y) => y.tag === x.tag) !== i)) problems.push(`${where} holds "${x.tag}" twice`)
  }
  for (const c of characters) {
    if (c.playerTie) direction(`${c.id} toward the player`, c.playerTie.tags)
    for (const to of c.relations.map((r) => r.to).filter((to, i, all) => all.indexOf(to) !== i)) problems.push(`${c.id} has two relations toward ${to}`)
    for (const rel of c.relations) {
      direction(`${c.id} toward ${rel.to}`, rel.tags)
      const back = characters.find((o) => o.id === rel.to)?.relations.find((x) => x.to === c.id)
      for (const x of rel.tags) {
        const def = byId.get(x.tag)
        if (!def || def.oneSided) continue
        if (!back?.tags.some((y) => y.tag === def.counterpart)) problems.push(`${c.id} holds "${x.tag}" toward ${rel.to}, who doesn't hold "${def.counterpart}" back`)
      }
    }
  }
  return problems
}

/** A card missing what its tier's form expects (the ruleset's `people.forms`; npc design §3). Problems since the cast was rewritten (milestone 4a task 6). */
export function cardFormProblems(r: Ruleset, c: Character): string[] {
  const form = r.people.forms[c.tier]
  if (!form) return []
  const out: string[] = []
  const range = (what: string, n: number, [lo, hi]: [number, number]) => {
    if (n < lo || n > hi) out.push(`${c.id} (${c.tier}) lists ${n} ${what}; the form expects ${lo === hi ? lo : `${lo}–${hi}`}`)
  }
  if (c.age === undefined) out.push(`${c.id} has no age stage`)
  if (c.malleability === undefined) out.push(`${c.id} has no malleability`)
  if (!c.voice.shifts.afraid) out.push(`${c.id}'s voice card has no afraid shift`)
  range('haunts', c.haunts.length, form.haunts)
  range('tells', c.tells.length, form.tells)
  range('personality axes', Object.keys(c.layers?.axes ?? {}).length, form.axes)
  range('values', c.layers?.values.length ?? 0, form.values)
  if (form.attachment) for (const a of r.people.attachment) if (!c.layers?.attachment[a.id]) out.push(`${c.id} (${c.tier}) has no ${a.name} stage`)
  if (form.allFoundations) for (const f of r.people.foundations.list) if (!c.layers?.foundations[f.id]) out.push(`${c.id} (${c.tier}) has no ${f.name} sensitivity`)
  const families = r.people.emotions.families.filter((f) => !f.moodOnly)
  const missing = families.filter((f) => !c.expression?.display[f.id])
  if (missing.length > 0) out.push(`${c.id} has no display line for ${missing.map((f) => f.id).join(', ')}`)
  return out
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const WEEKDAYS = DAYS.slice(0, 5)

/** The days a haunt applies to. */
function daysOf(h: Haunt): string[] {
  if (h.days === undefined) return DAYS
  if (h.days === 'weekdays') return WEEKDAYS
  if (h.days === 'weekends') return DAYS.slice(5)
  return h.days
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))

/**
 * Whether two haunts can be in force at once: a shared day and overlapping hours. A window that crosses midnight is
 * split in two, with its late part counted on the next day.
 */
export function hauntsOverlap(a: Haunt, b: Haunt): boolean {
  const spans = (h: Haunt) => {
    const from = minutes(h.from)
    const to = minutes(h.to)
    // A zero-length window or an unknown day is reported on its own; it overlaps nothing.
    const days = daysOf(h).filter((d) => DAYS.includes(d))
    if (from === to) return []
    if (from < to) return days.map((d) => ({ day: d, from, to }))
    const next = (d: string) => DAYS[(DAYS.indexOf(d) + 1) % 7]!
    return days.flatMap((d) => [{ day: d, from, to: 1440 }, { day: next(d), from: 0, to }])
  }
  return spans(a).some((x) => spans(b).some((y) => x.day === y.day && x.from < y.to && y.from < x.to))
}
