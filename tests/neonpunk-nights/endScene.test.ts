import { describe, expect, it } from 'vitest'
import { barScene, content } from './support'
import { endScene } from '@engine/relationships'

describe('endScene', () => {
  it('summarises every witness at once and applies the results', async () => {
    let running = 0
    let most = 0
    const { state, reports } = await endScene(content, barScene(), async (prompt) => {
      running++
      most = Math.max(most, running)
      await new Promise((r) => setTimeout(r, 10))
      running--
      const who = prompt.user.match(/^About (\w+)/)![1]
      return JSON.stringify({ memory: `${who} had a drink with Rook.`, level: 'fleeting', approval: 'a little more', trust: 'unchanged', interest: 'unchanged' })
    })
    expect(most).toBe(3)
    expect(state.scene).toBeNull()
    expect(reports.map((r) => r.memory).sort()).toEqual(['Brask had a drink with Rook.', 'Oria had a drink with Rook.', 'Vex had a drink with Rook.'])
    expect(state.meters['vex']!.approval).toBe(6)
  })

  it('gives a witness whose call fails a plain memory, without losing the others', async () => {
    const { reports } = await endScene(content, barScene(), async (prompt) => {
      if (/About Brask/.test(prompt.user)) throw new Error('timeout')
      return '{"memory": "A quiet night.", "approval": "more"}'
    })
    const brask = reports.find((r) => r.id === 'brask')!
    expect(brask).toMatchObject({ error: 'timeout', memory: 'Brask spent time with Rook at The Sump Lantern.' })
    expect(brask.after).toEqual(brask.before)
    expect(reports.find((r) => r.id === 'vex')!.after.approval).toBe(9)
  })
})
