import { describe, expect, it } from 'vitest'
import { fixture, yardScene } from '@tests/fixture'
import { DEFAULT_PIPELINE, isPipeline, PIPELINES, type Pipeline } from './pipeline'
import { runTurn, type TurnLlm } from './runTurn'
import { promptSources } from './version'

// Milestone 5 plan, task 0b: the turn can be made by a chosen pipeline, and every turn says which made it.
const llm: TurnLlm = {
  direct: async () => '(no plan)',
  write: async (_prompt, onDelta) => {
    onDelta('NARRATION: The yard is quiet.')
    return 'NARRATION: The yard is quiet.'
  }
}

describe('pipelines', () => {
  it('are situation for now, which is the default', () => {
    expect(PIPELINES).toEqual(['situation'])
    expect(DEFAULT_PIPELINE).toBe('situation')
    expect(isPipeline('situation')).toBe(true)
    expect(isPipeline('lines')).toBe(false)
  })

  it('are recorded on every turn, chosen or not', async () => {
    expect((await runTurn(fixture, yardScene(5), 'Hello?', llm)).trace.director.pipeline).toBe('situation')
    expect((await runTurn(fixture, yardScene(5), 'Hello?', llm, () => {}, { pipeline: 'situation' })).trace.director.pipeline).toBe('situation')
  })

  it('refuse a name from outside the type system before any call', async () => {
    let calls = 0
    const counting: TurnLlm = { direct: async () => (calls++, '(no plan)'), write: llm.write }
    await expect(runTurn(fixture, yardScene(5), 'Hello?', counting, () => {}, { pipeline: 'lines' as Pipeline })).rejects.toThrow('Unknown pipeline "lines"')
    expect(calls).toBe(0)
  })

  it('give situation the prompt sources it had before the choice existed', () => {
    expect(promptSources(fixture, 'situation')).toEqual(promptSources(fixture))
  })
})
