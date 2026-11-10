import { factionById, factionChain, type Setting } from '@engine/world'
import { firstName } from '@engine/core'
import { fits, knows, type Knower } from './knowledge'
import { locationChain } from './load'
import type { CodexEntry, CodexKind } from './schema'

/**
 * The three lore layers (claude/lore-injection.md §5): the stage, always on and cached; the scene-scoped layer, from
 * where the scene is and who is in it, rebuilt every turn; and the triggered layer, from what was just said. Pure
 * lookups: no LLM call, and the same inputs always give the same text, so an unchanged layer stays in the cache.
 */

/** Rough token count for budgets and reports: about four characters a token. */
export const tokensOf = (text: string) => Math.ceil(text.length / 4)

/** Kinds in the order layers list them, and (reversed) the order they give way under budget pressure. */
const KIND_ORDER: CodexKind[] = ['location', 'faction', 'species-culture', 'philosophy', 'event', 'concept', 'world', 'species-drawable']
const STAGE_ORDER: CodexKind[] = ['world', 'location', 'species-culture', 'philosophy', 'faction', 'concept', 'event']

function byKind(order: CodexKind[], setting: Setting) {
  const tierIndex = (e: CodexEntry) => setting.tiers.findIndex((t) => t.id === e.id.split('.')[1])
  const factionIndex = (e: CodexEntry) => setting.factions.findIndex((f) => f.id === e.faction)
  const speciesIndex = (e: CodexEntry) => setting.species.findIndex((s) => s.id === e.id.split('.')[1])
  return (a: CodexEntry, b: CodexEntry) => {
    const k = order.indexOf(a.kind) - order.indexOf(b.kind)
    if (k !== 0) return k
    // Locations deepest first (place, region, tier); the setting's own order where it has one; then ids.
    if (a.kind === 'location') return (b.layer ?? 0) - (a.layer ?? 0) || tierIndex(a) - tierIndex(b) || a.id.localeCompare(b.id)
    if (a.kind === 'faction') return factionIndex(a) - factionIndex(b) || a.id.split('.').length - b.id.split('.').length || a.id.localeCompare(b.id)
    if (a.kind === 'species-culture') return speciesIndex(a) - speciesIndex(b) || a.id.localeCompare(b.id)
    return a.id.localeCompare(b.id)
  }
}

export interface Stage {
  text: string
  /** The entries whose stage lines it carries. */
  ids: string[]
  tokens: number
}

/** The director's stage: the pack's primer, then every common entry's one-line public version, in a fixed order. */
export function directorStage(primer: string, codex: CodexEntry[], setting: Setting): Stage {
  const lines = codex.filter((e) => e.stage && e.knowledge === 'common').sort(byKind(STAGE_ORDER, setting))
  const text = [primer, ...(lines.length > 0 ? ['What any local knows:', ...lines.map((e) => `- ${e.stage}`)] : [])].join('\n')
  return { text, ids: lines.map((e) => e.id), tokens: tokensOf(text) }
}

const isFactionMain = (e: CodexEntry) => e.kind === 'faction' && e.id.split('.').at(-1) === e.faction

/**
 * The names a writer may use for groups and places: every common place, faction, worldview and piece of world
 * background, with their aliases. Descriptive titles ("How the grid really runs") aren't names, so they're left out.
 */
export function canonNames(codex: CodexEntry[]): string[] {
  const named = codex.filter((e) => e.knowledge === 'common' && (e.kind === 'location' || e.kind === 'world' || e.kind === 'philosophy' || isFactionMain(e)))
  return [...new Set(named.flatMap((e) => [e.name, ...e.aliases]))]
}

/** The line telling the writer which names exist; empty for a pack with no codex. */
export function namesLine(codex: CodexEntry[]): string {
  const names = canonNames(codex)
  return names.length > 0 ? `Names in this world (for groups and places, use only these or a plain description): ${names.join('; ')}.` : ''
}

/** The writer's short stage: the pack's tone, and the names it may use. */
export function writerStage(tone: string, codex: CodexEntry[]): Stage {
  const text = [tone && `Tone:\n${tone}`, namesLine(codex)].filter(Boolean).join('\n\n')
  return { text, ids: [], tokens: tokensOf(text) }
}

export interface LoreScene {
  /**
   * The codex location the scene is at. A place's id is its region's id plus the location file's id, by convention
   * (`location.<tier>.<region>.<location id>`); when the place has no entry, the region's chain is used.
   */
  location?: { id: string; parent?: string }
  present: Knower[]
  /** What the player said (this input and their recent lines): matched in any case, since players don't capitalize reliably. */
  texts: string[]
  /**
   * What the model wrote (recent beats, the scene summary). Here a one-word name or alias that the codex capitalizes
   * matches only when capitalized, so "the mill burned" doesn't bring in a faction called "the Mill".
   */
  written?: string[]
  /** Character names, which never trigger an entry even if a keyword is inside one. */
  ignore: string[]
}

