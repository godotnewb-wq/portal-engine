import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsSchema } from '@llm'
import { runTurn, type TurnLlm } from '@engine/scene'
import { endScene } from '@engine/relationships'
import { fixture, yardScene } from '@tests/fixture'
import { FILES, joinSections, LogSession, promptOf, readSession, roleModels, sections, findSessions } from '.'

const PLAN = JSON.stringify({ speakers: [{ id: 'mara', intent: 'Press him.', mood: 'sharp' }], reactions: [{ id: 'tobin', beat: 'looks at his boots' }] })
const llm: TurnLlm = {
  direct: async () => PLAN,
  write: async (_p, onDelta) => {
    const reply = 'NARRATION: Tobin looks at his boots.\nMara: "Well?"'
    onDelta(reply)
    return reply
  }
}

const root = () => mkdtempSync(join(tmpdir(), 'portal-logs-'))
const info = { kind: 'play' as const, pack: { id: fixture.manifest.id, version: fixture.manifest.version }, engine: '0.2.0', prompts: 'abc', models: {} }

describe('prompt sections', () => {
  it('cut before headings and join back exactly', () => {
    const text = 'Rules.\n\n# World\nA place.\n\n## Ada\nA voice.\n\nPlain paragraph.\n# not a break'
    expect(sections(text)).toEqual(['Rules.', '# World\nA place.', '## Ada\nA voice.\n\nPlain paragraph.\n# not a break'])
    expect(joinSections(sections(text))).toBe(text)
  })
})

describe('LogSession (milestone 2, A2)', () => {
  it('writes a session folder whose files join back into the turn, prompts stored once', async () => {
    const dir = root()
    const log = LogSession.open(dir, info, new Date(2026, 10, 5, 20, 3), '2026-11-05_2003_a1b2')
    expect(log.id).toBe('2026-11-05_2003_a1b2')
    let state = yardScene()
    log.sceneStart({ sceneId: state.scene!.id, location: state.scene!.locationId, cast: state.scene!.cast })
    const first = await runTurn(fixture, state, 'Tobin?', llm, () => {}, { log: log.id })
    log.turn(first.trace)
    state = first.state
    const second = await runTurn(fixture, state, 'And?', llm, () => {}, { log: log.id })
    log.turn(second.trace)
    const end = await endScene(fixture, second.state, async () => JSON.stringify({ memory: 'Rain.', level: 'fleeting' }))
    log.sceneEnd(end.trace)
    log.close()

    expect(readdirSync(log.dir).sort()).toEqual([FILES.calls, FILES.prompts, FILES.scenes, FILES.session, FILES.turns].sort())
    const read = readSession(log.dir)
    expect(read.session).toMatchObject({ id: log.id, startedAt: expect.any(String), endedAt: expect.any(String) })
    expect(read.turns.map((t) => t.calls)).toEqual([[`${state.scene!.id}-1:director`, `${state.scene!.id}-1:writer`], [`${state.scene!.id}-2:director`, `${state.scene!.id}-2:writer`]])
    expect(read.scenes.map((s) => s.type)).toEqual(['start', 'end'])
    expect(read.calls.size).toBe(4 + 2)
    // Every prompt comes back exactly as sent.
    const call = read.calls.get(`${state.scene!.id}-2:writer`)!
    expect(promptOf(read, call)).toEqual(second.trace.calls[1]!.prompt)
    // The director's rules, world and location are the same on both turns: stored once. The character sheets change
    // with the moods.
    const ids = readFileSync(join(log.dir, FILES.prompts), 'utf8').trim().split('\n').map((l) => JSON.parse(l).id)
    expect(new Set(ids).size).toBe(ids.length)
    const [a, b] = [1, 2].map((n) => read.calls.get(`${state.scene!.id}-${n}:director`)!.prompt.system)
    expect(a!.slice(0, 3)).toEqual(b!.slice(0, 3))
    expect(read.unreadable).toBe(0)
  })

  it('records errors with the calls made before them, and survives a half-written line', async () => {
    const dir = root()
    const log = LogSession.open(dir, info)
    log.error({ where: 'turn', message: 'rate limited', turnId: 't1', calls: [] })
    const resumed = LogSession.resume(log.dir)
    resumed.flag({ session: log.id, turnSession: log.id, turnId: 't1', beat: 2, flag: { rating: 'bad', reasons: ['voice'], note: '' }, at: '2026-11-05T20:00:00Z' })
    const read = readSession(log.dir)
    expect(read.errors).toEqual([expect.objectContaining({ where: 'turn', message: 'rate limited', turnId: 't1' })])
    expect(read.flags).toHaveLength(1)
    expect(read.session.endedAt).toBeUndefined()
    expect(findSessions(dir)).toEqual([log.dir])
  })

  it('never writes an API key: session models carry profile, model and temperature only', () => {
    const settings = SettingsSchema.parse({ writer: { baseUrl: 'https://x.example/v1?key=sk-secret', apiKey: 'sk-secret', model: 'strong' }, director: { baseUrl: 'https://x', apiKey: 'sk-other', model: 'fast' } })
    const models = roleModels(settings)
    expect(models).toEqual({ director: { profile: 'director', model: 'fast', temperature: 0.8 }, writer: { profile: 'writer', model: 'strong', temperature: 0.8 }, summary: { profile: 'writer', model: 'strong', temperature: 0.8 } })
    const log = LogSession.open(root(), { ...info, models })
    log.close()
    expect(readFileSync(join(log.dir, FILES.session), 'utf8')).not.toMatch(/sk-|x\.example/)
  })
})
