import { describe, expect, it } from 'vitest'
import { SettingsSchema } from '@llm'
import { fixture, yardScene } from '@tests/fixture'
import { bookkeeperWaitMs, bookkeepWithin } from './roles'

// Milestone 4c task 2: how long a turn waits for its bookkeeper (decisions A and I, 2026-11-18, user).
const written = { id: 't1', input: 'Evening.', beats: [{ kind: 'dialogue' as const, speaker: 'tobin', text: 'Evening.' }], plan: { speakers: [], exchange: [], reactions: [], checks: [], walk_ons: [], texture: [], avoid: [], leaves: [], end_scene: false } }

describe('waiting for the bookkeeper', () => {
  it('waits for the answering profile’s timeout: the bookkeeper’s own, else the one it borrows', () => {
    const blank = SettingsSchema.parse({})
    expect(bookkeeperWaitMs(blank)).toBe(120_000)
    // Set up as the app does: the role's defaults first, then what the player typed.
    const summary = { ...blank.summary, baseUrl: 'http://x', model: 's', timeoutSeconds: 200 }
    const own = { ...blank, bookkeeper: { ...blank.bookkeeper, baseUrl: 'http://x', model: 'm' }, summary }
    expect(bookkeeperWaitMs(own)).toBe(30_000)
    const borrowed = { ...blank, summary }
    expect(bookkeeperWaitMs(borrowed)).toBe(200_000)
  })

  it('takes an answer in time, and past the limit keeps the plan’s records and discards the reply', async () => {
    const on = await bookkeepWithin(fixture, yardScene(), written, async () => '{"secrets": []}', 1000)
    expect(on).toMatchObject({ late: false, records: { source: 'bookkeeper' } })
    const never = await bookkeepWithin(fixture, yardScene(), written, () => new Promise(() => {}), 20)
    expect(never).toMatchObject({ late: true, records: { source: 'plan', unaudited: true }, trace: { turnId: 't1', error: 'no answer within 0 seconds', calls: [] } })
  })
})
