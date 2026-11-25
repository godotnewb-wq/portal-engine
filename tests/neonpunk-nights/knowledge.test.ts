import { describe, expect, it } from 'vitest'
import { createInitialState, startScene } from '@engine/state'
import { buildOpeningPrompt, ownedProblems, parseReply, sceneSpeakers } from '@engine/scene'
import { content } from './support'

// The 2026-11-24 play session: a mechanic said what a fixer's aim and a bartender's note held, as his own knowledge.
const bar = () => startScene(content, createInitialState(content, 5), 'sump-lantern', ['vex', 'brask', 'oria-senn', 'dunmar'])
const problems = (line: string) => {
  const state = bar()
  return ownedProblems(content, state, parseReply(line, sceneSpeakers(content, state), { script: true }))
}

describe('what each person knows (2026-11-24 play)', () => {
  it("sends back someone else's aim or note said word for word, and lets its owner say it", () => {
    expect(problems('Brask: "She wants us to take the retrieval job at Pump Station Nine tonight."').map((p) => p.fix)).toEqual([
      expect.stringMatching(/^Beat 1: Brask says what is Oria's own \(".+"\)\. Have Brask ask, guess or say nothing about it\.$/)
    ])
    expect(problems('Brask: "Oria Senn pays her booth\'s tab on the first of every month, never late."')).toHaveLength(1)
    expect(problems('Dunmar: "Oria Senn pays her booth\'s tab on the first of every month, never late."')).toEqual([])
    expect(problems('Brask: "She always pays. Nobody says what for."')).toEqual([])
  })

  it('gives the opening a walk-on as anyone would see them', () => {
    expect(buildOpeningPrompt(content, bar()).user).toContain('# Also around (not by name)\n- a card player at the next table: wiry goblin woman')
  })
})
