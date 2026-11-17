import { describe, expect, it } from 'vitest'
import { createInitialState, startScene } from '@engine/state'
import { content } from './support'
import { playScene, type ScriptedTurn } from '../prompts'

/**
 * Prompt snapshots on Neonpunk Nights (milestone 3.6, task 2): the Sump Lantern with four of the cast, so three speak
 * and one stays quiet. Covers a lie with a reading check, felt emotion that carries, shows as tells or breaks through,
 * and a reading check aimed at Brask whose difficulty the game sets from his masking (milestone 4b), a lore line, a secret shown as a cue then kept and expanded,
 * a second character keeping a secret, and the four end-of-scene summaries, with feelings toward someone (Oria's, at 2,
 * below the minimum and dropped) and Brask's
 * panic carried out as aftermath; Brask's summary lists more memories than his tier keeps, and Vex's is in the shape
 * from before milestone 4b (milestone 4b).
 */
const TURNS: ScriptedTurn[] = [
  {
    input: 'So, Oria, who is the client, really?',
    plan: {
      player_action: { doing: 'presses Oria about the client', uncertain: false },
      checks: [{ id: 'read-oria', who: 'vex', skill: 'empathy', difficulty: 'moderate', stakes: 'Vex sees that Oria is lying' }],
      speakers: [
        { id: 'oria-senn', goal: 'keep the client hidden', feels: { shade: 'dread', intensity: 3, reason: 'the client must stay hidden' }, pressure: 'pressing', keeps: ['oria-senn.client-is-grid-corporation'], touched: 'who is the client', approach: 'lie' },
        { id: 'vex', goal: 'catch the lie', feels: { shade: 'irritation', intensity: 2, reason: 'Oria is playing them' }, pressure: 'background', keeps: [], touched: '' },
        { id: 'brask', goal: 'keep the peace', feels: { shade: 'worry', intensity: 4, reason: 'the table is turning on itself' }, pressure: 'background', keeps: [], touched: '' }
      ],
      moves: [
        { who: 'oria-senn', answers: 'player', move: 'dodge', uses: ['oria-senn.k3'], new: [] },
        { who: 'vex', answers: 1, move: 'push back', uses: ['vex.k1'], new: [], needs: 'read-oria' },
        { who: 'brask', answers: 2, move: 'warn', uses: ['brask.k1'], new: [] }
      ],
      lore: [{ entry: 'faction.couriers', line: 'Couriers carry for anyone and take no side.' }],
      change: 'The table knows Oria is hiding something.',
      reactions: [{ id: 'kesh', beat: 'watches the door', feels: { shade: 'nervousness', intensity: 2, reason: 'raised voices' } }],
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
        { id: 'oria-senn', goal: 'steer back to the fee', feels: { shade: 'frustration', intensity: 3, reason: 'they keep asking about the case' }, pressure: 'pressing', keeps: ['oria-senn.the-case'], touched: 'sealed case', approach: 'deflect' },
        { id: 'vex', goal: 'make Oria answer', pressure: 'background', keeps: [], touched: '' }
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
      checks: [{ id: 'read-brask', who: 'vex', skill: 'empathy', difficulty: 'trivial', target: 'brask', stakes: 'Vex sees how scared Brask really is' }],
      speakers: [
        { id: 'oria-senn', goal: 'close the deal', feels: { shade: 'relief', intensity: 3, reason: 'the deal is close' }, pressure: 'urgent', keeps: ['oria-senn.the-case'], touched: 'when do we go', approach: 'partial truth' },
        { id: 'brask', goal: 'raise the practical problem', feels: { shade: 'panic', intensity: 5, reason: 'the lower level floods at midnight' }, pressure: 'background', keeps: [], touched: '' }
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
  vex: { toward: [{ who: 'oria-senn', shade: 'contempt', intensity: 3, reason: 'she lied about the client again' }], memory: 'Oria lied about the client again, and Rook pushed her on it.', level: 'normal', reason: 'Rook backed her up', approval: 'a little more', trust: 'unchanged', interest: 'unchanged', others: [{ with: 'oria-senn', approval: 'less', trust: 'less', interest: 'unchanged', reason: 'she lied again' }] },
  brask: { memories: [{ text: 'Oria offered Rook a flooded pump job with a midnight deadline.', level: 'normal' }, { text: 'The lower level floods at midnight and nobody listened.', level: 'core', why: 'he was afraid for the job' }, { text: 'Kesh left early.', level: 'fleeting' }, { text: 'One too many.', level: 'fleeting' }], reason: '', approval: 'unchanged', trust: 'unchanged', interest: 'unchanged', others: [] },
  'oria-senn': { toward: [{ who: 'player', shade: 'resentment', intensity: 2, reason: 'Rook kept asking about the client' }], memory: 'Rook is asking about the client; I need to close this before Vex pushes harder.', level: 'normal', reason: 'Rook asked too many questions', approval: 'a little less', trust: 'unchanged', interest: 'unchanged', ties: [{ with: 'player', now: 'contractor', line: 'Before midnight. The lower level floods at high tide. Triple the usual rate.' }], others: [] },
  kesh: 'Strangers in the bar talked about a job at a pump station.'
}

describe('prompt snapshots: Neonpunk Nights', () => {
  it('the crowded bar scene sends the same prompts and decides the same things', async () => {
    const start = startScene(content, createInitialState(content, 11), 'sump-lantern', ['vex', 'brask', 'oria-senn', 'kesh'])
    // Oria hires the player: an arrangement with the player, stated in her relationship call and asked of them before the memory calls.
    const played = await playScene(content, start, TURNS, SUMMARIES)
    await expect(played.prompts).toMatchFileSnapshot('./__snapshots__/prompts/bar.prompts.txt')
    await expect(played.record).toMatchFileSnapshot('./__snapshots__/prompts/bar.record.txt')
  })
})
