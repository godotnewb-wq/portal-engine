import { factionChain, type Setting } from '@engine/world'
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

/** Who is in the scene, as the layers need them. */
export interface LorePerson {
  id: string
  name: string
  species: string
  faction?: string
}

export interface LoreScene {
  /**
   * The codex location the scene is at. A place's id is its region's id plus the location file's id, by convention
   * (`location.<tier>.<region>.<location id>`); when the place has no entry, the region's chain is used.
   */
  location?: { id: string; parent?: string }
  present: LorePerson[]
  /** What triggered entries are matched against: the player's input, the last exchanges, the scene summary. */
  texts: string[]
  /** Character names, which never trigger an entry even if a keyword is inside one. */
  ignore: string[]
}

export interface LayerEntry {
  id: string
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
}

export interface LoreBudget {
  sceneTokens: number
  triggeredTokens: number
}

/** Entries that may go in the scene and triggered layers this milestone step: common ones. Circles wait for the knowledge filter; secrets never come this way. */
const open = (e: CodexEntry) => e.knowledge === 'common' && e.audience.includes('director') && e.kind !== 'species-drawable'

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

/** Entries whose words appear in the texts, and, for a faction named, its other entries too (§5, Triggered). */
export function triggeredEntries(codex: CodexEntry[], texts: string[], ignore: string[]): CodexEntry[] {
  let text = normalize(texts.join('\n'))
  for (const name of [...ignore].sort((a, b) => b.length - a.length)) text = text.replace(new RegExp(`(?<![\\w-])${escape(normalize(name))}(?![\\w-])`, 'g'), ' ')
  const hit = codex.filter((e) => termsOf(e).some((t) => matches(text, t)))
  const named = hit.filter(isFactionMain)
  const deeper = codex.filter((e) => e.kind === 'faction' && named.some((f) => e.faction === f.faction && e.id.startsWith(`${f.id}.`)))
  return [...new Set([...hit, ...deeper])]
}

/** How specific an entry is: the least specific give way first under budget pressure. */
function specificity(e: CodexEntry): number {
  if (e.kind === 'location') return 100 + (e.layer ?? 0)
  return 50 - KIND_ORDER.indexOf(e.kind) + (e.kind === 'faction' ? e.id.split('.').length : 0)
}

function render(entries: CodexEntry[], forms: Map<string, 'full' | 'summary'>): string {
  return entries.map((e) => (forms.get(e.id) === 'full' ? `## ${e.name}\n${e.full}` : `- ${e.name}: ${e.summary}`)).join('\n')
}

/** Fits a layer to its budget: least specific entries drop to their summaries first, then drop out. */
function fit(entries: CodexEntry[], forms: Map<string, 'full' | 'summary'>, budget: number, order: (a: CodexEntry, b: CodexEntry) => number): Layer {
  const kept = [...entries].sort(order)
  const giveWay = [...kept].sort((a, b) => specificity(a) - specificity(b) || a.id.localeCompare(b.id))
  const over = () => tokensOf(render(kept, forms)) > budget
  for (const e of giveWay) {
    if (!over()) break
    if (forms.get(e.id) === 'full') forms.set(e.id, 'summary')
  }
  for (const e of giveWay) {
    if (!over()) break
    kept.splice(kept.indexOf(e), 1)
  }
  const text = render(kept, forms)
  return { text, entries: kept.map((e) => ({ id: e.id, form: forms.get(e.id)! })), tokens: tokensOf(text) }
}

/** The scene-scoped and triggered layers for one turn. An entry in the scene layer isn't repeated in the triggered one. */
export function loreLayers(codex: CodexEntry[], setting: Setting, scene: LoreScene, budget: LoreBudget): LoreLayers {
  const byId = new Map(codex.filter(open).map((e) => [e.id, e]))
  const order = byKind(KIND_ORDER, setting)
  const { full, summary } = sceneEntries(codex, setting, scene)
  const sceneForms = new Map<string, 'full' | 'summary'>()
  for (const id of full) if (byId.has(id)) sceneForms.set(id, 'full')
  for (const id of summary) if (byId.has(id) && !sceneForms.has(id)) sceneForms.set(id, 'summary')
  const sceneLayer = fit([...sceneForms.keys()].map((id) => byId.get(id)!), sceneForms, budget.sceneTokens, order)

  const inScene = new Set(sceneLayer.entries.filter((e) => e.form === 'full').map((e) => e.id))
  const hits = triggeredEntries([...byId.values()], scene.texts, scene.ignore).filter((e) => !inScene.has(e.id))
  const triggeredForms = new Map(hits.map((e) => [e.id, 'full' as const]))
  return { scene: sceneLayer, triggered: fit(hits, triggeredForms as Map<string, 'full' | 'summary'>, budget.triggeredTokens, order) }
}
