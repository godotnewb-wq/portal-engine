import { describe, expect, it } from 'vitest'
import { cutPoint } from './reading'

// The last turn starts at beat 8 of the scene and has 4 beats (8–11).
describe('cutPoint (task 8c)', () => {
  it('cuts after the beat on screen, short of the turn’s last', () => {
    expect(cutPoint(8, 8, 4)).toBe(1)
    expect(cutPoint(10, 8, 4)).toBe(3)
  })

  it('cuts after the beat on screen when the player read on and came back (2026-11-25, user)', () => {
    // Read to beat 11, the last, then back to beat 9: the cut is after the turn's second beat.
    expect(cutPoint(9, 8, 4)).toBe(2)
  })

  it('does not cut on the turn’s last beat, on an earlier turn, or with no turn', () => {
    expect(cutPoint(11, 8, 4)).toBe(0)
    expect(cutPoint(5, 8, 4)).toBe(0)
    expect(cutPoint(0, 0, 0)).toBe(0)
  })
})
