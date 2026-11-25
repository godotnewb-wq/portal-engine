import { describe, expect, it } from 'vitest'
import type { Prompt } from '@engine/core'
import { runTurn, type TurnLlm } from '@engine/scene'
import { createInitialState, startScene } from '@engine/state'
import { content } from './support'

// The bar turn of the 2026-11-24 play session, as its director planned it: Dunmar and Vex in the moment, Brask and
// Oria only present. In every writer replay of it Brask volunteered a reading ("The chiller's holding at four
// degrees"), acting out his worry's display line ("gets precise: numbers, valves, how long until").
describe('the scene writer’s Also here (2026-11-24 writer replays)', () => {
  it('says how much a feeling shows for someone outside the moment, without the display line it would act out', async () => {
    const prompts: Prompt[] = []
    const plan = {
      player_action: { doing: 'looks around the bar and remarks on it', uncertain: false },
      focus: ['dunmar', 'vex'],
      moments: [
        { who: 'dunmar', lands: 'a compliment', wants: 'to answer briefly', pressure: 'background' },
        { who: 'vex', lands: 'Rook being easy in a place she knows', wants: 'to see how Rook reads the room', pressure: 'background' }
      ],
      stakes: 'whether the room stays easy'
    }
    const llm: TurnLlm = {
      direct: async (p) => (prompts.push(p), JSON.stringify(plan)),
      write: async (p) => (prompts.push(p), 'Dunmar: "It\'s a roof."\nVex: "Mostly."')
    }
    const state = startScene(content, createInitialState(content, 3), 'sump-lantern', ['vex', 'brask', 'oria-senn', 'dunmar'])
    await runTurn(content, state, '"Nice place."', llm, () => {}, { pipeline: 'scene' })
    const writer = prompts[1]!.user
    const around = writer.split('# Also here')[1]!.split('\n\n')[0]!
    const brask = around.split('\n').find((l) => l.startsWith('- Brask.'))!
    expect(brask).toMatch(/^- Brask\. Feels [^.]+\. It shows only in small tells\.$/)
  })
})
