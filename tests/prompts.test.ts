import { describe, expect, it } from 'vitest'
import { fixture, yardScene } from './fixture'
import { playScene } from './prompts'
import { SUMMARIES, TURNS } from './yard'

// Prompt snapshots on the test-fixture pack (milestone 3.6, task 2): the yard scene, scripted in ./yard.ts.
describe('prompt snapshots: test fixture', () => {
  it('the yard scene sends the same prompts and decides the same things', async () => {
    const played = await playScene(fixture, yardScene(13), TURNS, SUMMARIES)
    await expect(played.prompts).toMatchFileSnapshot('./__snapshots__/prompts/yard.prompts.txt')
    await expect(played.record).toMatchFileSnapshot('./__snapshots__/prompts/yard.record.txt')
  })
})
