import { describe, expect, it } from 'vitest'
import { fixture, yardScene } from '@tests/fixture'
import { checkNames } from '@engine/codex'
import { parseReply } from './beats'
import { loreProblems, packNames } from './checks'
import { sceneSpeakers } from './writer'

// The writer's lore checks (claude/lore-injection.md §11): canon names. The secret-leak check was removed 2026-11-12.
const state = yardScene()
const names = (text: string) => checkNames(text, packNames(fixture, [state.player.name])).map((f) => [f.kind, f.name])
const problems = (prose: string) => loreProblems(fixture, state, parseReply(prose, sceneSpeakers(fixture, state)))

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

describe('loreProblems', () => {
  it('tell the writer the right name, and leave a secret said aloud to the story (no leak check since 2026-11-12)', () => {
    const prose = 'NARRATION: The Night Crew passes. Somewhere there is a second ledger.\nMara: "Nothing to see."'
    expect(problems(prose).map((p) => [p.kind, p.beat])).toEqual([['wrong-name', 1]])
    expect(problems(prose)[0]!.fix).toContain('"The Night Shift"')
  })
})
