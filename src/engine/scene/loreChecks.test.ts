import { describe, expect, it } from 'vitest'
import { fixture, yardScene } from '@tests/fixture'
import { checkNames, secretLeaks } from '@engine/codex'
import type { BeatPlan } from './plan'
import { parseReply } from './beats'
import { loreProblems, packNames } from './checks'
import { sceneSpeakers } from './writer'

// The writer's lore checks (claude/lore-injection.md §11): canon names, and secrets nobody here is keeping.
const state = yardScene()
const names = (text: string) => checkNames(text, packNames(fixture, [state.player.name])).map((f) => [f.kind, f.name])
const plan = (kept?: string[]): BeatPlan => ({ speakers: [{ id: 'mara', point: '', intent: '', mood: 'calm', ...(kept && { kept }) }], checks: [] }) as unknown as BeatPlan
const problems = (prose: string, kept?: string[]) => loreProblems(fixture, state, plan(kept), parseReply(prose, sceneSpeakers(fixture, state)))

describe('canon names', () => {
  it('pass the setting’s names, aliases, plurals and people', () => {
    expect(names('The Night Shift met at East Gate, past the Ward Watch.')).toEqual([])
    expect(names('Mara and Tobin argued about the Guild Yard.')).toEqual([])
  })

  it('flag a near miss with the right name, and an invented one', () => {
    expect(names('The Night Crew owns the cart road.')).toEqual([['wrong-name', 'The Night Crew']])
    expect(names('A patrol from the Ward Guard went by.')).toEqual([['invented-name', 'Ward Guard']])
  })

  it('leave an ordinary capital at the start of a sentence alone', () => {
    expect(names('Carts rolled in. Later the gate shut.')).toEqual([])
  })
})

describe('secret leaks', () => {
  it('find a secret by its keyword or a run of its words', () => {
    expect(secretLeaks('She mentions the second ledger.', fixture.codex).map((l) => l.entry.id)).toEqual(['faction.guild.second-ledger'])
    expect(secretLeaks('It is kept in the tally office, they say.', fixture.codex).map((l) => l.words)).toEqual(['it is kept in the tally'])
    expect(secretLeaks('The tally office is cold.', fixture.codex)).toEqual([])
  })
})

describe('loreProblems', () => {
  it('tell the writer the right name, and drop a leaked secret unless its holder is keeping it', () => {
    const prose = 'NARRATION: The Night Crew passes. Somewhere there is a second ledger.\nMara: "Nothing to see."'
    expect(problems(prose).map((p) => [p.kind, p.beat])).toEqual([
      ['wrong-name', 1],
      ['secret-leak', 1]
    ])
    expect(problems(prose)[0]!.fix).toContain('"The Night Shift"')
    expect(problems(prose, ['mara.two-books']).map((p) => p.kind)).toEqual(['wrong-name'])
  })
})
