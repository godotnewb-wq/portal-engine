import { describe, expect, it } from 'vitest'
import { createInitialState, startScene } from '@engine/state'
import { content } from './support'
import { playScene, type ScriptedTurn } from '../prompts'

/**
 * Prompt snapshots on Neonpunk Nights (milestone 3.6, task 2): the Sump Lantern with four of the cast, so three speak
 * and one stays quiet. Covers a lie with a reading check, a lore line, a secret shown as a cue then kept and expanded,
 * a second character keeping a secret, and the four end-of-scene summaries.
 */
const TURNS: ScriptedTurn[] = [
  {
    input: 'So, Oria, who is the client, really?',
    plan: {
      player_action: { doing: 'presses Oria about the client', uncertain: false },
      checks: [{ id: 'read-oria', who: 'vex', skill: 'empathy', difficulty: 'moderate', stakes: 'Vex sees that Oria is lying' }],
      speakers: [
        { id: 'oria-senn', goal: 'keep the client hidden', mood: 'composed, too polished', pressure: 'pressing', keeps: ['oria-senn.client-is-grid-corporation'], touched: 'who is the client', approach: 'lie' },
        { id: 'vex', goal: 'catch the lie', mood: 'wary', pressure: 'background', keeps: [], touched: '' },
        { id: 'brask', goal: 'keep the peace', mood: 'uneasy', pressure: 'background', keeps: [], touched: '' }
      ],
      moves: [
        { who: 'oria-senn', answers: 'player', move: 'dodge', uses: ['oria-senn.k3'], new: [] },
        { who: 'vex', answers: 1, move: 'push back', uses: ['vex.k1'], new: [], needs: 'read-oria' },
        { who: 'brask', answers: 2, move: 'warn', uses: ['brask.k1'], new: [] }
      ],
      lore: [{ entry: 'faction.couriers', line: 'Couriers carry for anyone and take no side.' }],
      change: 'The table knows Oria is hiding something.',
      reactions: [{ id: 'kesh', beat: 'watches the door' }],
      walk_ons: [],
      texture: ['condensation dripping from an Aether-cooled pipe overhead'],
      avoid: [],
      leaves: [],
      end_scene: false
    },
    writes: [
      `NARRATION: Water ticks from the cooled pipe onto the table's edge.
Oria: "A private collector, darling. One who pays triple."
Vex: "'Darling.' She only says that when she's lying."
Brask: "Mind the pipe. It drips on whoever sits there."
NARRATION: Kesh keeps her eyes on the door.
[Oria: EXPRESSION smile]
[Vex: EXPRESSION smirk]
[Brask: COMFORT 2 too loud in here]`
    ]
  },
  {
    input: "Forget the client. What's in the sealed case?",
    plan: {
      player_action: { doing: 'asks what is in the case', uncertain: false },
      checks: [],
      speakers: [
        { id: 'oria-senn', goal: 'steer back to the fee', mood: 'irritated', pressure: 'pressing', keeps: ['oria-senn.the-case'], touched: 'sealed case', approach: 'deflect' },
        { id: 'vex', goal: 'make Oria answer', mood: 'dry', pressure: 'background', keeps: [], touched: '' }
      ],
      moves: [
        { who: 'oria-senn', answers: 'player', move: 'dodge', uses: ['oria-senn.k1'], new: [] },
        { who: 'vex', answers: 1, move: 'ask', uses: [], new: [] }
      ],
      change: 'Oria refuses to say what the case holds.',
      reactions: [
        { id: 'brask', beat: 'turns his glass in a slow circle' },
        { id: 'kesh', beat: 'checks the time' }
      ],
      walk_ons: [],
      texture: [],
      avoid: [],
      leaves: [],
      end_scene: false
    },
    writes: [
      `Oria: "Something old from the pump station, retrieved before a rival crew gets to it. The contents are the client's business."
Vex: "And whose business is the client?"
NARRATION: Brask turns his glass in a slow circle. Kesh checks the time.
[Oria: MOOD irritated]`
    ]
  },
  {
    input: 'Fine. When do we go, and what does it pay?',
    plan: {
      player_action: { doing: 'asks when and for how much', uncertain: false },
      checks: [],
      speakers: [
        { id: 'oria-senn', goal: 'close the deal', mood: 'relieved', pressure: 'urgent', keeps: ['oria-senn.the-case'], touched: 'when do we go', approach: 'partial truth' },
        { id: 'brask', goal: 'raise the practical problem', mood: 'worried', pressure: 'background', keeps: [], touched: '' }
      ],
      moves: [
        { who: 'oria-senn', answers: 'player', move: 'answer', uses: ['oria-senn.k7', 'oria-senn.k3'], new: [] },
        { who: 'brask', answers: 1, move: 'warn', uses: ['brask.k5'], new: [] }
      ],
      change: 'The job has a deadline: midnight.',
      reactions: [
        { id: 'vex', beat: 'counts something on her fingers' },
        { id: 'kesh', beat: 'stands to leave' }
      ],
      walk_ons: [],
      texture: [],
      avoid: [],
      leaves: [],
      end_scene: false
    },
    writes: [
      `Oria: "Before midnight. The lower level floods at high tide. Triple the usual rate."
Brask: "Three of the pumps down there are overdue for seals. If one goes, the water won't wait for midnight."
NARRATION: Vex counts something on her fingers.
[Oria: EXPRESSION satisfied]
[Brask: MOOD worried]`
    ]
  }
]

const SUMMARIES = {
  vex: { memory: 'Oria lied about the client again, and Rook pushed her on it.', level: 'normal', reason: 'Rook backed her up', approval: 'a little more', trust: 'unchanged', interest: 'unchanged', learned: [], others: [{ with: 'oria-senn', approval: 'less', trust: 'less', interest: 'unchanged', reason: 'she lied again' }] },
  brask: { memory: 'Oria offered Rook a flooded pump job with a midnight deadline.', level: 'fleeting', reason: '', approval: 'unchanged', trust: 'unchanged', interest: 'unchanged', learned: [], others: [] },
  'oria-senn': { memory: 'Rook is asking about the client; I need to close this before Vex pushes harder.', level: 'normal', reason: 'Rook asked too many questions', approval: 'a little less', trust: 'unchanged', interest: 'unchanged', learned: [], others: [] },
  kesh: 'Strangers in the bar talked about a job at a pump station.'
}

describe('prompt snapshots: Neonpunk Nights', () => {
  it('the crowded bar scene sends the same prompts and decides the same things', async () => {
    const start = startScene(content, createInitialState(content, 11), 'sump-lantern', ['vex', 'brask', 'oria-senn', 'kesh'])
    const played = await playScene(content, start, TURNS, SUMMARIES)
    await expect(played.prompts).toMatchFileSnapshot('./__snapshots__/prompts/bar.prompts.txt')
    await expect(played.record).toMatchFileSnapshot('./__snapshots__/prompts/bar.record.txt')
  })
})
