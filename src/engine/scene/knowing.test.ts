import { describe, expect, it } from 'vitest'
import type { Pack } from '@engine/pack'
import { BookkeepingSchema, MemorySchema, type GameState, type Turn } from '@engine/state'
import { buildMemoryPrompt } from '@engine/relationships'
import { fixture, yardScene } from '@tests/fixture'
import { buildDirectorPrompt } from './director'
import { parsePlan, validatePlan } from './plan'
import type { BeatPlan } from './planShape'
import { buildWriterPrompt, claimLines, knowledgeLines } from './writer'

// Milestone 4c task 3 (decision L, 2026-11-18, user): the writer is told who knows what; a leak is carried as the
// speaker's claim; the director is told a plan gives nobody knowledge; the trim.

const TOBIN = 'tobin.after-closing'
const keyed: Pack = { ...fixture, characters: fixture.characters.map((c) => (c.id === 'tobin' ? { ...c, secrets: c.secrets.map((s) => ({ ...s, keywords: ['after closing'] })) } : c)) }
const plan = (over: Partial<BeatPlan> = {}): BeatPlan => ({ speakers: [], exchange: [], reactions: [], checks: [], walk_ons: [], texture: [], avoid: [], leaves: [], end_scene: false, ...over })
const keeping = plan({ speakers: [{ id: 'tobin', intent: 'get through it', kept: [TOBIN], hiding: 'Tobin let someone into the yard after closing.' }] })
/** A scene whose first turn the bookkeeper recorded as Mara leaking Tobin's secret. */
function leaked(state: GameState = yardScene()): GameState {
  const records = { ...BookkeepingSchema.parse({ source: 'bookkeeper' }), leaks: [{ secret: TOBIN, by: 'mara', at: 1, words: 'You let someone in after closing', why: "mara couldn't know it" }] }
  const turn: Turn = { id: 't1', player: 'Evening.', beats: [{ kind: 'dialogue', speaker: 'mara', text: 'You let someone in after closing.' }], checks: [], speakers: ['mara'], texture: [], records }
  return { ...state, scene: { ...state.scene!, turns: [turn] } }
}

describe('who knows what, for the writer', () => {
  it('names who here knows a kept secret and who may only ask, guess or deny', () => {
    expect(knowledgeLines(fixture, yardScene(), keeping)).toEqual([
      "- Tobin's secret, which Tobin is keeping. Only Tobin knows it here. Mara doesn't, so Mara may ask about it, guess or deny it, but never say it as something known."
    ])
    expect(buildWriterPrompt(fixture, yardScene(), keeping, 'Evening.').user).toContain('# Who knows what\n- Tobin')
    expect(buildWriterPrompt(fixture, yardScene(), keeping, 'Evening.').system).toContain('What each person knows comes first.')
  })

  it('reminds the writer, without the secret, when a director note uses its keywords; a keyword never cuts anything', () => {
    const touching = plan({ speakers: [{ id: 'mara', intent: 'ask who came by after closing' }], change: 'Mara presses Tobin.' })
    const lines = knowledgeLines(keyed, yardScene(), touching)
    expect(lines).toEqual(["- The plan touches Tobin's secret, which this brief doesn't give you. Only Tobin knows it here. Mara doesn't, so Mara may ask about it, guess or deny it, but never say it as something known."])
    const prompt = buildWriterPrompt(keyed, yardScene(), touching, 'Evening.').user
    expect(prompt).toContain('ask who came by after closing')
    expect(prompt).not.toContain('let someone into the yard')
    expect(knowledgeLines(keyed, yardScene(), plan({ speakers: [{ id: 'mara', intent: 'talk about the weather' }] }))).toEqual([])
  })

  it('says nothing once everyone here knows it, or it was said on screen', () => {
    const learned: GameState = { ...yardScene(), memories: [MemorySchema.parse({ id: 'mara.m1', owner: 'mara', text: 'x', level: 'normal', at: 0, fadeFrom: 0, secret: TOBIN })] }
    expect(knowledgeLines(fixture, learned, keeping)).toEqual([])
    const told: GameState = { ...yardScene(), scene: { ...yardScene().scene!, told: [TOBIN] } }
    expect(knowledgeLines(fixture, told, keeping)).toEqual([])
  })
})

describe('a leak carried as a claim', () => {
  it('goes to the director, the writer and the scene-end calls as a claim, until someone confirms it', () => {
    const state = leaked()
    expect(claimLines(fixture, state)).toEqual(['- Mara said, as if they knew it, "You let someone in after closing" (turn 1). Nobody has confirmed it.'])
    expect(buildDirectorPrompt(fixture, state, 'Well?').user).toContain('# Claimed but never confirmed (claims, not facts: anyone may doubt or deny them)\n- Mara said')
    expect(buildWriterPrompt(fixture, state, plan(), 'Well?').user).toContain('# Claimed but never confirmed')
    const memory = buildMemoryPrompt(fixture, state, 'tobin')
    expect(memory.user).toContain('- Claimed in front of Tobin this scene and never confirmed (claims, not facts):\n  - Mara said, as if they knew it, "You let someone in after closing"')
    expect(memory.system).toContain('A guess, a suspicion or a claim nobody confirmed stays one in the memory')
    // Mara's own memory isn't told her own claim as something said in front of her.
    expect(buildMemoryPrompt(fixture, state, 'mara').user).not.toContain('Claimed in front of')
    const confirmed: GameState = { ...state, scene: { ...state.scene!, told: [TOBIN] } }
    expect(claimLines(fixture, confirmed)).toEqual([])
  })
})

describe('the director (task 3)', () => {
  it('is told a plan gives nobody knowledge', () => {
    expect(buildDirectorPrompt(fixture, yardScene(), 'Evening.').system).toContain('- A plan gives nobody knowledge.')
  })

  it('needs no difficulty on a reading check: the game sets it, and corrects only a word that differs', () => {
    const checks = (difficulty?: string) => {
      const raw = { player_action: { doing: 'studies Tobin', uncertain: true, reading: 'tobin' }, speakers: [{ id: 'tobin', goal: 'answer' }], moves: [{ who: 'tobin', answers: 'player', move: 'answer' }], checks: [{ id: 'read', who: 'player', skill: 'notice', target: 'tobin', stakes: 'sees what he feels', ...(difficulty && { difficulty }) }] }
      return validatePlan(fixture, yardScene(), parsePlan(JSON.stringify(raw))!, 'I study Tobin.')
    }
    const left = checks()
    expect(left.plan.checks).toHaveLength(1)
    expect(left.plan.checks[0]!.difficulty).toBeTruthy()
    expect(left.corrections.filter((c) => c.includes('reading'))).toEqual([])
    const wrong = left.plan.checks[0]!.difficulty === 'routine' ? 'grim' : 'routine'
    expect(checks(wrong).corrections.some((c) => c.includes(`not ${wrong}, by their masking`))).toBe(true)
  })

  it('gives the shades by family without their usual intensities, and no pressure step rule', () => {
    const system = buildDirectorPrompt(fixture, yardScene(), 'Evening.').system
    expect(system).toContain('- Shades by family: sad: glum, sore; mad: sore, livid; startled (in the moment only): jolted.')
    expect(system).not.toContain('moves at most one step a turn')
  })
})
