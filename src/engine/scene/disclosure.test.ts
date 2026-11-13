import { describe, expect, it } from 'vitest'
import type { Pack } from '@engine/pack'
import type { GameState } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { buildDirectorPrompt } from './director'
import { parsePlan, validatePlan } from './plan'

// Mara's ledger secret asks bond "fond" (≥ 5) and warmth "fair" (≥ 1) of her feelings toward whoever she tells.
// She starts at warmth 2, bond 3 toward the player, and warmth 1, bond −1 toward Tobin.
const LEDGER = 'mara.two-books'

/** Mara tells the player (or, with `toTobin`, answers Tobin's question) using a fact. */
function plan(fact: string, toTobin = false) {
  const moves = toTobin
    ? [
        { who: 'tobin', answers: 'player', move: 'ask' },
        { who: 'mara', answers: 1, move: 'reveal', uses: [fact] }
      ]
    : [{ who: 'mara', answers: 'player', move: 'reveal', uses: [fact] }]
  return parsePlan(
    JSON.stringify({
      speakers: [
        ...(toTobin ? [{ id: 'tobin', goal: 'ask her straight', mood: 'uneasy' }] : []),
        { id: 'mara', goal: 'come clean', mood: 'tired' }
      ],
      moves
    })
  )!
}
const shared = (content: Pack, state: GameState, fact: string, toTobin = false) => {
  const { plan: p, corrections } = validatePlan(content, state, plan(fact, toTobin))
  return { said: p.moves!.flatMap((m) => m.says.map((s) => s.id)), corrections }
}
const withMeters = (state: GameState, toPlayer: Record<string, number>): GameState => ({ ...state, meters: { ...state.meters, mara: toPlayer } })

// Milestone 4a, task 5: a deliberate disclosure is checked against the secret's own minimums before the writer gets it.
describe('voluntary disclosure', () => {
  it('drops a secret the holder won’t share yet, and says why', () => {
    const { said, corrections } = shared(fixture, yardScene(), LEDGER)
    expect(said).toEqual([])
    expect(corrections).toContain(`move 1: mara won't share ${LEDGER} with player yet`)
  })

  it('needs every meter the secret names, and nothing of meters it leaves out', () => {
    expect(shared(fixture, withMeters(yardScene(), { warmth: 1, bond: 5 }), LEDGER).said).toEqual([LEDGER])
    expect(shared(fixture, withMeters(yardScene(), { warmth: 0, bond: 9 }), LEDGER).said).toEqual([])
    // A secret whose minimums name only warmth passes on warmth alone, however low bond is.
    const lenient = withSecret({ id: 'spare-key', text: 'Mara keeps a spare key.', tell: 'x', disclose: { warmth: 'cool' } })
    expect(shared(lenient, withMeters(yardScene(), { warmth: -4, bond: -10 }), 'mara.spare-key').said).toEqual(['mara.spare-key'])
  })

  it('holds each secret to its own minimums', () => {
    const two = withSecret({ id: 'spare-key', text: 'Mara keeps a spare key.', tell: 'x', disclose: { warmth: 'cool' } })
    const state = withMeters(yardScene(), { warmth: 2, bond: 3 })
    expect(shared(two, state, 'mara.spare-key').said).toEqual(['mara.spare-key'])
    expect(shared(two, state, LEDGER).said).toEqual([])
  })

  it('reads the holder’s feelings toward the listener: the speaker of the move answered, not the player', () => {
    // Warm enough toward the player, cold toward Tobin: telling Tobin is refused.
    const state = withMeters(yardScene(), { warmth: 9, bond: 9 })
    expect(shared(fixture, state, LEDGER).said).toEqual([LEDGER])
    expect(shared(fixture, state, LEDGER, true).corrections).toContain(`move 2: mara won't share ${LEDGER} with tobin yet`)
    // Warm toward Tobin, cold toward the player: telling Tobin is fine.
    const fond = { ...withMeters(yardScene(), { warmth: -9, bond: -9 }) }
    fond.relations = fond.relations.map((r) => (r.from === 'mara' && r.to === 'tobin' ? { ...r, meters: { warmth: 3, bond: 6 } } : r))
    expect(shared(fixture, fond, LEDGER, true).said).toEqual([LEDGER])
  })

  it('doesn’t gate what is already out: a secret said on screen, or one the player already knows', () => {
    const told = yardScene()
    told.scene!.told.push(LEDGER)
    expect(shared(fixture, told, LEDGER).said).toEqual([LEDGER])
    const known = yardScene()
    known.facts['mara'] = [fixture.characters.find((c) => c.id === 'mara')!.secrets[0]!.text]
    expect(shared(fixture, known, LEDGER).said).toEqual([LEDGER])
  })

  it('leaves discovery alone: once it is out, someone else who heard it can repeat it without Mara’s gate', () => {
    const told = yardScene()
    told.scene!.told.push(LEDGER)
    const p = parsePlan(JSON.stringify({ speakers: [{ id: 'tobin', goal: 'pass it on', mood: 'uneasy' }], moves: [{ who: 'tobin', answers: 'player', move: 'explain', uses: [LEDGER] }] }))!
    expect(validatePlan(fixture, told, p).plan.moves![0]!.says.map((s) => s.id)).toEqual([LEDGER])
  })

  it('tells the director in words whether the holder would tell the player now', () => {
    expect(buildDirectorPrompt(fixture, yardScene(), 'Hello.').system).toMatch(/Secret \[mara\.two-books\][^\n]*Won't tell the player yet\./)
    expect(buildDirectorPrompt(fixture, withMeters(yardScene(), { warmth: 1, bond: 5 }), 'Hello.').system).toMatch(/Would tell the player now, if it fits\./)
  })
})

function withSecret(secret: Pack['characters'][number]['secrets'][number]): Pack {
  return { ...fixture, characters: fixture.characters.map((c) => (c.id === 'mara' ? { ...c, secrets: [...c.secrets, secret] } : c)) }
}
