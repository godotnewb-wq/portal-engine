import { codexFactionId, entryById, mentions, tokensOf, type CodexEntry } from '@engine/codex'
import { firstName } from '@engine/core'
import type { Character, Secret } from '@engine/characters'
import { characterById, type Pack } from '@engine/pack'
import type { GameState } from '@engine/state'
import { knowersOf } from '@engine/memory'
import { presentCast } from './planShape'

/**
 * How each held secret appears on the director's situation sheet (lore injection.md §7.1, milestone 3.5): every
 * secret as a short cue, and some in full. Linked and personal secrets are ranked separately for full display: a secret
 * validly kept last turn first, then one whose own keywords were just said, then one whose subject the conversation
 * brought up (background lore of the place and the people present doesn't count: decided 2026-11-12). Within a
 * rank the most recently kept comes first, then the id. Each kind has its own per-character budget, charged only the
 * extra text of showing a secret in full; a secret that doesn't fit stays a cue and the next is tried.
 */
export interface SecretShown {
  /** The character who holds it. */
  holder: string
  /** Its fact id, `<character>.<secret>`: what the director keeps it by. */
  id: string
  kind: 'linked' | 'personal'
  /** `off`: not on the sheet this turn (milestone 4b), because it is dormant or everyone present knows it (`off`). */
  form: 'full' | 'cue' | 'off'
  off?: 'dormant' | 'known'
  /** Who present, besides the holder, knows it (the player included): it is kept only from the others. */
  knownBy?: string[]
  /** Why it was first in line for full display, when it was. */
  priority?: 'kept' | 'keyword' | 'context'
  /** Estimated tokens of the cue line. */
  cueTokens: number
  /** Estimated extra tokens spent showing it in full; 0 for a cue. */
  expansionTokens: number
}

/** What the turn's scan reads: the same texts the triggered layer reads, and the codex entries they brought up. */
export interface SecretScan {
  texts: string[]
  /**
   * Ids of the entries the conversation brought up (`triggeredEntries`), before the triggered layer leaves out what
   * the scene layer already carries, so a faction that is background here still counts once someone names it.
   */
  mentioned: Set<string>
}

