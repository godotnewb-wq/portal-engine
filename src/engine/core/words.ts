/**
 * A text's key words (writing issue 2, 2026-11-25): the words that carry what it says, in order, for telling whether a
 * line says a card's fact again in other words. A fact moved into "I" and "you" ("she has heard his work is good" →
 * "I've heard your work is good"), with contractions and small words changed, keeps its key words and their order.
 */

/** Words that carry no fact: pronouns, articles, auxiliaries, contractions and the like. */
const SMALL = new Set(
  (
    'a an the and or but if then than so of in on at to for from by with without into onto off out up down over under about before ' +
    'this that these those it its is are was were be been being am has have had having do does did done not no nor every each all some any ' +
    'his her hers their theirs our ours your yours my mine he she they we you i me him them us who whom whose what when where which why how ' +
    'there here as just only very around near too also yet still even ever never again once will would shall should can could may might must ' +
    'oh yes yeah well okay ok let lets got get gets one ones own itself himself herself themselves myself yourself ourselves s t d ll ve re m'
  ).split(' ')
)
// "never" is small: "never late" and "never once late" are how anyone talks; what's said around it is the fact.

const SAME: Record<string, string> = { till: 'until', til: 'until', afterward: 'after', afterwards: 'after' }

/** A word as compared: lower case, no plural or possessive ending. */
export const stemWord = (w: string): string => {
  const x = SAME[w] ?? w
  if (x.length > 4 && x.endsWith('ies')) return `${x.slice(0, -3)}y`
  if (x.length > 3 && /(ss|us|is)$/.test(x)) return x
  if (x.length > 3 && x.endsWith('oes')) return x.slice(0, -2)
  if (x.length > 4 && /(ches|shes|xes|ses)$/.test(x)) return x.slice(0, -2)
  if (x.length > 3 && x.endsWith('s')) return x.slice(0, -1)
  return x
}

/** Lower-case words with contractions split off ("didn't" → "did", "t"), hyphenated words joined. */
export const wordsOf = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/(\p{L})-(\p{L})/gu, '$1$2')
    .replace(/n't\b/g, ' not')
    .replace(/'/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** The key words of a text, in order, stemmed; words of `skip` (the world's names) left out. */
export const keyWords = (t: string, skip: ReadonlySet<string> = new Set()): string[] =>
  wordsOf(t)
    .filter((w) => !SMALL.has(w) && !skip.has(w))
    .map(stemWord)

/** The lower-case words of names, to leave out of key words: "Old Mill Weir" is a name, not a fact said. */
export const nameWords = (names: readonly string[]): Set<string> => new Set(names.flatMap((n) => wordsOf(n)).filter((w) => !SMALL.has(w)))

/** The first run of `n` key words in a row that `a` and `b` share, in the same order, or undefined. */
export function sharedRun(a: readonly string[], b: readonly string[], n: number): string | undefined {
  if (a.length < n || b.length < n) return undefined
  const inB = new Set(b.slice(0, b.length - n + 1).map((_, i) => b.slice(i, i + n).join(' ')))
  for (let i = 0; i + n <= a.length; i++) {
    const r = a.slice(i, i + n).join(' ')
    if (inB.has(r)) return r
  }
  return undefined
}
