import { describe, expect, it } from 'vitest'
import type { Prompt } from '@engine/core'
import { GameStateSchema } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { parseReply } from './beats'
import { checkReply } from './checks'
import { buildDirectorPrompt } from './director'
import { parsePlan, validatePlan } from './plan'
import { resolvePlan } from './resolve'
import { runTurn, type TurnLlm } from './runTurn'
import { buildWriterPrompt, sceneSpeakers } from './writer'

/** A plan in the fixture's own vocabulary: skills by name, its difficulty words. */
const PLAN = {
  speakers: [
    { id: 'Tobin', goal: 'Avoid the question politely.', mood: 'uneasy' },
    { id: 'mara', goal: 'Catch him out if she can.', mood: 'sharp' }
  ],
  moves: [
    { who: 'tobin', answers: 'player', move: 'dodge' },
    { who: 'mara', answers: 1, move: 'push back', needs: 'see' }
  ],
  checks: [{ id: 'see', who: 'Mara', skill: 'Notice', difficulty: 'tough', stakes: 'notices Tobin humming' }]
}

describe('plans in the pack’s vocabulary', () => {
  it('reads skills by name or id and difficulty words from the ruleset, and drops what the ruleset doesn’t have', () => {
    const state = yardScene()
    const { plan, corrections } = validatePlan(fixture, state, parsePlan(JSON.stringify(PLAN))!)
    expect(plan.speakers.map((s) => s.id)).toEqual(['tobin', 'mara'])
    expect(plan.checks).toEqual([expect.objectContaining({ who: 'mara', skill: 'notice', difficulty: 'tough' })])
    expect(corrections).toEqual([])
    const other = validatePlan(fixture, state, parsePlan(JSON.stringify({ ...PLAN, checks: [{ id: 'x', who: 'mara', skill: 'empathy', difficulty: 'moderate', stakes: '' }] }))!)
    expect(other.plan.checks).toEqual([])
    expect(other.corrections).toContain('dropped check "x": no skill "empathy"')
  })

  it('resolves checks with the ruleset’s numbers; no one helps a roll when no other companion is present', () => {
    const state = yardScene()
    const { plan } = validatePlan(fixture, state, parsePlan(JSON.stringify(PLAN))!)
    const check = resolvePlan(fixture, state, plan, { forceNatural: 9 }).plan.checks[0]!
    // Wits 7 (+3), Notice 1. Mara is the only companion, and Tobin isn't one, so no help.
    expect(check.result).toMatchObject({ modifier: 3, rank: 1, bonus: 0, total: 13, dc: 13, degree: 'success' })
    expect(check.line).toBe('Mara — Notice 13 vs 13: success')
  })
})

describe('prompts take the pack’s slots', () => {
  const state = yardScene()

  it('gives the director the pack’s primer, tone, skills, difficulty words and meters', () => {
    const { system } = buildDirectorPrompt(fixture, state, 'Hello.')
    expect(system).toMatch(/# World: Testhold\nTesthold is a small walled town/)
    expect(system).toMatch(/# Tone\nPlain and brisk\./)
    expect(system).toMatch(/skill is one of: fight, sneak, notice, talk, bluff\. difficulty is one of: routine, tough, grim\./)
    expect(system).toMatch(/Toward the player: warmth: civil; bond: loose/)
    expect(system).toMatch(/Warmth \(warmth\): how much they like the other\. Bond \(bond\): how much they would do for the other\. Each is a separate feeling/)
    expect(system).not.toMatch(/warmth -?\d|\(-?\d+–-?\d+\)/)
    expect(system).toMatch(/\(The Lower Ward, east gate\)/)
    expect(system).not.toMatch(/Every character is an adult\./)
  })

  it('gives the writer the pack’s tone and setting name', () => {
    const { plan } = validatePlan(fixture, state, parsePlan(JSON.stringify(PLAN))!)
    const { system } = buildWriterPrompt(fixture, state, plan, 'Hello.')
    expect(system).toMatch(/Tone:\nPlain and brisk\./)
    expect(buildWriterPrompt(fixture, state, plan, 'Hello.').user).toMatch(/^# Where you are\nThe Guild Yard\. A muddy yard/)
  })

  // Session 2026-11-07_0013_714e: the director quoted the line in its plan and the writer copied it.
  it('counts a move that quotes dialogue in what it says, but not an apostrophe inside a word', () => {
    const plan = (said: string) => ({ ...PLAN, moves: [{ who: 'tobin', answers: 'player', move: 'answer', new: [said] }] })
    const corrections = (said: string) => validatePlan(fixture, state, parsePlan(JSON.stringify(plan(said)))!).corrections
    expect(corrections("it's Pell's cart, and he'll vouch for it")).not.toContain('move 1 quotes dialogue in what it says')
    expect(corrections("the client is 'private money, darling' and no more")).toContain('move 1 quotes dialogue in what it says')
    expect(corrections('"locked up at the usual hour"')).toContain('move 1 quotes dialogue in what it says')
  })

  it('checks the writer’s prose against the pack’s own over-used phrases too', () => {
    const { plan } = validatePlan(fixture, state, parsePlan(JSON.stringify(PLAN))!)
    const parsed = parseReply('NARRATION: It was a dark and stormy night.\nTobin: "I could not say."', sceneSpeakers(fixture, state))
    expect(checkReply(parsed, plan, sceneSpeakers(fixture, state), 'Hi', fixture.phrases).map((p) => p.kind)).toEqual(['overused-phrase'])
  })
})

describe('runTurn on another pack', () => {
  function scripted(...writes: string[]): TurnLlm & { prompts: Prompt[] } {
    const prompts: Prompt[] = []
    return {
      prompts,
      direct: async (p) => (prompts.push(p), JSON.stringify(PLAN)),
      write: async (p, onDelta) => {
        prompts.push(p)
        const reply = writes.shift()!
        onDelta(reply)
        return reply
      }
    }
  }

  it('plays a turn in two calls, with the ruleset’s check line and the pack’s names', async () => {
    const llm = scripted('Tobin: "I could not say, miss."\nMara: "You\'re humming, Tobin."\n[Tobin: COMFORT 2 caught]')
    const outcome = await runTurn(fixture, yardScene(5), 'Tobin, who came in after closing?', llm, () => {}, { forceNatural: 15 })
    expect(outcome.calls).toBe(2)
    expect(outcome.state.scene!.turns[0]!.checks[0]!.line).toBe('Mara — Notice 19 vs 13: strong success')
    expect(outcome.state.scene!.comfort['tobin']).toBe(2)
    expect(GameStateSchema.parse(outcome.state)).toEqual(outcome.state)
  })

  it('rewrites once when a check fails', async () => {
    const llm = scripted('NARRATION: You nod and agree to everything.\nTobin: "Hm."', 'Tobin: "Hm."\nMara: "Again, Tobin."')
    const outcome = await runTurn(fixture, yardScene(5), 'Tobin?', llm)
    expect(outcome.calls).toBe(3)
    expect(outcome.problems.map((p) => p.kind)).toEqual(['player-action'])
  })
})
