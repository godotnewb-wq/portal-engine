import { describe, expect, it } from 'vitest'
import type { Prompt } from '@engine/core'
import { fixture, yardScene } from '@tests/fixture'
import { turnText } from './director'
import { buildDirector2Prompt } from './director2'
import { canSay, sceneFacts } from './facts'
import { parsePlan2, validatePlan2 } from './plan2'
import { runTurn, type TurnLlm } from './runTurn'
import { buildWriter2Prompt } from './writer2'

// The situation pipeline (director-writer review, option B, 2026-11-07).
const plan = (over: object = {}) =>
  JSON.stringify({
    player_action: { doing: 'asks Tobin who came by', uncertain: false },
    speakers: [
      { id: 'tobin', goal: 'get the question dropped', mood: 'uneasy', keeps: ['tobin.after-closing'], approach: 'deflect' },
      { id: 'mara', goal: 'catch him out', mood: 'sharp', keeps: [] }
    ],
    moves: [
      { who: 'tobin', answers: 'player', move: 'dodge', uses: [], new: ['he locked up at the usual hour'] },
      { who: 'mara', answers: 1, move: 'push back', uses: ['mara.k1'] },
      { who: 'tobin', answers: 2, move: 'offer', uses: [], new: ['two cinders to forget it'] }
    ],
    change: 'Mara has said aloud that Tobin was here after closing',
    reactions: [],
    checks: [],
    texture: ['wet cobbles', 'a lamp hissing'],
    ...over
  })

describe('facts and who may say them', () => {
  it('gives every piece of knowledge and every secret an id, owned by its character', () => {
    const state = yardScene()
    const facts = sceneFacts(fixture, state)
    expect(facts.map((f) => f.id).sort()).toEqual(['mara.k1', 'mara.two-books', 'tobin.after-closing'])
    const known = facts.find((f) => f.id === 'mara.k1')!
    expect(canSay(state.scene!, known, 'mara')).toBe(true)
    expect(canSay(state.scene!, known, 'tobin')).toBe(false)
    expect(canSay({ ...state.scene!, told: ['mara.k1'] }, known, 'tobin')).toBe(true)
  })
})

