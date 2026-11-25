/**
 * Runs of words, for telling whether a line says a fact (Milestone 5): the scene writer's ownership check and the
 * bookkeeper's stand-in. Whole words in a row, not keywords, so saying "the client" gives nothing away.
 */

/** Words in a row that make a phrase another speaker could only have from the fact itself (*tune*). */
export const OWNED_PHRASE_WORDS = 5

export const plainWords = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean)

/**
 * Words that carry no fact: a run made mostly of these ("in the right order and") is how anyone talks, not something
 * learned. A run counts only with `OWNED_CONTENT_WORDS` words outside this list.
 */
export const FUNCTION_WORDS = new Set('a an the and or but if then than so of in on at to for from by with without into onto off out up down over under about after before this that these those it its is are was were be been has have had do does did not no every each all some any one two his her their our your my he she they we you i me him them us who what when where which there here as just only very around near'.split(' '))
export const OWNED_CONTENT_WORDS = 3

/**
 * Whether a line says a fact again, for the bookkeeper's stand-in (task 4): a run of 4 of its words, 2 of them content
 * words. Looser than `ownedProblems`, since a wrong hit here only marks a fact as heard, which takes it out of the pool.
 */
export const statesFact = (fact: string, line: string): boolean => {
  const said = ` ${plainWords(line).join(' ')} `
  return runs(fact, 4, 2).some((r) => said.includes(` ${r} `))
}

/** A text's runs of `n` words with at least `content` content words, as plain lower-case words joined by spaces. */
export const runs = (t: string, n: number, content = OWNED_CONTENT_WORDS): string[] => {
  const w = plainWords(t)
  return w.length < n ? [] : w.slice(0, w.length - n + 1).map((_, i) => w.slice(i, i + n)).filter((r) => r.filter((x) => !FUNCTION_WORDS.has(x)).length >= content).map((r) => r.join(' '))
}

/**
 * How many content words `a` shares with `b` that aren't already in `known`: what a text says of `b` beyond what its
 * owner knows openly. A job a fixer knows is hers to describe, though its words are in her secret (2026-11-25 play).
 */
export const sharedBeyond = (a: string, b: string, known: string): number => {
  const content = (t: string) => new Set(plainWords(t).filter((w) => !FUNCTION_WORDS.has(w)))
  const theirs = content(b)
  const open = content(known)
  return [...content(a)].filter((w) => theirs.has(w) && !open.has(w)).length
}

/**
 * A clipped phrase that ends on a content word: "picks up her glass without looking at the" reads as "picks up her
 * glass without looking" (2026-11-25 audit: the writer's "Used already" list ended gestures mid-phrase).
 */
export const wholeWords = (phrase: string): string => {
  const w = phrase.trim().split(/\s+/)
  while (w.length > 1 && FUNCTION_WORDS.has(w.at(-1)!.toLowerCase().replace(/[^\p{L}']/gu, ''))) w.pop()
  return w.join(' ').replace(/[,;:]+$/, '')
}

/** How many content words two texts share; a short detail sharing several with a secret is about the secret. */
export const sharedWords = (a: string, b: string): number => {
  const content = (t: string) => new Set(plainWords(t).filter((w) => !FUNCTION_WORDS.has(w)))
  const theirs = content(b)
  return [...content(a)].filter((w) => theirs.has(w)).length
}