const sentence = (t: string) => {
  const s = t.trim()
  return /[.!?]["'’”)]?$/.test(s) ? s : `${s}.`
}
const firstSentence = (t: string) => sentence(t.trim().match(/^.*?[.!?](?=\s|$)/s)?.[0] ?? t)

/** A secret in full, as the sheet has always shown it. */
export const fullSecretLine = (c: Character, s: Secret, id = `${c.id}.${s.id}`) =>
  `Secret [${id}]: ${s.text} Tell: ${s.tell}.${s.revealWhen ? ` Would reveal when: ${s.revealWhen}.` : ''}`

/** A secret's cue: its id and a short form. A linked one gives the holder's part and the codex entry's summary. */
export function cueSecretLine(content: Pack, c: Character, s: Secret, id = `${c.id}.${s.id}`): string {
  if (s.codex) {
    const entry = entryById(content.codex, s.codex)
    return `Secret [${id}] (in short): ${firstName(c.name)}'s part: ${sentence(s.role!)} ${sentence(entry?.summary ?? '')}`.trim()
  }
  return `Secret [${id}] (in short): ${s.summary ? sentence(s.summary) : firstSentence(s.text)}`
}

/** Every codex entry whose label or alias the text names. */
const namedIn = (codex: CodexEntry[], text: string) => codex.filter((e) => [...(e.label ? [e.label] : []), ...e.aliases].some((n) => mentions(text, n)))

/**
 * What in the scan touches a secret, and how: one of its own keywords said, or its subject brought up (a linked
 * secret's faction and the entries it links to; the canon things a personal secret's text names). `words`: the keyword,
 * or the subject's title, for the trace. Undefined when nothing does. The `scene` pipeline reads this on what was just
 * said (Milestone 5 plan, Q5); the sheet's display reads it on the turn's wider scan.
 */
export function touchOf(content: Pack, s: Secret, scan: SecretScan): { how: 'keyword' | 'context'; words: string } | undefined {
  const entry = s.codex ? entryById(content.codex, s.codex) : undefined
  const keywords = entry ? entry.keywords : (s.keywords ?? [])
  const keyword = keywords.find((k) => scan.texts.some((t) => mentions(t, k)))
  if (keyword) return { how: 'keyword', words: keyword }
  // A linked secret's subject: its faction and what its entry links to. A personal one's: the canon things its text names.
  const subjects = entry ? [...(entry.faction ? [codexFactionId(content.setting, entry.faction)] : []), ...entry.related] : namedIn(content.codex, s.text).map((e) => e.id)
  const hit = subjects.find((x) => scan.mentioned.has(x))
  return hit ? { how: 'context', words: entryById(content.codex, hit)?.title ?? hit } : undefined
}

function priorityOf(content: Pack, s: Secret, id: string, keptLast: Set<string>, scan: SecretScan): SecretShown['priority'] {
  if (keptLast.has(id)) return 'kept'
  return touchOf(content, s, scan)?.how
}

const RANK = { kept: 0, keyword: 1, context: 2 } as const

/**
 * Which held secrets are on the sheet (milestone 4b; decided 2026-11-13). A secret everyone present knows costs nothing
 * and stays off. Of the rest, the ruleset's `codex.activeSecrets` most recently active are on: pinned ones first (they
 * count toward the limit), then those brought up this turn, then by when they were last active, then the card's
 * order. The others are dormant, off the sheet but still held, until their keywords or subject come up.
 */
function onSheet(content: Pack, state: GameState, c: Character, shown: (SecretShown & { secret: Secret })[]): void {
  const present = presentCast(state.scene!).filter((x) => x !== c.id)
  for (const x of shown) {
    const knownBy = knowersOf(state, x.id, x.secret.text).filter((k) => k === 'player' || present.includes(k))
    if (knownBy.length > 0) x.knownBy = knownBy
    if (knownBy.length === present.length + 1) {
      x.form = 'off'
      x.off = 'known'
    }
  }
  const last = (x: SecretShown) => state.secretActivity[x.id]?.at ?? Number.NEGATIVE_INFINITY
  const ranked = shown
    .map((x, order) => ({ x, order }))
    .filter(({ x }) => x.form !== 'off')
    .sort((a, b) => Number(!!b.x.secret.pinned) - Number(!!a.x.secret.pinned) || Number(!!b.x.priority) - Number(!!a.x.priority) || last(b.x) - last(a.x) || a.order - b.order)
  const limit = Math.max(content.ruleset.codex.activeSecrets, ranked.filter(({ x }) => x.secret.pinned).length)
  for (const { x } of ranked.slice(limit)) {
    x.form = 'off'
    x.off = 'dormant'
  }
}

/** The held secrets that were active this turn on the sheet (milestone 4b): shown in full, or brought up by keyword or subject. */
export function activeSecrets(shown: SecretShown[]): { id: string; how: 'kept' | 'full' | 'keyword' | 'context' }[] {
  return shown.flatMap((x): { id: string; how: 'kept' | 'full' | 'keyword' | 'context' }[] => (x.form === 'off' ? [] : x.priority ? [{ id: x.id, how: x.priority }] : x.form === 'full' ? [{ id: x.id, how: 'full' }] : []))
}

/** How every secret held by someone present shows on the sheet this turn. */
export function secretDisplay(content: Pack, state: GameState, scan: SecretScan): SecretShown[] {
  const scene = state.scene!
  const keptLast = new Set(scene.turns.at(-1)?.kept ?? [])
  // The turn each secret was last validly kept in this scene, so the most recent wins a tie.
  const lastKept = new Map<string, number>()
  scene.turns.forEach((t, i) => (t.kept ?? []).forEach((id) => lastKept.set(id, i)))
  const budgets = { linked: content.ruleset.codex.linkedSecretTokens, personal: content.ruleset.codex.personalSecretTokens }

  return presentCast(scene).flatMap((who) => {
    const c = characterById(content, who)
    if (!c) return []
    const shown = c.secrets.map((s): SecretShown & { secret: Secret } => {
      const id = `${c.id}.${s.id}`
      const priority = priorityOf(content, s, id, keptLast, scan)
      return { secret: s, holder: c.id, id, kind: s.codex ? 'linked' : 'personal', form: 'cue', ...(priority && { priority }), cueTokens: tokensOf(cueSecretLine(content, c, s)), expansionTokens: 0 }
    })
    onSheet(content, state, c, shown)
    for (const kind of ['linked', 'personal'] as const) {
      let left = budgets[kind]
      const line = shown
        .filter((x) => x.kind === kind && x.priority && x.form !== 'off')
        .sort((a, b) => RANK[a.priority!] - RANK[b.priority!] || (lastKept.get(b.id) ?? -1) - (lastKept.get(a.id) ?? -1) || a.id.localeCompare(b.id))
      for (const x of line) {
        const extra = Math.max(0, tokensOf(fullSecretLine(c, x.secret)) - x.cueTokens)
        if (extra > left) continue
        left -= extra
        x.form = 'full'
        x.expansionTokens = extra
      }
    }
    return shown.map(({ secret: _secret, ...x }) => x)
  })
}
