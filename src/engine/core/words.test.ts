import { describe, expect, it } from 'vitest'
import { keyWords, nameWords, sharedRun } from './words'

describe('key words (writing issue 2)', () => {
  it('keeps what a line says, in order, whoever says it', () => {
    expect(keyWords('She has heard his work is good')).toEqual(['heard', 'work', 'good'])
    expect(keyWords("I've heard your work is good.")).toEqual(['heard', 'work', 'good'])
    expect(keyWords("Mara didn't catch it until afterward")).toEqual(['mara', 'catch', 'until', 'after'])
    expect(keyWords("I didn't catch it till after", nameWords(['Mara']))).toEqual(['catch', 'until', 'after'])
    expect(keyWords('The wheel-valves drain the lower levels; it goes dark')).toEqual(['wheelvalve', 'drain', 'lower', 'level', 'go', 'dark'])
  })

  it('leaves names out', () => {
    expect(keyWords('Old Mill Weir floods at midnight', nameWords(['Old Mill Weir']))).toEqual(['flood', 'midnight'])
  })

  it('finds a shared run in the same order only', () => {
    expect(sharedRun(['heard', 'work', 'good'], ['brask', 'heard', 'work', 'good'], 3)).toBe('heard work good')
    expect(sharedRun(['good', 'work', 'heard'], ['heard', 'work', 'good'], 3)).toBeUndefined()
  })
})
