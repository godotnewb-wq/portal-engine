import { describe, expect, it } from 'vitest'
import { fixture, yardScene } from './fixture'
import { playScene, type ScriptedTurn } from './prompts'

/**
 * Prompt snapshots on the test-fixture pack (milestone 3.6, task 2). Five turns cover: a lie with a reading check and
 * a move gated on it, a move gated on a check that doesn't exist, a fact planned for a move nobody voiced, a player
 * check, a rewrite, a salvaged rewrite whose dropped speaker left tags behind, a planned departure, an unplanned
 * LEAVES tag, the running summary once turns leave the verbatim window, and the end-of-scene summaries, with a
 * feeling toward someone and a general aftermath carried out of the scene, and a tie change on screen (Mara takes Tobin
 * on), mirrored on his side and making both memories Core; Tobin's secret coming out in front of Mara, which she learns
 * (milestone 4b), and her memory tagged with a topic that came up (and one that didn't, dropped).
 */
const TURNS: ScriptedTurn[] = [
  {
    input: 'Who was in the yard last night?',
    plan: {
      player_action: { doing: 'asks who was in the yard last night', uncertain: false },
      checks: [{ id: 'read-tobin', who: 'mara', skill: 'notice', difficulty: 'tough', stakes: 'Mara sees that Tobin is dodging' }],
      speakers: [
        { id: 'tobin', goal: 'change the subject', feels: { shade: 'sore', family: 'mad', intensity: 3, reason: 'Mara is pressing him' }, pressure: 'keen', keeps: ['tobin.after-closing'], touched: 'last night', approach: 'deflect' },
        { id: 'mara', goal: 'find out what Tobin knows', feels: { shade: 'livid', intensity: 4, reason: 'someone is skimming the tallies' }, pressure: 'keen', keeps: [], touched: '' }
      ],
      moves: [
        { who: 'tobin', answers: 'player', move: 'dodge', uses: [], new: [] },
        { who: 'mara', answers: 1, move: 'push back', uses: ['mara.k1'], new: [], needs: 'read-tobin' },
        { who: 'mara', answers: 'player', move: 'warn', uses: [], new: ['The Guild docks a week of pay for a late gate.'], needs: 'read-pell' },
        { who: 'tobin', answers: 2, move: 'concede', uses: [], new: ['The gate stood open until ten.'] }
      ],
      change: 'Mara suspects Tobin.',
      reactions: [],
      walk_ons: [],
      texture: ['a gate creaking'],
      avoid: [],
      leaves: [],
      end_scene: false
    },
    writes: [
      `NARRATION: The gate creaks somewhere behind the crates.
Tobin: "The horses were restless. I sang to them."
Mara: "You were here after closing, Tobin. I saw the lamp."
[Tobin: EXPRESSION wary]
[Tobin: MOOD cornered]
[Mara: COMFORT 2 the dodge bothers her]`
    ]
  },
  {
    input: "I'm not the Watch. Tell me who you let into the yard after closing, and I'll keep it quiet.",
    plan: {
      player_action: { doing: 'persuades Tobin to name who he let in', uncertain: true },
      checks: [{ id: 'persuade-tobin', who: 'player', skill: 'talk', difficulty: 'tough', stakes: 'Tobin says who he let in' }],
      speakers: [{ id: 'tobin', goal: 'decide whether to trust Kit', feels: { shade: 'glum', intensity: 3, reason: 'he wants to trust Kit' }, pressure: 'keen', keeps: ['tobin.after-closing'], touched: 'into the yard after closing', approach: 'partial truth' }],
      moves: [{ who: 'tobin', answers: 'player', move: 'concede', uses: ['tobin.after-closing'], new: ['Someone with a Guild seal knocked after closing.'], needs: 'persuade-tobin' }],
      change: 'Tobin admits he opened the gate.',
      reactions: [{ id: 'mara', beat: 'stops writing' }],
      walk_ons: [],
      texture: [],
      avoid: [],
      leaves: [],
      end_scene: false
    },
    writes: [
      `NARRATION: Tobin hums, then stops.
Tobin: "Someone with a Guild seal. I couldn't say no to the seal."
Mara: "A Guild seal. Of course."
[Tobin: EXPRESSION relieved]`,
      `NARRATION: Tobin hums, then stops himself.
Tobin: "Someone with a Guild seal knocked. I couldn't say no to the seal."
NARRATION: Mara's pen stops over the tally.
[Tobin: EXPRESSION relieved]`
    ]
  },
  {
    input: 'Whose seal was it?',
    plan: {
      player_action: { doing: 'asks whose seal it was', uncertain: false },
      checks: [],
      speakers: [{ id: 'mara', goal: 'narrow it down without naming herself', pressure: 'driven', keeps: [], touched: '' }],
      moves: [{ who: 'mara', answers: 'player', move: 'answer', uses: [], new: ['Only clerks carry Guild seals.'] }],
      change: 'The list of suspects is short.',
      reactions: [{ id: 'tobin', beat: 'looks at the ground' }],
      walk_ons: [],
      texture: [],
      avoid: [],
      leaves: [],
      end_scene: false
    },
    writes: [
      `Mara: "Only clerks carry Guild seals. That makes it six people."
Tobin: "Seven, counting Pell."
[Tobin: MOOD rattled]
[Tobin: COMFORT 1 he said too much]
[Mara: EXPRESSION thoughtful]`,
      `Mara: "Only clerks carry Guild seals. That makes it six people."
Tobin: "Seven, counting Pell."
[Tobin: MOOD rattled]
[Tobin: COMFORT 1 he said too much]
[Mara: EXPRESSION thoughtful]`
    ]
  },
  {
    input: 'Tobin, you should go before the clerk sees you.',
    plan: {
      player_action: { doing: 'tells Tobin to leave', uncertain: false },
      checks: [],
      speakers: [{ id: 'tobin', goal: 'get out of sight', feels: { shade: 'jolted', intensity: 2 }, pressure: 'idle', keeps: [], touched: '' }],
      moves: [{ who: 'tobin', answers: 'player', move: 'agree', uses: [], new: [] }],
      change: 'Tobin leaves the yard.',
      reactions: [{ id: 'mara', beat: 'watches him go' }],
      walk_ons: [],
      texture: [],
      avoid: [],
      leaves: ['tobin'],
      end_scene: false,
      ties: [{ from: 'mara', to: 'tobin', add: 'hand', word: 'apprentice', back_word: 'master', reason: 'she takes him on to keep him close' }]
    },
    writes: [
      `Tobin: "Yes. The horses need water anyway."
NARRATION: Tobin ducks out through the gate.
[Tobin: EXPRESSION relieved]
[LEAVES: Tobin]`
    ]
  },
  {
    input: 'Mara, what will you do with this?',
    plan: {
      player_action: { doing: 'asks Mara what she will do', uncertain: false },
      checks: [],
      speakers: [{ id: 'mara', goal: 'keep it quiet until she knows more', feels: { shade: 'sore', family: 'mad', intensity: 2, reason: 'she wants to know more first' }, pressure: 'driven', keeps: [], touched: '' }],
      moves: [{ who: 'mara', answers: 'player', move: 'answer', uses: [], new: ['She will check the seal log at dawn.'] }],
      change: 'Mara has a plan.',
      reactions: [],
      walk_ons: [],
      texture: [],
      avoid: [],
      leaves: [],
      end_scene: false
    },
    writes: [
      `NARRATION: Mara closes the tally book and tucks the pen behind her ear.
Mara: "Check the seal log at dawn. Quietly, before the clerks come in."
NARRATION: She glances at the gate Tobin left by.
[Mara: EXPRESSION determined]
[LEAVES: Mara]`
    ]
  }
]

