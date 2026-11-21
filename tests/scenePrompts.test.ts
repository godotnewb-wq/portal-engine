import { describe, expect, it } from 'vitest'
import { BookkeepingSchema, type GameState } from '@engine/state'
import { fixture, yardScene } from './fixture'
import { sceneDirector } from './prompts'

// The `scene` pipeline's director on the test fixture (Milestone 5 plan, task 2): its prompt on scripted moments of the
// yard, and what the game gathered and validated from a scripted reply. It plays no turn until the writer exists.

/** The yard after one turn: Tobin mentioned the tallies, and the bookkeeper recorded what changed. Tobin knows Mara here. */
function afterATurn(): GameState {
  const state = yardScene(13)
  state.relations = [...state.relations, { from: 'tobin', to: 'mara', tags: [], note: 'has worked under her a year', meters: { warmth: 0, bond: 0 } }]
  state.scene!.turns.push({
    id: 'yard-1',
    player: 'Evening. Busy night?',
    beats: [
      { kind: 'dialogue', speaker: 'tobin', text: 'Busy enough. Mara keeps the tallies close tonight.' },
      { kind: 'narration', text: 'Mara turns a page of the tally book and does not look up.' }
    ],
    checks: [],
    speakers: ['tobin', 'mara'],
    texture: [],
    records: BookkeepingSchema.parse({ source: 'bookkeeper', changed: 'Kit has noticed Mara guarding the tally book.' })
  })
  return state
}

describe('prompt snapshots: the scene director, test fixture', () => {
  it('sends the same prompts and validates the same plans', async () => {
    const played = sceneDirector(fixture, [
      {
        heading: 'the yard opens',
        state: yardScene(13),
        input: 'Evening, Mara. Busy night?',
        reply: { player_action: { doing: 'greets Mara and asks about the night', uncertain: false }, focus: ['mara'], moments: [{ who: 'mara', lands: 'a plain question at the end of a long shift', wants: 'to finish the count without being drawn into talk', pressure: 'idle' }], pressures: [], draws_on: [], stakes: 'whether Mara talks or keeps counting' }
      },
      {
        heading: 'a secret touched, and someone who could see through it',
        state: afterATurn(),
        input: 'Is there a second ledger, Mara?',
        reply: {
          player_action: { doing: 'asks Mara straight out about a second ledger', uncertain: false },
          checks: [{ id: 'read-mara', who: 'tobin', skill: 'notice', target: 'mara', stakes: 'Tobin sees the lie for what it is' }],
          focus: ['mara', 'tobin'],
          moments: [
            { who: 'mara', feels: { shade: 'glum', intensity: 3, reason: 'the question she has dreaded' }, lands: 'the one question she has no good answer to, asked in front of Tobin', wants: 'to close it down without looking like she is', pressure: 'keen' },
            { who: 'tobin', lands: 'he has wondered the same and never asked', wants: 'to watch her answer', pressure: 'idle' }
          ],
          pressures: [{ who: 'mara', kind: 'secret', secret: 'mara.two-books', touched: 'second ledger', approach: 'lie' }],
          draws_on: [{ who: 'mara', facts: ['lore.faction.guild.tallies'] }],
          stakes: 'whether Kit believes there is one book, and whether Tobin catches the lie'
        }
      }
    ])
    await expect(played.prompts).toMatchFileSnapshot('./__snapshots__/prompts/yard.scene-director.prompts.txt')
    await expect(played.record).toMatchFileSnapshot('./__snapshots__/prompts/yard.scene-director.record.txt')
  })
})
