import { factionById, factionChain, tierById, type Location, type Setting } from '@engine/world'
import { MAX_LOCATION_LAYER, selectorText, type CodexEntry, type Selector } from './schema'

/**
 * The most words in a lore line the director writes for the writer: one fact in plain words (lore injection.md §8).
 * An entry's summary keeps to it too, because the summary stands in for a line that runs long.
 */
export const LORE_LINE_WORDS = 30

/** What the content check needs from the rest of the pack. */
export interface CodexContext {
  setting: Setting
  characterIds: string[]
  /** The pack's playable places, whose `parent` must be a region in the codex. */
  locations: Location[]
  /** The most words an entry's full text may have (the ruleset's `codex.fullWords`). */
  fullWords: number
  /** Words that suggest prose is stating a stance, which belongs in setting data (the pack's `stanceWarnings`). */
  stanceWarnings: string[]
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const lower = (s: string) => s.toLowerCase()
/** An entry's in-world names: its label and aliases. */
const names = (e: CodexEntry) => [...(e.label ? [e.label] : []), ...e.aliases]
/** A name as compared for uniqueness: any case, curly or straight apostrophes, without a leading "the". */
const nameKey = (s: string) => lower(s).replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().replace(/^the /, '')
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Two entries are related when one is inside the other's folder, or they share one: a faction and its deeper files. */
function related(a: CodexEntry, b: CodexEntry): boolean {
  // Siblings count only inside a subject's folder: two concepts at the top of concepts/ aren't related by that alone.
  const parent = (id: string) => id.split('.').slice(0, -1)
  const same = parent(a.id).length > 1 && parent(a.id).join('.') === parent(b.id).join('.')
  return a.id.startsWith(`${b.id}.`) || b.id.startsWith(`${a.id}.`) || same || a.related.includes(b.id) || b.related.includes(a.id)
}

function selectorProblems(s: Selector, ctx: CodexContext): string[] {
  if (s.by === 'faction' && !factionById(ctx.setting, s.faction)) return [`"${selectorText(s)}" names unknown faction "${s.faction}"`]
  if (s.by === 'tier' && !tierById(ctx.setting, s.tier)) return [`"${selectorText(s)}" names unknown tier "${s.tier}"`]
  if (s.by === 'species' && !ctx.setting.species.some((x) => x.id === s.species)) return [`"${selectorText(s)}" names unknown species "${s.species}"`]
  if (s.by === 'character' && !ctx.characterIds.includes(s.character)) return [`"${selectorText(s)}" names unknown character "${s.character}"`]
  return []
}

/**
 * Problems across the codex that stop a pack loading (lore injection.md §4, Content check): duplicate ids and
 * keywords, clashing aliases, oversized text, secrets the writer could see, misplaced stage lines and selectors, names
 * of things that don't exist, and a map tree that doesn't fit the setting. Warnings are in `codexWarnings`.
 */
export function codexProblems(entries: CodexEntry[], ctx: CodexContext): string[] {
  const problems: string[] = []
  const at = (e: CodexEntry, p: string) => problems.push(`codex/${e.file}: ${p}`)
  const ids = new Map<string, CodexEntry>()

  for (const e of entries) {
    const twin = ids.get(e.id)
    if (twin) at(e, `gives the same id as ${twin.file} (${e.id})`)
    ids.set(e.id, e)
  }

  for (const e of entries) {
    if (words(e.summary) > LORE_LINE_WORDS) at(e, `its summary is ${words(e.summary)} words; the most is ${LORE_LINE_WORDS}, since it stands in for a lore line that runs long`)
    if (words(e.full) > ctx.fullWords) at(e, `its text is ${words(e.full)} words; the most is ${ctx.fullWords}`)
    if (e.knowledge === 'secret' && e.audience.includes('writer')) at(e, 'a secret entry can’t have the writer in its audience')
    if (e.stage && e.knowledge !== 'common') at(e, 'only common entries have a stage line')
    if (e.stage && e.kind === 'faction' && e.id.split('.').length !== 2) at(e, 'only a top-level faction’s main entry has a stage line')
    if (e.knowledge !== 'circles' && (e.circle || e.also.length > 0)) at(e, '"circle" and "also" are for circles entries only (secrets use "known-by")')
    if (e.knowledge === 'circles' && !e.circle && e.also.length === 0) at(e, 'a circles entry outside a faction needs a "circle" or "also" saying who’s inside')
    if (e.knowledge !== 'secret' && (e.knownBy.length > 0 || e.cap !== undefined)) at(e, '"known-by" and "cap" are for secret entries only')
    if (e.knowledge === 'secret' && e.knownBy.length === 0) at(e, 'a secret entry needs "known-by": who may hold it')
    for (const s of [...(e.circle ? [e.circle] : []), ...e.also, ...e.knownBy]) for (const p of selectorProblems(s, ctx)) at(e, p)
    for (const r of e.related) if (!ids.has(r)) at(e, `"related" names unknown entry "${r}"`)

    if (e.kind === 'location') {
      const parts = e.id.split('.').slice(1)
      if (e.layer! > MAX_LOCATION_LAYER) at(e, `locations go ${MAX_LOCATION_LAYER} layers deep at most (tier, region, place)`)
      if (!tierById(ctx.setting, parts[0]!)) at(e, `"${parts[0]}" isn't one of the setting's tiers`)
      // Every layer above has to be written too, so the chain a place reads from its id is complete.
      for (let n = 2; n < parts.length + 1; n++) {
        const up = ['location', ...parts.slice(0, n - 1)].join('.')
        if (!ids.has(up)) at(e, `its parent "${up}" has no entry (add ${up.split('.').slice(1).join('/')}/main.md)`)
      }
    }
    if (e.kind === 'faction' && e.faction) {
      const parts = e.id.split('.').slice(1)
      const folders = parts.at(-1) === e.faction ? parts : parts.slice(0, -1)
      const chain = factionChain(ctx.setting, e.faction).map((f) => f.id).reverse()
      if (chain.length === 0) at(e, `"${e.faction}" isn't one of the setting's factions`)
      else if (chain.join('.') !== folders.join('.')) at(e, `faction folders must follow the setting's sub-groups: expected factions/${chain.join('/')}/`)
    }
  }

  // In-world names are unique across the whole codex, related entries included: a name means one thing.
  const byName = new Map<string, CodexEntry>()
  for (const e of entries)
    for (const n of new Set(names(e).map(nameKey))) {
      const twin = byName.get(n)
      if (twin) at(e, `its label or alias "${n}" is also a label or alias of ${twin.file}`)
      else byName.set(n, e)
    }

  const byKeyword = new Map<string, CodexEntry[]>()
  for (const e of entries) for (const k of new Set([...e.keywords, ...names(e), e.title].map(lower))) byKeyword.set(k, [...(byKeyword.get(k) ?? []), e])
  for (const [k, list] of byKeyword) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i]!, list[j]!]
        if (related(a, b)) continue
        // Two names clashing is reported above.
        if (names(a).map(lower).includes(k) && names(b).map(lower).includes(k)) continue
        at(b, `its keyword or title "${k}" is also used by unrelated ${a.file}`)
      }
  }

  for (const l of ctx.locations) {
    if (!l.parent) continue
    const where = `locations/${l.id}.json`
    const parent = ids.get(l.parent)
    const parts = l.parent.split('.')
    if (!parent || parent.kind !== 'location') problems.push(`${where}: parent "${l.parent}" isn't a codex location`)
    else if (parent.layer !== MAX_LOCATION_LAYER - 1) problems.push(`${where}: parent "${l.parent}" must be a region (layer ${MAX_LOCATION_LAYER - 1})`)
    else if (parts[1] !== l.tier) problems.push(`${where}: parent "${l.parent}" isn't under its tier "${l.tier}"`)
  }
  return problems
}

/** Things worth a look that don't stop a pack loading: stance words in codex text, since stances are setting data. */
export function codexWarnings(entries: CodexEntry[], ctx: Pick<CodexContext, 'stanceWarnings'>): string[] {
  const warnings: string[] = []
  for (const e of entries) {
    const text = [e.summary, e.stage ?? '', e.full].join('\n')
    for (const w of ctx.stanceWarnings) if (new RegExp(`\\b${escape(w)}\\b`, 'i').test(text)) warnings.push(`codex/${e.file}: says "${w}"; stances belong in setting data`)
  }
  return warnings
}
