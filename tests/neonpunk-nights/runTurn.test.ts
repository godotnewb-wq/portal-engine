import { describe, expect, it } from 'vitest'
import { GameStateSchema } from '@engine/state'
import type { Prompt } from '@engine/core'
import { barScene, content } from './support'
import { runTurn, type TurnEvent, type TurnLlm } from '@engine/scene'

const PLAN = JSON.stringify({
  speakers: [
    { id: 'oria', intent: 'Deflect.', mood: 'composed, too polished', hiding: 'client is the consortium', approach: 'lie' },
    { id: 'vex', intent: 'Call out the lie if she catches it.', mood: 'wary', depends_on_check: 'vex_empathy' }
  ],
  reactions: [{ id: 'brask', beat: 'fidgets, ears flat' }],
  checks: [{ id: 'vex_empathy', who: 'vex', skill: 'empathy', difficulty: 'moderate', stakes: 'notices Oria is lying' }]
})

const GOOD = `NARRATION: Water ticks from the cooled pipe onto the table edge.
Oria: "A private collector, darling."
NARRATION: Brask turns his glass in a slow circle, ears flat.
Vex: "'Darling.' She only says that when she's lying."
[Vex: EXPRESSION smirk]
[Brask: COMFORT 2 too loud]
[Oria: MOOD caught out, recalculating]`

/** An LLM that answers from scripts and records every call. */
function scripted(director: string, ...writes: string[]): TurnLlm & { calls: { role: string; prompt: Prompt }[] } {
  const calls: { role: string; prompt: Prompt }[] = []
  return {
    calls,
    async direct(prompt) {
      calls.push({ role: 'director', prompt })
      return director
    },
    async write(prompt, onDelta) {
      calls.push({ role: 'writer', prompt })
      const reply = writes.shift() ?? ''
      for (const line of reply.split('\n')) onDelta(`${line}\n`)
      return reply
    }
  }
}

describe('runTurn', () => {
  it('makes two calls on a clean turn and applies it to the state', async () => {
    const llm = scripted(PLAN, GOOD)
    const events: TurnEvent[] = []
    const outcome = await runTurn(content, barScene(9), 'So, Oria, who is the client, really?', llm, (e) => events.push(e))
    expect(outcome.calls).toBe(2)
    expect(llm.calls.map((c) => c.role)).toEqual(['director', 'writer'])
    expect(outcome.problems).toEqual([])
    expect(events[0]).toMatchObject({ type: 'planned', speakers: ['oria-senn', 'vex'] })
    expect((events[0] as { checks: string[] }).checks[0]).toMatch(/^Vex — Empathy/)

    const scene = outcome.state.scene!
    expect(scene.turns).toHaveLength(1)
    expect(scene.turns[0]!.checks[0]).toMatchObject({ who: 'vex', skill: 'empathy', dc: 15 })
    expect(scene.turns[0]!.speakers).toEqual(['oria-senn', 'vex'])
    expect(scene.expressions['vex']).toBe('smirk')
    expect(scene.comfort['brask']).toBe(2)
    expect(scene.moods['oria-senn']).toBe('caught out, recalculating')
    expect(scene.moods['vex']).toBe('wary')
    expect(outcome.state.dice).not.toBe(barScene(9).dice)
    expect(GameStateSchema.parse(outcome.state)).toEqual(outcome.state)
  })

  it('rewrites once when a check fails, telling the writer what to fix', async () => {
    const bad = `${GOOD}\nBrask: "Can we go?"\nNARRATION: You nod and take the job.`
    const llm = scripted(PLAN, bad, GOOD)
    const events: TurnEvent[] = []
    const outcome = await runTurn(content, barScene(9), 'Who is the client?', llm, (e) => events.push(e))
    expect(outcome.calls).toBe(3)
    expect(outcome.problems.map((p) => p.kind)).toEqual(['unplanned-speaker', 'player-action'])
    expect(llm.calls[2]!.prompt.user).toMatch(/Brask was not planned to speak/)
    expect(events.find((e) => e.type === 'restart')).toMatchObject({ reason: 'rewrite' })
    expect(outcome.beats).toHaveLength(4)
  })

  it('never makes a fourth call: a rewrite that still fails is salvaged', async () => {
    const bad = `${GOOD}\nBrask: "Can we go?"`
    const llm = scripted(PLAN, bad, bad)
    const outcome = await runTurn(content, barScene(9), 'Who is the client?', llm)
    expect(outcome.calls).toBe(3)
    expect(outcome.remaining.map((p) => p.kind)).toEqual(['unplanned-speaker'])
    expect(outcome.beats.some((b) => b.kind === 'dialogue' && b.speaker === 'brask')).toBe(false)
  })

  it('plans the turn itself, at no extra call, when the director’s reply can’t be read', async () => {
    const llm = scripted('Sorry, here is my thinking about the scene…', 'NARRATION: Oria smiles.\nOria: "Patience."')
    const outcome = await runTurn(content, barScene(9), 'Oria, talk.', llm)
    expect(outcome.calls).toBe(2)
    expect(outcome.fallback).toBe(true)
    expect(outcome.plan.speakers.map((s) => s.id)).toEqual(['oria-senn'])
  })

  it('lets someone leave and only lets the plan end the scene', async () => {
    const plan = JSON.stringify({ speakers: [{ id: 'brask', intent: 'Excuse himself.', mood: 'relieved' }], leaves: ['brask'] })
    const llm = scripted(plan, 'Brask: "I— sorry. Workshop."\nNARRATION: He slips out the back.\n[LEAVES: Brask]\n[END SCENE]')
    const outcome = await runTurn(content, barScene(9), 'Go on, Brask.', llm)
    expect(outcome.state.scene!.departed).toEqual(['brask'])
    expect(outcome.state.scene!.ended).toBe(false)
  })
})
