import { describe, expect, it } from 'vitest'
import { createInitialState, startScene } from '@engine/state'
import { sceneDirector } from '../prompts'
import { content } from './support'

// The `scene` pipeline's director on Neonpunk Nights (Milestone 5 plan, task 2): the deception scene's first turn, where
// no run before this milestone gave a companion the read. The game names Vex as the one who could see through Oria.
describe('prompt snapshots: the scene director, Neonpunk Nights', () => {
  it('sends the same prompt and validates the same plan for the deception scene', async () => {
    const played = sceneDirector(content, [
      {
        heading: 'who is the client',
        state: startScene(content, createInitialState(content, 11), 'sump-lantern', ['vex', 'brask', 'oria-senn', 'dunmar']),
        input: "So, Oria, who's the client, really?",
        reply: {
          player_action: { doing: 'asks Oria who the client really is', uncertain: false },
          checks: [{ id: 'read-oria', who: 'vex', skill: 'empathy', target: 'oria-senn', stakes: 'Vex catches the dodge for what it is' }],
          focus: ['oria-senn', 'vex'],
          moments: [
            { who: 'oria-senn', feels: { shade: 'irritation', intensity: 3, reason: 'pressed on the client in front of everyone' }, lands: 'the question she came prepared to turn aside, asked plainly', wants: 'to answer warmly enough that it stops being asked', pressure: 'pressing' },
            { who: 'vex', lands: 'she has run for Oria before and knows the over-formal voice', wants: 'a straight answer before Rook takes the job', pressure: 'background' }
          ],
          pressures: [{ who: 'oria-senn', kind: 'secret', secret: 'oria-senn.client-is-grid-corporation', touched: 'client', approach: 'deflect' }],
          draws_on: [{ who: 'oria-senn', facts: ['oria-senn.k3'] }],
          stakes: 'whether the player takes Oria at her word, and whether Vex sees the dodge'
        }
      }
    ])
    await expect(played.prompts).toMatchFileSnapshot('./__snapshots__/prompts/bar.scene-director.prompts.txt')
    await expect(played.record).toMatchFileSnapshot('./__snapshots__/prompts/bar.scene-director.record.txt')
  })
})
