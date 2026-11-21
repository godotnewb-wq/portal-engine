import { describe, expect, it } from 'vitest'
import { BookkeepingSchema, type GameState } from '@engine/state'
import { fixture, yardScene } from './fixture'
import { playScene, sceneDirector, type ScriptedTurn } from './prompts'

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

/**
 * Three turns of the yard through the whole `scene` pipeline (Milestone 5 plan, task 3): a quiet opening; the second
 * ledger asked about, Mara's secret live and a draft sent back for speaking for the player; Mara closing the yard,
 * the plan ending the scene and Tobin leaving. Then each witness's end-of-scene calls.
 */
const SCENE_TURNS: ScriptedTurn[] = [
  {
    input: 'Evening, both. Busy night?',
    plan: { player_action: { doing: 'greets them', uncertain: false }, focus: ['mara', 'tobin'], moments: [{ who: 'mara', lands: 'a greeting at the end of a long count', wants: 'to finish the tally', pressure: 'idle' }, { who: 'tobin', lands: 'someone to talk to who isn’t Mara', wants: 'to be friendly', pressure: 'idle' }], pressures: [], draws_on: [], stakes: 'whether anyone talks about the night' },
    writes: ['Tobin: He straightens up from the crates. "Busy enough. Carts till dark."\nMara: "Some of us are still counting them." She doesn\'t look up.\n[Tobin: EXPRESSION friendly]\n[Mara: EXPRESSION tired]']
  },
  {
    input: 'Is there a second ledger, Mara?',
    plan: {
      player_action: { doing: 'asks Mara straight out', uncertain: false },
      focus: ['mara'],
      moments: [{ who: 'mara', feels: { shade: 'glum', intensity: 3, reason: 'the question she dreads' }, lands: 'the one question she has no good answer to', wants: 'to close it down', pressure: 'keen' }],
      pressures: [{ who: 'mara', kind: 'secret', secret: 'mara.two-books', touched: 'second ledger', approach: 'lie' }],
      draws_on: [{ who: 'mara', facts: ['lore.faction.guild.second-ledger'] }],
      stakes: 'whether Kit believes there is one book'
    },
    writes: [
      'Mara: "One book, Kit." She closes it. You nod and let it go.\nTobin: He finds something to do with a strap.\n[Mara: EXPRESSION guarded]',
      'Mara: "One book, Kit." She closes it with both hands.\nTobin: He finds something to do with a strap.\n[Mara: EXPRESSION guarded]'
    ]
  },
  {
    input: 'Then I’ll leave you to it. Goodnight.',
    plan: { player_action: { doing: 'says goodnight', uncertain: false }, focus: ['mara', 'tobin'], moments: [{ who: 'mara', lands: 'relief she hides', wants: 'the yard shut and empty', pressure: 'keen' }, { who: 'tobin', lands: 'his cue to go', wants: 'to get home', pressure: 'idle' }], pressures: [], draws_on: [], stakes: 'the night ends', leaves: ['tobin'], end_scene: true },
    writes: ['Tobin: "Night, then." He shoulders his bag and heads for the gate.\nMara: "Lock it behind you." She is already turning the lamp down.\n[LEAVES: Tobin]\n[END SCENE]']
  }
]

const SCENE_SUMMARIES = {
  mara: { memories: [{ text: 'Kit asked about the second ledger, and I told them there was one book.', level: 'normal', about: ['player'] }], reason: 'Kit let it go', warmth: 'same', bond: 'same', ties: [], others: [] },
  tobin: { memories: [{ text: 'Kit asked Mara about a second ledger.', level: 'normal', about: ['mara'] }], reason: 'a quiet night', warmth: 'same', bond: 'same', ties: [], others: [] }
}

describe('prompt snapshots: the scene pipeline, test fixture', () => {
  it('plays the yard through the scene pipeline with the same prompts and decisions', async () => {
    const played = await playScene(fixture, yardScene(13), SCENE_TURNS, SCENE_SUMMARIES, true, 'scene')
    await expect(played.prompts).toMatchFileSnapshot('./__snapshots__/prompts/yard.scene.prompts.txt')
    await expect(played.record).toMatchFileSnapshot('./__snapshots__/prompts/yard.scene.record.txt')
    expect(played.state.scene).toBeNull()
  })
})
