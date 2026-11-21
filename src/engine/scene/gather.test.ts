import { describe, expect, it } from 'vitest'
import type { Pack } from '@engine/pack'
import type { GameState, Turn } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { gatherScene, recentlyLive } from './gather'

// The `scene` pipeline's gathering (Milestone 5 plan, task 1; scene system redesign §5): what could be live for each
// character, and the facts each may draw on. The yard: Mara keeps the Guild's second ledger (a linked secret), Tobin
// let someone in after closing (a personal one); Mara counts Tobin a rival; Tobin works for Kit, the player.

const turn = (over: Partial<Turn> = {}): Turn => ({ id: 't1', player: 'Evening.', beats: [], checks: [], speakers: [], texture: [], ...over })
const withTurns = (state: GameState, ...turns: Turn[]): GameState => ({ ...state, scene: { ...state.scene!, turns } })
const without = (state: GameState, ...gone: string[]): GameState => ({ ...state, scene: { ...state.scene!, departed: gone } })

describe('secrets that could be live', () => {
  it('are none when nothing just said touches them', () => {
    const g = gatherScene(fixture, yardScene(), 'Cold tonight.')
    expect(g.options['mara']!.secrets).toEqual([])
    expect(g.options['tobin']!.secrets).toEqual([])
  })

  it('come from a keyword in the player’s words or the last turn, not from earlier turns', () => {
    expect(gatherScene(fixture, yardScene(), 'Is there a second ledger?').options['mara']!.secrets).toEqual([{ id: 'mara.two-books', text: expect.any(String), how: 'keyword', by: 'second ledger' }])
    const last = withTurns(yardScene(), turn({ beats: [{ kind: 'dialogue', speaker: 'tobin', text: 'Someone said there’s a second ledger.' }] }))
    expect(gatherScene(fixture, last, 'Cold tonight.').options['mara']!.secrets.map((s) => s.how)).toEqual(['keyword'])
    const older = withTurns(yardScene(), turn({ id: 't1', player: 'Is there a second ledger?' }), turn({ id: 't2' }))
    expect(gatherScene(fixture, older, 'Cold tonight.').options['mara']!.secrets).toEqual([])
  })

  it('come from their subject: a linked secret’s faction brought up', () => {
    expect(gatherScene(fixture, yardScene(), 'Who runs the guild hall these days?').options['mara']!.secrets).toEqual([{ id: 'mara.two-books', text: expect.any(String), how: 'subject', by: 'The Guild' }])
  })

  it('come from a person the secret names, only when that person isn’t here', () => {
    const naming: Pack = { ...fixture, characters: fixture.characters.map((c) => (c.id === 'mara' ? { ...c, secrets: [{ id: 'owes', text: 'Mara owes Tobin a month of wages.', tell: 'looks away', disclose: {} } as never] } : c)) }
    // Tobin is here and named all the time: that alone doesn't put Mara's secret in play.
    expect(gatherScene(naming, yardScene(), 'Tobin, come here.').options['mara']!.secrets).toEqual([])
    expect(gatherScene(naming, without(yardScene(), 'tobin'), 'Where did Tobin go?').options['mara']!.secrets).toEqual([{ id: 'mara.owes', text: 'Mara owes Tobin a month of wages.', how: 'person', by: 'Tobin' }])
  })
})

describe('ties in play', () => {
  it('are those toward the player and toward people here, in words, with their notes', () => {
    const g = gatherScene(fixture, yardScene(), 'Evening.')
    expect(g.options['mara']!.ties).toEqual([{ with: 'tobin', words: 'rival', note: 'has known him since the guild took him on', how: 'present' }])
    expect(g.options['tobin']!.ties).toEqual([{ with: 'player', words: 'employer', note: 'took him on for the night shift last month', how: 'present' }])
  })

  it('include someone not here once they are named in what was just said', () => {
    expect(gatherScene(fixture, without(yardScene(), 'tobin'), 'Evening.').options['mara']!.ties).toEqual([])
    expect(gatherScene(fixture, without(yardScene(), 'tobin'), 'Seen Tobin?').options['mara']!.ties.map((t) => [t.with, t.how])).toEqual([['tobin', 'named']])
  })
})