export interface LayerEntry {
  id: string
  /** The entry's name, so logs read without the codex at hand. */
  name: string
  form: 'full' | 'summary'
}

export interface Layer {
  text: string
  entries: LayerEntry[]
  tokens: number
}

export interface LoreLayers {
  scene: Layer
  triggered: Layer
  /** Official stances between the factions in play, one line per direction that has one. */
  stances: string[]
}

export interface LoreBudget {
  sceneTokens: number
  triggeredTokens: number
  /** The pack's words for the five stance levels, warmest first. */
  stanceWords?: string[]
}

/** Entries the layers may carry. Secrets never come this way: they arrive on a holder's sheet (§5). */
const open = (e: CodexEntry) => e.knowledge !== 'secret' && e.audience.includes('director') && e.kind !== 'species-drawable'

function sceneEntries(codex: CodexEntry[], setting: Setting, scene: LoreScene): { full: Set<string>; summary: Set<string> } {
  const full = new Set<string>()
  const ids = new Set(codex.map((e) => e.id))
  const loc = scene.location
  if (loc?.parent) {
    const place = `${loc.parent}.${loc.id}`
    for (const e of locationChain(codex, ids.has(place) ? place : loc.parent)) full.add(e.id)
  }
  for (const p of scene.present) {
    if (p.faction) for (const f of factionChain(setting, p.faction)) full.add(codexFactionId(setting, f.id))
    full.add(`species.${p.species}`)
  }
  // Insider entries someone's trade opens come with them (an "occupation" selector that fits).
  for (const e of codex)
    if (e.knowledge === 'circles' && [...(e.circle ? [e.circle] : []), ...e.also].some((s) => s.by === 'occupation' && scene.present.some((p) => fits(setting, s, p)))) full.add(e.id)
  const summary = new Set<string>()
  for (const id of full) for (const r of codex.find((e) => e.id === id)?.related ?? []) if (!full.has(r)) summary.add(r)
  return { full, summary }
}

/** A faction's codex id follows its sub-group chain: a sub-group's folder sits inside its parent's. */
export const codexFactionId = (setting: Setting, faction: string) =>
  ['faction', ...factionChain(setting, faction).map((f) => f.id).reverse()].join('.')

const normalize = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** An entry's own words: its keywords, its name and its aliases, without a leading "the" so "the Order" and "Order" both match. */
const termsOf = (e: CodexEntry) => [...new Set([...e.keywords, e.name, ...e.aliases].map((t) => normalize(t).replace(/^the /, '')).filter((t) => t.length > 1))]
/** Whole words, any case, with simple plurals. */
const matches = (text: string, term: string) => new RegExp(`(?<![\\w-])${escape(term).replace(/ /g, '\\s+')}(?:s|es)?(?![\\w-])`).test(text)

/** Removes character names, so a keyword inside a name never triggers an entry. Case is kept for the strict match. */
function withoutNames(texts: string[], ignore: string[]): string {
  let text = texts.join('\n').replace(/[’‘]/g, "'").replace(/\s+/g, ' ')
  for (const name of [...ignore].sort((a, b) => b.length - a.length)) text = text.replace(new RegExp(`(?<![\\w-])${escape(normalize(name))}(?![\\w-])`, 'gi'), ' ')
  return text
}

/**
 * The capitalized one-word forms of an entry's name and aliases ("Mill" from "the Mill"). In model-written text these
 * match only as written, because the same word in lowercase is usually the ordinary word. Keywords stay any case.
 */
const strictTermsOf = (e: CodexEntry) =>
  new Set([e.name, ...e.aliases].map((t) => t.trim().replace(/^the /i, '')).filter((t) => !/\s/.test(t) && /^\p{Lu}/u.test(t)).map(normalize))

const matchesAsWritten = (text: string, term: string) =>
  new RegExp(`(?<![\\w-])${escape(term[0]!.toUpperCase() + term.slice(1))}(?:s|es)?(?![\\w-])`).test(text)

/** Entries whose words appear in the texts, and, for a faction named, its other entries too (§5, Triggered). */
export function triggeredEntries(codex: CodexEntry[], texts: string[], ignore: string[], written: string[] = []): CodexEntry[] {
  const said = normalize(withoutNames(texts, ignore))
  const wrote = withoutNames(written, ignore)
  const wroteLower = normalize(wrote)
  const hit = codex.filter((e) => {
    const strict = strictTermsOf(e)
    return termsOf(e).some((t) => matches(said, t) || (strict.has(t) ? matchesAsWritten(wrote, t) : matches(wroteLower, t)))
  })
  const named = hit.filter(isFactionMain)
  const deeper = codex.filter((e) => e.kind === 'faction' && named.some((f) => e.faction === f.faction && e.id.startsWith(`${f.id}.`)))
  return [...new Set([...hit, ...deeper])]
}

/** How specific an entry is: the least specific give way first under budget pressure. */
function specificity(e: CodexEntry): number {
  if (e.kind === 'location') return 100 + (e.layer ?? 0)
  return 50 - KIND_ORDER.indexOf(e.kind) + (e.kind === 'faction' ? e.id.split('.').length : 0)
}

