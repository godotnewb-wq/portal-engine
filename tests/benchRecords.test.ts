import { describe, expect, it } from 'vitest'
import type { CallRole } from '@engine/core'
import { BookkeepingSchema } from '@engine/state'
import type { TurnTrace } from '@engine/scene'
import { intended, recordLines, renderTokenRows, tokenRows } from '../tools/bench/records'

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

describe('tokens and cache hits by role (task 8b)', () => {
  const call = (role: string, input: number, cached?: number) => ({ role: role as CallRole, meta: { usage: { input, output: 10, ...(cached !== undefined && { cached }) } } })
  it('counts cache hits over the calls that reported them', () => {
    const rows = tokenRows([call('director', 1000, 800), call('director', 1000), call('writer', 500, 0), call('memory', 400, 300), call('opening', 300)], 2, 1)
    expect(rows.map((r) => [r.role, r.cached, r.reported, r.unit])).toEqual([
      ['director', 800, 1000, 'turn'],
      ['writer', 0, 500, 'turn'],
      ['memory', 300, 400, 'scene end'],
      ['opening', 0, 0, 'call']
    ])
    const table = renderTokenRows(rows)
    expect(table).toContain('| director | 2 | 2000 | 800 | 80% |')
    expect(table).toContain('| opening | 1 | 300 | — | — |')
    expect(table).toMatch(/Cache hits: 58% of input \(of the calls that reported it\)\.$/)
  })

  it('says so when no provider reported its cache', () => {
    expect(renderTokenRows(tokenRows([call('writer', 500)], 1, 0))).toMatch(/Cache hits: — of input \(no provider reported its cache\)\.$/)
  })
})
