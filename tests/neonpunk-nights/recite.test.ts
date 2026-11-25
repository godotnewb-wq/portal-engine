import { describe, expect, it } from 'vitest'
import { createInitialState, startScene } from '@engine/state'
import { parseReply, recitedProblems, runTurn, sceneSpeakers, type TurnLlm } from '@engine/scene'
import { content } from './support'

// The 2026-11-25 play session: asked who Oria was, Dunmar and Vex answered in the brief's words; and Oria, whose job
// detail the plan dropped as her secret's, offered pay for no job.
const bar = () => startScene(content, createInitialState(content, 5), 'sump-lantern', ['vex', 'brask', 'oria-senn', 'dunmar'])
const recited = (line: string) => {
  const state = bar()
  return recitedProblems(content, state, {}, parseReply(line, sceneSpeakers(content, state), { script: true }))
}

describe('a fact or note in the brief’s own words (2026-11-25 play)', () => {
  it('sends back a line carrying a card fact or a note word for word, and lets it be said another way', () => {
    expect(recited('Dunmar: "Oria Senn. Keeps the standing booth, pays her tab on the first of every month, never late."').map((p) => p.fix)).toEqual([
      expect.stringMatching(/^Beat 1: Dunmar says it in the brief's words \(".+"\)\. Say it the way Dunmar would here, to these people, or leave it out\.$/)
    ])
    expect(recited('Vex: "I ran sealed packets for her twice. Both paid."')).toHaveLength(1)
    // A note or fact reworded into "I" and "you", with its key words in the same order, is the same line (writing issue 2):
    // both were flagged in play (2026-11-25 1242 and 2112).
    expect(recited('Vex: "She\'s a client. Hired me twice, sealed packets, both paid on time."')).toHaveLength(1)
    expect(recited('Oria: "You\'d be Brask. I\'ve heard your work is good."').map((p) => p.text)).toEqual(['heard … work … good'])
    // A term from someone's world, or a place's name, isn't a fact said: "sealed packets" alone, "Pump Station Nine".
    expect(recited('Vex: "She\'s a client. Sealed packets, mostly. She pays."')).toEqual([])
    expect(recited('Vex: "Pump Station Nine. Of course it is."')).toEqual([])
    expect(recited('Dunmar: "Oria. Never once late with her slate, which is more than I can say for some."')).toEqual([])
    expect(recited('NARRATION: Oria pays her tab on the first of every month.')).toEqual([])
  })
})

describe('ties in the scene writer’s brief (2026-11-25 audit)', () => {
  it('gives only what the people in the moment hold, and a tie given as an undercurrent once', async () => {
    const plan = { focus: ['vex', 'oria-senn'], moments: [{ who: 'vex', lands: 'Oria waves', wants: 'to watch her' }, { who: 'oria-senn', lands: 'they came', wants: 'to pitch the job' }], pressures: [{ who: 'vex', kind: 'tie', with: 'oria-senn' }], stakes: 'the job' }
    let writer = ''
    const llm: TurnLlm = { direct: async () => JSON.stringify(plan), write: async (p, onDelta) => ((writer = p.user), onDelta('Oria: "Sit down."'), 'Oria: "Sit down."') }
    await runTurn(content, bar(), 'Hello.', llm, () => {}, { pipeline: 'scene' })
    const ties = writer.split('# How people here stand with each other')[1]!.split('\n\n')[0]!
    expect(ties).toContain('- Oria → Vex:')
    expect(ties).not.toContain('- Vex → Oria:')
    expect(ties).not.toMatch(/- (Brask|Dunmar) →/)
    expect(writer).toMatch(/Underneath, what Oria is to Vex matters here: /)
    expect(writer).not.toContain("which this brief doesn't give you")
  })
})

describe('a detail the director puts on hand (2026-11-25 play)', () => {
  const plan = (text: string) =>
    JSON.stringify({ focus: ['oria-senn'], moments: [{ who: 'oria-senn', lands: 'they came over', wants: 'to put the job to them' }], details: [{ who: 'oria-senn', text }], stakes: 'whether they take the job' })
  const play = async (text: string) => {
    const llm: TurnLlm = { direct: async () => plan(text), write: async (_p, onDelta) => (onDelta('Oria: "Sit down."'), 'Oria: "Sit down."') }
    return runTurn(content, bar(), 'What do you want?', llm, () => {}, { pipeline: 'scene' })
  }

  it('keeps one that only says what the person knows openly, though it shares words with their secret', async () => {
    const out = await play('the job is a sealed case retrieved from Pump Station Nine before the tide')
    expect(out.plan.scene!.pools['oria-senn']?.map((f) => f.text)).toContain('the job is a sealed case retrieved from Pump Station Nine before the tide')
  })

  it('still drops one that says what is hidden', async () => {
    const out = await play('her private client is the Grid, and the job pays down her debt to them')
    expect(out.trace.director.corrections).toEqual(expect.arrayContaining([expect.stringMatching(/it says a secret$/)]))
  })
})
