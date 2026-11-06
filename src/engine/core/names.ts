// Adapted from Breedhaven University, src/shared/game/scene.ts (plainName, namesHer) (GPL-3.0-only). See NOTICE.md.

/**
 * A name as it is compared: without accents, in lower case. The LLM writes "Mara" for "Mara Voss" and drops accents
 * as often as not, and a name that is not recognised is a line that is not acted on.
 */
export function plainName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase()
}

/** Whether what was written names this character: their id, full name, or first name. */
export function namesCharacter(written: string, character: { id: string; name: string }): boolean {
  const asked = plainName(written)
  return [character.id, character.name, character.name.split(' ')[0]!].some((known) => plainName(known) === asked)
}

export const firstName = (name: string): string => name.split(' ')[0]!

/** The id of whoever in `people` the written name means, if anyone. */
export function resolveName<T extends { id: string; name: string }>(written: string, people: T[]): T | undefined {
  return people.find((p) => namesCharacter(written, p))
}