const SUMMARIES = {
  mara: { heard: [{ id: 'tobin.after-closing', memory: 'Tobin admitted he let someone into the yard after closing.' }], memories: [{ text: 'Tobin let someone with a Guild seal into the yard after closing; Kit got it out of him.', level: 'normal', topics: ['tobin.after-closing', 'faction.navy'] }, { text: 'Tobin is my apprentice now.', level: 'core', why: 'she took him on' }], reason: 'Kit kept it quiet', warmth: 'warmer', bond: 'same', learned: [], others: [{ with: 'tobin', warmth: 'colder', bond: 'same', reason: 'he lied to her' }], toward: [{ who: 'tobin', shade: 'sore', family: 'mad', intensity: 3, reason: 'he lied to her' }] },
  tobin: { feels: { shade: 'glum', intensity: 4, reason: 'he gave the seal away' }, memories: [{ text: 'I told Kit about the seal. Mara heard.', level: 'core', why: 'his secret came out' }], reason: 'Kit let him leave', warmth: 'warmer', bond: 'warmer', learned: [], others: [] }
}

describe('prompt snapshots: test fixture', () => {
  it('the yard scene sends the same prompts and decides the same things', async () => {
    const played = await playScene(fixture, yardScene(13), TURNS, SUMMARIES)
    await expect(played.prompts).toMatchFileSnapshot('./__snapshots__/prompts/yard.prompts.txt')
    await expect(played.record).toMatchFileSnapshot('./__snapshots__/prompts/yard.record.txt')
  })
})
