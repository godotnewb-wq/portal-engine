import type { Setting } from '@engine/world'
import type { CodexEntry } from './schema'

/**
 * The strict name check (claude/lore-injection.md §11): every name the writer gives a group or place must be canon.
 * A name close to a canon one is a wrong name (the rewrite is told the right one); any other new name for a group or
 * place is an invented one. Personal names aren't checked: a one-word name that isn't close to a canon word passes.
 */
export interface NameIndex {
  /** Canon names, each as its lower-case words without a leading "the". */
  canon: string[][]
  /** The canon names as written, parallel to `canon`, for telling the rewrite the right one. */
  written: string[]
  generic: Set<string>
  /** Names of people (characters, walk-ons, the player), never checked. */
  people: Set<string>
}

export type NameFinding = { kind: 'wrong-name'; name: string; canon: string[] } | { kind: 'invented-name'; name: string }

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
const lowerWords = (s: string) => (s.toLowerCase().replace(/’/g, "'").match(WORD) ?? []).filter((w, i) => !(i === 0 && /^(the|a|an)$/.test(w)))
/** The same word, allowing a simple plural either way ("Weavers", "Weaver"). */
/** The forms a plural may come from: "houses" from "house", "offices" from "office", "elves" from "elf". */
const singulars = (w: string) => [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ves$/, 'f')]
const same = (a: string, b: string) => a === b || singulars(a).some((x) => singulars(b).includes(x))
/** An entry's in-world names: its label and aliases. Titles are headings and keywords are lore triggers, not names. */
const namesOf = (e: CodexEntry) => [...(e.label ? [e.label] : []), ...e.aliases]

/**
 * Whether a faction's own codex entry says it has no in-world name: a plural category such as "the street gangs",
 * whose words must not make up names ("the Ada Gang") until play can create such groups (milestone 8).
 */
const unnamedFaction = (codex: CodexEntry[], faction: string) =>
  codex.some((e) => e.kind === 'faction' && e.faction === faction && e.id.split('.').at(-1) === faction && !e.label)

/**
 * Everything a pack names: every codex entry's label and aliases, and the setting's own names. A setting faction's
 * name counts only if its main codex entry, where there is one, has a label. Titles and keywords
 * don't count, so a heading or a trigger word never becomes canon by being capitalized.
 */
export function nameIndex(codex: CodexEntry[], setting: Setting, people: string[], genericWords: string[]): NameIndex {
  const written = [
    ...codex.flatMap(namesOf),
    setting.name,
    ...(setting.world ? [setting.world] : []),
    ...setting.tiers.map((t) => t.name),
    ...setting.factions.filter((f) => !unnamedFaction(codex, f.id)).map((f) => f.name),
    ...setting.species.map((s) => s.name)
  ]
  const unique = [...new Map(written.map((w) => [lowerWords(w).join(' '), w])).entries()].filter(([k]) => k)
  return {
    canon: unique.map(([k]) => k.split(' ')),
    written: unique.map(([, w]) => w),
    generic: new Set(genericWords.map((g) => g.toLowerCase())),
    people: new Set(people.flatMap((p) => [p.toLowerCase(), ...lowerWords(p)]))
  }
}

/** A candidate name in prose, and whether it starts a sentence (where an ordinary word is capitalized too). */
export interface Candidate {
  name: string
  sentenceStart: boolean
  /**
   * For a run that ends in a possessive, that run and the one straight after it, as written ("Tanners' Row"), so
   * a canon name holding a possessive can pass as one name.
   */
  withNext?: string
}

/**
 * Candidate names in prose: runs of capitalized words (numbers may follow, as in "Car 14"), joined by "of" or "of
 * the" inside a run ("House of the Ada").
 */