/** Who present knows each insider entry, by first name; an insider entry nobody here knows isn't carried at all. */
type Knowers = Map<string, string[]>

function render(entries: CodexEntry[], forms: Map<string, 'full' | 'summary'>, knowers: Knowers): string {
  const note = (e: CodexEntry) => (knowers.has(e.id) ? ` (insider knowledge: only ${knowers.get(e.id)!.join(', ')} here know${knowers.get(e.id)!.length === 1 ? 's' : ''} this)` : '')
  return entries.map((e) => (forms.get(e.id) === 'full' ? `## ${e.name} [${e.id}]${note(e)}\n${e.full}` : `- ${e.name} [${e.id}]${note(e)}: ${e.summary}`)).join('\n')
}

/** Fits a layer to its budget: least specific entries drop to their summaries first, then drop out. */
function fit(entries: CodexEntry[], forms: Map<string, 'full' | 'summary'>, budget: number, order: (a: CodexEntry, b: CodexEntry) => number, knowers: Knowers): Layer {
  const kept = [...entries].sort(order)
  const giveWay = [...kept].sort((a, b) => specificity(a) - specificity(b) || a.id.localeCompare(b.id))
  const over = () => tokensOf(render(kept, forms, knowers)) > budget
  for (const e of giveWay) {
    if (!over()) break
    if (forms.get(e.id) === 'full') forms.set(e.id, 'summary')
  }
  for (const e of giveWay) {
    if (!over()) break
    kept.splice(kept.indexOf(e), 1)
  }
  const text = render(kept, forms, knowers)
  return { text, entries: kept.map((e) => ({ id: e.id, name: e.name, form: forms.get(e.id)! })), tokens: tokensOf(text) }
}

/**
 * Official stances among the factions in play (§5, Generated lines), from setting data, one line per direction that
 * has one. A stance toward a faction covers its sub-groups unless they have their own; when the parent is in play
 * too, the sub-group's inherited line is left out as a repeat.
 */
export function stanceLines(setting: Setting, words: string[], factions: string[]): string[] {
  if (words.length === 0) return []
  const inPlay = [...new Set(factions)].filter((f) => factionById(setting, f))
  const lines: string[] = []
  for (const from of inPlay)
    for (const toward of inPlay) {
      if (from === toward) continue
      const chain = factionChain(setting, toward)
      const holder = chain.find((t) => setting.stances.some((s) => s.from === from && s.toward === t.id))
      if (!holder || (holder.id !== toward && inPlay.includes(holder.id))) continue
      const stance = setting.stances.find((s) => s.from === from && s.toward === holder.id)!.stance
      lines.push(`- ${factionById(setting, from)!.name} toward ${factionById(setting, toward)!.name}: ${stance}`)
    }
  return lines
}

/**
 * The scene-scoped and triggered layers for one turn. An entry in the scene layer isn't repeated in the triggered
 * one. Insider entries come in only when someone present knows them, marked with who.
 */
export function loreLayers(codex: CodexEntry[], setting: Setting, scene: LoreScene, budget: LoreBudget): LoreLayers {
  const knowers: Knowers = new Map()
  for (const e of codex)
    if (e.knowledge === 'circles') {
      const who = scene.present.filter((p) => knows(setting, e, p)).map((p) => firstName(p.name))
      if (who.length > 0) knowers.set(e.id, who)
    }
  const byId = new Map(codex.filter((e) => open(e) && (e.knowledge === 'common' || knowers.has(e.id))).map((e) => [e.id, e]))
  const order = byKind(KIND_ORDER, setting)
  const { full, summary } = sceneEntries(codex, setting, scene)
  const sceneForms = new Map<string, 'full' | 'summary'>()
  for (const id of full) if (byId.has(id)) sceneForms.set(id, 'full')
  for (const id of summary) if (byId.has(id) && !sceneForms.has(id)) sceneForms.set(id, 'summary')
  const sceneLayer = fit([...sceneForms.keys()].map((id) => byId.get(id)!), sceneForms, budget.sceneTokens, order, knowers)

  const inScene = new Set(sceneLayer.entries.filter((e) => e.form === 'full').map((e) => e.id))
  const hits = triggeredEntries([...byId.values()], scene.texts, scene.ignore, scene.written).filter((e) => !inScene.has(e.id))
  const triggeredForms = new Map(hits.map((e) => [e.id, 'full' as const]))
  const triggered = fit(hits, triggeredForms as Map<string, 'full' | 'summary'>, budget.triggeredTokens, order, knowers)
  const factions = [...sceneLayer.entries, ...triggered.entries].flatMap((l) => codex.find((e) => e.id === l.id)?.faction ?? []).concat(scene.present.flatMap((p) => p.faction ?? []))
  return { scene: sceneLayer, triggered, stances: stanceLines(setting, budget.stanceWords ?? [], factions) }
}