describe('tonight’s aim', () => {
  it('starts at the card’s word, or the weakest, and then holds where the director left it', () => {
    expect(gatherScene(fixture, yardScene(), 'Evening.').options['mara']!.goal).toEqual({ text: 'Find out who keeps skimming the tallies', strength: 'idle', level: 0 })
    const keen: Pack = { ...fixture, characters: fixture.characters.map((c) => (c.id === 'mara' ? { ...c, agenda: { ...c.agenda, pressure: 'keen' } } : c)) }
    expect(gatherScene(keen, yardScene(), 'Evening.').options['mara']!.goal.strength).toBe('keen')
    const moved = yardScene()
    moved.scene!.pressures['mara'] = 2
    expect(gatherScene(keen, moved, 'Evening.').options['mara']!.goal).toMatchObject({ strength: 'driven', level: 2 })
  })
})

describe('recently live', () => {
  it('reads the last turns’ live pressures, newest first, and situation’s kept secrets', () => {
    const state = withTurns(
      yardScene(),
      turn({ id: 't1', live: [{ who: 'mara', kind: 'tie', ref: 'tobin' }] }),
      turn({ id: 't2', kept: ['tobin.after-closing'] }),
      turn({ id: 't3', live: [{ who: 'mara', kind: 'goal', ref: 'mara' }] })
    )
    // Two turns back by default: t1 is too old.
    expect(recentlyLive(fixture, state)).toEqual({ mara: [{ who: 'mara', kind: 'goal', ref: 'mara' }], tobin: [{ who: 'tobin', kind: 'secret', ref: 'tobin.after-closing' }] })
  })
})

describe('the fact pool', () => {
  it('offers knowledge the conversation reaches, marked as the card’s and unheard', () => {
    const pool = gatherScene(fixture, yardScene(), 'Who was in the yard after closing?').pools['mara']!
    expect(pool).toContainEqual({ id: 'mara.k1', text: 'Tobin was in the yard after closing', source: 'card', unheard: true })
  })

  it('offers lore just brought up that they know, never a secret entry', () => {
    const pool = gatherScene(fixture, yardScene(), 'Tell me about the guild hall and the second ledger.').pools['mara']!
    expect(pool.filter((f) => f.source === 'lore').map((f) => f.id)).toContain('lore.faction.guild')
    expect(pool.some((f) => f.id === 'lore.faction.guild.second-ledger')).toBe(false)
  })

  it('leaves out the scene’s background lore: only what the conversation brought up', () => {
    const quiet = gatherScene(fixture, yardScene(), 'Cold tonight.')
    expect(Object.values(quiet.pools).flat().filter((f) => f.source === 'lore')).toEqual([])
  })

  it('leaves out a fact the player was told, unless they ask about it again', () => {
    const told = yardScene()
    told.scene!.told = ['mara.k1']
    expect(gatherScene(fixture, told, 'Cold tonight.').pools['mara']!.some((f) => f.id === 'mara.k1')).toBe(false)
    expect(gatherScene(fixture, told, 'Who was in the yard after closing?').pools['mara']!.find((f) => f.id === 'mara.k1')).toMatchObject({ unheard: false })
  })

  it('holds at most the ruleset’s pool size', () => {
    const one: Pack = { ...fixture, ruleset: { ...fixture.ruleset, scene: { ...fixture.ruleset.scene, factPool: 1 } } }
    for (const pool of Object.values(gatherScene(one, yardScene(), 'Tell me about the guild hall, the yard and who was in it after closing.').pools)) expect(pool.length).toBeLessThanOrEqual(1)
  })
})
