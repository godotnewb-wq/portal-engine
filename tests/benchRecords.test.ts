import { describe, expect, it } from 'vitest'
import { BookkeepingSchema } from '@engine/state'
import type { TurnTrace } from '@engine/scene'
import { intended, recordLines } from '../tools/bench/records'

const trace = (plan: object) => ({ director: { plan } }) as unknown as TurnTrace

describe('the bench records, on both plan shapes (Milestone 5 task 4)', () => {
  it('reads the scene plan’s stakes where situation has its change (Q4)', () => {
    expect(intended(trace({ change: 'Kit learns of the ledger', speakers: [], reactions: [] }))).toBe('Kit learns of the ledger')
    expect(intended(trace({ change: undefined, speakers: [], reactions: [], scene: { stakes: 'whether Kit believes there is one book' } }))).toBe('whether Kit believes there is one book')
  })

  it('lists the facts the player heard, and names the stakes as such', () => {
    const records = BookkeepingSchema.parse({ source: 'bookkeeper', said: [{ fact: 'lore.tallies', text: 'The tallies are rounded', by: 'tobin', words: 'rounded in the Guild’s favor' }], changed: 'Kit knows the tallies are rounded' })
    const lines = recordLines((id) => id, trace({ speakers: [], reactions: [], scene: { stakes: 'whether Kit learns how the tallies work' } }), { turnId: 't', records } as never)
    expect(lines).toContain('Heard: `lore.tallies` by tobin: “rounded in the Guild’s favor”')
    expect(lines).toContain("Changed: Kit knows the tallies are rounded · director's stakes: whether Kit learns how the tallies work")
  })
})
