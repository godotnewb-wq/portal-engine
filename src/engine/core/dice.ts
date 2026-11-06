import { draws, seedOf } from './seed'

/** A seeded die roller: the same seed rolls the same numbers in the same order, so turns replay exactly. */
export interface Dice {
  /** A whole number from 1 to `sides`. */
  roll(sides: number): number
  /** The state to store so rolling can carry on where it left off after a save. */
  readonly state: number
}

/** Dice that pick up from a stored state (or a seed for a new game). */
export function dice(state: number): Dice {
  let current = state >>> 0
  return {
    roll(sides: number): number {
      // Same sequence as draws(seed): each roll moves the state on by the generator's own step, so the state is all
      // there is to save.
      const next = draws(current)()
      current = (current + 0x6d2b79f5) >>> 0
      return 1 + Math.floor(next * sides)
    },
    get state() {
      return current
    }
  }
}

/** A seed for a new game from any text, e.g. a timestamp or a test name. */
export const seedFrom = (text: string): number => seedOf(text)