export function candidates(text: string): Candidate[] {
  const out: Candidate[] = []
  const tokens = [...text.replace(/’/g, "'").matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]*|[^\s\p{L}\p{N}]+/gu)].map((m) => m[0])
  let run: string[] = []
  // The run as written, possessive included, for `withNext`.
  let written: string[] = []
  let start = false
  let atStart = true
  // The last run that ended in a possessive: its candidate, its text as written, and the token right after it.
  let owner: { at: number; written: string; next: number } | undefined
  let joins: typeof owner
  const flush = () => {
    while (run.length > 0 && /^(of|the)$/.test(run.at(-1)!)) {
      run.pop()
      written.pop()
    }
    if (run.length > 0) {
      out.push({ name: run.join(' ').replace(/'s$/, ''), sentenceStart: start })
      if (joins) out[joins.at]!.withNext = `${joins.written} ${written.join(' ')}`
    }
    run = []
    written = []
    joins = undefined
  }
  for (const [i, t] of tokens.entries()) {
    if (/^\p{Lu}/u.test(t) || (run.length > 0 && /^\p{N}+$/u.test(t))) {
      if (run.length === 0) {
        start = atStart
        joins = owner?.next === i ? owner : undefined
      }
      // A possessive ends a name: "the Ada Line's conductors", "the Porters' Hall" are two things, unless the two
      // runs together are canon (checked in `checkNames`).
      const stem = t.replace(/'s?$/, '')
      run.push(stem)
      written.push(t)
      if (stem !== t) {
        const ownerWritten = written.join(' ')
        flush()
        owner = { at: out.length - 1, written: ownerWritten, next: i + 1 }
      }
    } else if (run.length > 0 && (t === 'of' || (t === 'the' && run.at(-1) === 'of'))) {
      run.push(t)
      written.push(t)
    } else flush()
    atStart = /^[.!?:"“”—]+$/.test(t) || (atStart && /^["“'(]+$/.test(t))
  }
  flush()
  return out
}

/** Edit distance, small strings only. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length]![b.length]!
}

/** Whether `part` appears in `whole` as consecutive words. */
const within = (part: string[], whole: string[]) => whole.some((_, i) => part.every((w, j) => whole[i + j] !== undefined && same(whole[i + j]!, w)))
/**
 * A distinctive word is close to a canon one: a typo ("Bellmore", "Belmore"). Short words allow one letter, since two
 * turn ordinary words into near misses ("later", "lower").
 */
const close = (a: string, b: string) => a.length >= 5 && b.length >= 5 && a !== b && !same(a, b) && distance(a, b) <= (Math.min(a.length, b.length) >= 7 ? 2 : 1)

/** Whether a run is a person or part of a canon name. */
function isCanon(candidate: string, index: NameIndex): boolean {
  const lower = lowerWords(candidate)
  const words = lower.filter((w) => w !== 'of' && w !== 'the')
  if (index.people.has(lower.join(' ')) || words.every((w) => index.people.has(w))) return true
  return index.canon.some((c) => within(lower, c) || within(words, c))
}

/** Checks one candidate name. Undefined: it passes (canon, part of a canon name, a person, or an ordinary word). */
export function checkName(candidate: string, index: NameIndex): NameFinding | undefined {
  const words = lowerWords(candidate).filter((w) => w !== 'of' && w !== 'the')
  if (words.length === 0) return undefined
  if (isCanon(candidate, index)) return undefined

  const distinctive = words.filter((w) => !index.generic.has(w) && w.length >= 3 && !/^\d+$/.test(w))
  const sharing = index.canon.flatMap((c, i) => (distinctive.some((w) => c.some((cw) => same(cw, w))) ? [index.written[i]!] : []))
  if (words.length > 1 && sharing.length > 0) return { kind: 'wrong-name', name: candidate, canon: [...new Set(sharing)].slice(0, 3) }
  const near = index.canon.flatMap((c, i) => (distinctive.some((w) => c.some((cw) => !index.generic.has(cw) && close(cw, w))) ? [index.written[i]!] : []))
  if (near.length > 0) return { kind: 'wrong-name', name: candidate, canon: [...new Set(near)].slice(0, 3) }
  // A new name for a group or place carries a generic word ("the Ada Gang"); other new capitalized runs are people
  // or ordinary words.
  if (words.length > 1 && distinctive.length > 0 && words.some((w) => index.generic.has(w))) return { kind: 'invented-name', name: candidate }
  return undefined
}

/**
 * Every wrong or invented name in a text, once each. A run that starts a sentence may begin with an ordinary word
 * ("Behind Old Mill Three"): if what follows that word is canon, it passes.
 */
export function checkNames(text: string, index: NameIndex): NameFinding[] {
  const seen = new Set<string>()
  const found = candidates(text)
  // A canon name holding a possessive ("Tanners' Row") passes whole, both of its runs.
  const whole = new Set(found.flatMap((c, i) => (c.withNext && isCanon(c.withNext, index) ? [i, i + 1] : [])))
  return found.flatMap((c, i) => {
    if (whole.has(i)) return []
    let f = checkName(c.name, index)
    const [first, ...others] = c.name.split(' ')
    const rest = others.join(' ')
    const ordinary = !/^(the|a|an)$/i.test(first!) && !index.canon.some((cw) => cw.some((w) => same(w, first!.toLowerCase())))
    // The opening word is the sentence's, not the name's: judge (and report) what follows it.
    const after = rest.replace(/^(of )?(the )?/, '')
    if (f?.kind === 'wrong-name' && c.sentenceStart && ordinary && after) f = checkName(after, index)
    // Two canon names side by side ("the Ada Line Ward Office") pass; a canon word beside a new one doesn't.
    const parts = c.name.split(' ')
    if (f && parts.some((_, i) => i > 0 && isCanon(parts.slice(0, i).join(' '), index) && isCanon(parts.slice(i).join(' '), index))) f = undefined
    // One capitalized word opening a sentence is most likely an ordinary word, so a near miss there isn't one.
    if (f?.kind === 'wrong-name' && c.sentenceStart && !rest && ordinary) f = undefined
    if (!f || seen.has(f.name)) return []
    seen.add(f.name)
    return [f]
  })
}

/**
 * The index with the new-looking names the pack's own prose uses ("the yard's Tally Desk"), since what the pack
 * writes is canon even without an entry of its own.
 */
export function withProseNames(index: NameIndex, texts: string[]): NameIndex {
  const found = [...new Set(texts.flatMap((t) => checkNames(t, index).flatMap((f) => (f.kind === 'invented-name' ? [f.name] : []))))]
  if (found.length === 0) return index
  return { ...index, canon: [...index.canon, ...found.map(lowerWords)], written: [...index.written, ...found] }
}
