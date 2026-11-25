import { describe, expect, it } from 'vitest'
import type { Prompt } from '@engine/core'
import { fixture, yardScene } from '@tests/fixture'
import { buildOpeningPrompt, establishScene } from './opening'
import { runTurn, type TurnLlm } from './runTurn'

/** A writer with set replies in order (a second is the rewrite), keeping the prompts it was sent. */
function writer(replies: string[]): TurnLlm['write'] & { prompts: Prompt[] } {
  const prompts: Prompt[] = []
  const write = async (prompt: Prompt) => {
    prompts.push(prompt)
    return replies[prompts.length - 1] ?? ''
  }
  return Object.assign(write, { prompts })
}

describe('the scene opening (Milestone 5 task 8)', () => {
  it('briefs the place, who is here with what they are, and who came with the player', () => {
    const prompt = buildOpeningPrompt(fixture, yardScene())
    expect(prompt.system).toContain('nobody speaks')
    expect(prompt.user).toMatch(/^# Where you are\n/)
    expect(prompt.user).toMatch(/# Who is here\n- Mara/)
    expect(prompt.user.trim().endsWith('Write the opening.')).toBe(true)
  })

  it('puts the narration on the scene, and both calls read it every turn', async () => {
    const write = writer(['NARRATION: Mara is at the tally desk with the ledger open.\nNARRATION: Tobin leans on the gate by the horses, out of earshot.'])
    const opened = await establishScene(fixture, yardScene(), write)
    expect(opened.state.scene!.opening).toEqual([
      { kind: 'narration', text: 'Mara is at the tally desk with the ledger open.' },
      { kind: 'narration', text: 'Tobin leans on the gate by the horses, out of earshot.' }
    ])
    expect(opened.trace.calls.map((c) => c.role)).toEqual(['opening'])

    const prompts: Prompt[] = []
    const plan = { player_action: { doing: 'greets her', uncertain: false }, focus: ['mara'], moments: [{ who: 'mara', lands: 'a greeting', wants: 'to finish', pressure: 'idle' }], stakes: 'none' }
    const llm: TurnLlm = { direct: async (p) => (prompts.push(p), JSON.stringify(plan)), write: async (p) => (prompts.push(p), 'Mara: "Evening."') }
    await runTurn(fixture, opened.state, 'Evening.', llm, () => {}, { pipeline: 'scene' })
    for (const p of prompts) expect(p.user).toContain('# How the scene opened\nMara is at the tally desk with the ledger open.\nTobin leans on the gate')
  })

  it('sends speech back once, keeps only narration, and leaves a scene with turns or an opening as it is', async () => {
    const write = writer(['Mara: "Busy."\nNARRATION: Mara is at the desk.', 'NARRATION: Mara is at the desk.\nNARRATION: Tobin is by the gate.'])
    const opened = await establishScene(fixture, yardScene(), write)
    expect(opened.trace.findings).toEqual(['Nobody speaks in the opening: narration only.'])
    expect(opened.trace.calls.map((c) => [c.role, c.id.split(':')[1]])).toEqual([['opening', 'opening'], ['opening', 'opening-rewrite']])
    expect(opened.beats.every((b) => b.kind === 'narration')).toBe(true)

    const again = writer(['NARRATION: Something else.'])
    expect((await establishScene(fixture, opened.state, again)).state).toBe(opened.state)
    expect(again.prompts).toHaveLength(0)
  })

  it('leaves the scene without an opening when nothing usable comes back', async () => {
    const opened = await establishScene(fixture, yardScene(), writer(['Mara: "No."', 'Mara: "Still no."']))
    expect(opened.state.scene!.opening).toBeUndefined()
    expect(opened.beats).toEqual([])
  })
})