describe('the situation plan', () => {
  it('reads moves with their facts, and marks what the player has not heard', () => {
    const { plan: p, corrections } = validatePlan2(fixture, yardScene(), parsePlan2(plan())!)
    expect(corrections).toEqual([])
    expect(p.moves).toEqual([
      { who: 'tobin', answers: 'player', move: 'dodge', says: [{ text: 'he locked up at the usual hour', unheard: true }] },
      { who: 'mara', answers: 1, move: 'push back', says: [{ text: 'Tobin was in the yard after closing', id: 'mara.k1', unheard: true }] },
      { who: 'tobin', answers: 2, move: 'offer', says: [{ text: 'two cinders to forget it', unheard: true }] }
    ])
    expect(p.exchange.map((l) => l.point)).toEqual(['dodge: he locked up at the usual hour', 'push back: Tobin was in the yard after closing', 'offer: two cinders to forget it'])
    expect(p.speakers[0]).toMatchObject({ id: 'tobin', intent: 'get the question dropped', approach: 'deflect' })
    expect(p.speakers[0]!.hiding).toBeTruthy()
    expect(p.texture).toEqual(['wet cobbles'])
  })

  // Session 2026-11-07_1246_b4db: the nurse said what only the conductor knew.
  it('drops a fact from a move whose speaker can’t know it, and counts it', () => {
    const leak = plan({ moves: [{ who: 'tobin', answers: 'player', move: 'answer', uses: ['mara.k1', 'nobody.k9'] }] })
    const { plan: p, corrections } = validatePlan2(fixture, yardScene(), parsePlan2(leak)!)
    expect(p.moves![0]!.says).toEqual([])
    expect(corrections).toEqual(expect.arrayContaining(["move 1: tobin can't know mara.k1", 'move 1: no fact "nobody.k9"', 'move 1 (tobin) says nothing', 'speaker "mara" had no move']))
  })

  // Round 0, F4: 22 of 22 checks were the player's Empathy, rolled whatever the player did.
  it('keeps a player check only when the player is attempting something uncertain', () => {
    const check = [{ id: 'read', who: 'player', skill: 'notice', difficulty: 'tough', stakes: 'notice Tobin humming' }]
    const talking = validatePlan2(fixture, yardScene(), parsePlan2(plan({ checks: check }))!)
    expect(talking.plan.checks).toEqual([])
    expect(talking.corrections).toContain('dropped the player check: the player action is not an uncertain attempt')
    const watching = validatePlan2(fixture, yardScene(), parsePlan2(plan({ checks: check, player_action: { doing: 'watches Tobin closely', uncertain: true } }))!)
    expect(watching.plan.checks.map((c) => c.id)).toEqual(['read'])
  })

  it('gives the director facts by id and the writer facts as facts, with no planner wording', () => {
    const state = yardScene()
    const director = buildDirector2Prompt(fixture, state, 'Tobin, who came by?')
    expect(director.system).toMatch(/- \[mara\.k1\] Tobin was in the yard after closing/)
    expect(director.system).toMatch(/Secret \[tobin\.after-closing\]/)
    expect(director.system).toMatch(/The player leads\. Start from what the player just said or did: move 1 answers it/)
    expect(director.user).toMatch(/# Nothing has been said on screen yet\./)
    const { plan: p } = validatePlan2(fixture, state, parsePlan2(plan())!)
    const writer = buildWriter2Prompt(fixture, state, p, 'Tobin, who came by?')
    expect(writer.system).toMatch(/People talk like people: complete, plain sentences/)
    expect(writer.system).not.toMatch(/dialogue, then narration, then dialogue/)
    expect(writer.user).toMatch(/# The conversation, in order\n1\. Tobin, answering the player: dodge: he locked up at the usual hour \[new to the player\]\n2\. Mara, answering 1 \(Tobin\): push back: Tobin was in the yard after closing \[new to the player\]/)
    expect(writer.user).toMatch(/It shows only as: Hums\./)
    expect(writer.user).toMatch(/Nothing yet beyond what they can see\./)
  })
})

describe('a turn on the situation pipeline', () => {
  const llm = (director: string, reply: string): TurnLlm => ({
    direct: async () => director,
    write: async (_p: Prompt, onDelta) => {
      onDelta(reply)
      return reply
    }
  })
  const REPLY = 'Tobin: "I locked up at the usual hour, same as always."\nMara: "You were in the yard after closing. I saw you."\nTobin: "Two cinders, and you forget you did."'

  it('is the default, and what was said joins the scene’s common ground for the next turn', async () => {
    const { state, trace } = await runTurn(fixture, yardScene(), 'Tobin, who came by?', llm(plan(), REPLY))
    expect(trace.director.read).toBe('json')
    expect(state.scene!.told).toEqual(['mara.k1'])
    expect(state.scene!.newFacts).toEqual([
      { id: 'said.1', text: 'he locked up at the usual hour', by: 'tobin' },
      { id: 'said.2', text: 'two cinders to forget it', by: 'tobin' }
    ])
    const next = buildDirector2Prompt(fixture, state, 'Mara, what did you see?')
    expect(next.user).toMatch(/# Already said on screen \(anyone present can use these\)\n- \[mara\.k1\] Tobin was in the yard after closing\n- \[said\.1\] he locked up/)
    // Now that it has been said, Tobin may repeat it, and it is no longer new to the player.
    const again = validatePlan2(fixture, state, parsePlan2(plan({ moves: [{ who: 'tobin', answers: 'player', move: 'concede', uses: ['mara.k1'] }] }))!)
    expect(again.plan.moves![0]!.says).toEqual([{ text: 'Tobin was in the yard after closing', id: 'mara.k1', unheard: false }])
  })

  it('shows past lines in quotes, under the name the writer uses', () => {
    const turn = { id: 't', player: 'Hello.', beats: [{ kind: 'dialogue' as const, speaker: 'mara', text: 'Evening.' }, { kind: 'dialogue' as const, speaker: 'clerk', text: 'Next.' }], checks: [], speakers: [], texture: [] }
    expect(turnText(fixture, 'Ada', turn)).toMatch(/^Ada: Hello\.\nMara: "Evening\."\n.+: "Next\."$/)
    expect(turnText(fixture, 'Ada', turn)).not.toMatch(/^clerk:/m)
  })
})
