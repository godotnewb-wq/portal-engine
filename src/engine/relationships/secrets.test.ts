import { describe, expect, it } from 'vitest'
import { entryById, knows } from '@engine/codex'
import { characterById, type Pack } from '@engine/pack'
import { applyRecords, applyTurn, buildBriefs, canSay, knowerIn, parsePlan, parseReply, sceneFacts, settlePlan, turnLore, validatePlan, type BeatPlan } from '@engine/scene'
import { BookkeepingSchema, GameStateSchema, startScene, type Bookkeeping, type GameState } from '@engine/state'
import type { CheckResult } from '@engine/rules'
import { fixture, yardScene } from '@tests/fixture'
import { applySummaries, buildMemoryPrompt, plainSummary, type Summary } from './summary'

// Milestone 4b, task 5b: secrets learned in play, who knows them, and dormant secrets (decided 2026-11-13).
const ASK = 'Tobin, who did you let in?'
const plan = (raw: object) => validatePlan(fixture, yardScene(), parsePlan(JSON.stringify(raw))!, ASK).plan
const said = (state: GameState, p: BeatPlan, speaker: string) => applyTurn(fixture, state, { id: 't1', input: ASK, plan: p, beats: [{ kind: 'dialogue', speaker, text: 'x' }], tags: parseReply('', []).tags, dice: 1 })
const end = (state: GameState, id: string, over: Partial<Summary>) => applySummaries(fixture, state, [{ id, summary: { ...plainSummary(fixture, state, id), ...over } }])
const tells = plan({ speakers: [{ id: 'tobin', goal: 'come clean' }], moves: [{ who: 'tobin', answers: 'player', move: 'reveal', uses: ['tobin.after-closing'] }] })

// Since milestone 4c (decisions J–L, 2026-11-18, user) a secret comes out through the turn's records: the bookkeeper's,
// or the plan's until it answers and when it fails. The plan gives only a holder's voiced reveal or concede, not kept;
// the bookkeeper's own rules are tested in @engine/scene's bookkeeper.test.ts.
describe('a secret coming out on screen', () => {
  const by = (move: string, extra: object = {}) =>
    validatePlan(fixture, yardScene(), parsePlan(JSON.stringify({ speakers: [{ id: 'tobin', goal: 'get through it', ...extra }], moves: [{ who: 'tobin', answers: 'player', move, uses: ['tobin.after-closing'] }] }))!, 'Tobin, who came by after closing?').plan
  const run = (p: BeatPlan, text = 'x', input = ASK, state = yardScene()) => {
    const next = applyTurn(fixture, state, { id: 't1', input, plan: p, beats: text ? [{ kind: 'dialogue', speaker: 'tobin', text }] : [], tags: parseReply('', []).tags, dice: 1 })
    return { exposed: next.scene!.turns.at(-1)!.exposed ?? [], told: next.scene!.told }
  }
  const none = { exposed: [], told: [] }
  const out = { exposed: [{ secret: 'tobin.after-closing', to: ['mara'] }], told: ['tobin.after-closing'] }

  it('until the bookkeeper answers, comes out on its holder’s voiced reveal or concede, unless they keep it, whatever the approach', () => {
    expect(run(by('reveal'))).toEqual(out)
    expect(run(by('concede'))).toEqual(out)
    expect(run(by('reveal'), '')).toEqual(none)
    expect(run(by('concede', { keeps: ['tobin.after-closing'], touched: 'after closing', approach: 'lie' }))).toEqual(none)
    expect(run(by('reveal', { keeps: ['tobin.after-closing'], touched: 'after closing', approach: 'partial truth' }))).toEqual(none)
    expect(said(yardScene(), tells, 'tobin').scene!.turns[0]!.records).toMatchObject({ source: 'plan', unaudited: true })
  })

  it('no longer comes out on a dodge, an answer naming it, someone else’s telling, or the player saying it by its keywords', () => {
    expect(run(by('dodge'), 'Someone came by after closing? No idea.')).toEqual(none)
    expect(run(by('answer'), 'Fine. I let someone in after closing.')).toEqual(none)
    const text = fixture.characters.find((c) => c.id === 'tobin')!.secrets[0]!.text
    const knowing = { ...yardScene(), facts: { tobin: [text] } }
    const quiet = plan({ speakers: [{ id: 'mara', goal: 'listen' }], moves: [{ who: 'mara', answers: 'player', move: 'answer' }] })
    expect(run(quiet, '', 'Mara, Tobin let someone in after closing.', knowing)).toEqual(none)
  })

  it('a reading check that sees through someone keeping one shows that something is hidden, never what', () => {
    const p = validatePlan(fixture, yardScene(), parsePlan(JSON.stringify({
      player_action: { doing: 'presses Tobin', uncertain: true },
      speakers: [{ id: 'tobin', goal: 'dodge', keeps: ['tobin.after-closing'], touched: 'after closing', approach: 'lie' }],
      moves: [{ who: 'tobin', answers: 'player', move: 'dodge' }],
      checks: [{ id: 'look', who: 'mara', skill: 'notice', difficulty: 'tough', target: 'tobin', stakes: 'sees he is lying' }]
    }))!, 'Tobin, who came by after closing?').plan
    const settled = settlePlan(fixture, yardScene(), { ...p, checks: p.checks.map((c) => ({ ...c, result: { degree: 'success', natural: 15, total: 15, dc: 13 } as CheckResult })) })
    expect(settled.reads).toMatchObject([{ by: 'mara', target: 'tobin', hiding: true }])
    const next = applyTurn(fixture, yardScene(), { id: 't1', input: ASK, plan: settled, beats: [{ kind: 'dialogue', speaker: 'tobin', text: 'Nobody.' }], tags: parseReply('', []).tags, dice: 1 })
    expect(next.scene!.turns[0]!.exposed).toBeUndefined()
    expect(buildMemoryPrompt(fixture, next, 'mara').user).toMatch(/Mara saw through to what Tobin really felt: .*, and saw that Tobin was hiding something, though not what\./)
  })

  it('takes the bookkeeper’s records in place of the plan’s, and the same records twice change nothing', () => {
    const quiet = applyTurn(fixture, yardScene(), { id: 't1', input: ASK, plan: by('dodge'), beats: [{ kind: 'dialogue', speaker: 'tobin', text: 'I let her in, all right?' }], tags: parseReply('', []).tags, dice: 1 })
    const records: Bookkeeping = {
      ...BookkeepingSchema.parse({ source: 'bookkeeper' }),
      out: [{ secret: 'tobin.after-closing', by: 'tobin', at: 1, words: 'I let her in', how: 'confirmed', to: ['mara'] }],
      new: [{ text: 'three pennies', by: 'tobin' }]
    }
    const once = applyRecords(quiet, records)
    expect(once.scene!.told).toEqual(['tobin.after-closing'])
    expect(once.scene!.turns[0]).toMatchObject({ exposed: out.exposed, toldSecrets: ['tobin.after-closing'], records: { source: 'bookkeeper' } })
    expect(once.scene!.newFacts).toEqual([{ id: 'said.1', text: 'three pennies', by: 'tobin', turn: 't1' }])
    expect(applyRecords(once, records)).toEqual(once)
    // Records that take it back (the bookkeeper read a leak, say) undo what the plan's had added.
    const revealed = applyTurn(fixture, yardScene(), { id: 't1', input: ASK, plan: by('reveal'), beats: [{ kind: 'dialogue', speaker: 'tobin', text: 'x' }], tags: parseReply('', []).tags, dice: 1 })
    const back = applyRecords(revealed, BookkeepingSchema.parse({ source: 'bookkeeper' }))
    expect(back.scene!.told).toEqual([])
    expect(back.scene!.turns[0]!.exposed).toBeUndefined()
  })
})

describe('learning a secret', () => {
  const told = said(yardScene(), tells, 'tobin')

  it('offers the summary what came out in front of them, and keeps what they took in as a memory of at least Normal with the secret', () => {
    expect(buildMemoryPrompt(fixture, told, 'mara').user).toContain("- Other people's secrets that came out in front of Mara this scene:\n  - [tobin.after-closing] Tobin: Tobin let someone into the yard after closing.")
    expect(buildMemoryPrompt(fixture, told, 'mara').system).toContain("- heard: every one of the other people's secrets listed as coming out in front of Mara")
    expect(buildMemoryPrompt(fixture, told, 'tobin').system).not.toContain('- heard:')
    const { state, reports } = end(told, 'mara', { memories: [{ text: 'A long night.', level: 'fleeting', why: '' }], heard: [{ id: 'tobin.after-closing', memory: 'Tobin let someone in after closing.' }, { id: 'tobin.made-up', memory: 'x' }] })
    expect(state.memories.map((m) => [m.id, m.level, m.secret, m.about])).toEqual([['mara.m1', 'fleeting', undefined, ['player', 'tobin']], ['mara.m2', 'normal', 'tobin.after-closing', ['tobin']]])
    expect(reports[0]!).toMatchObject({ heard: ['tobin.after-closing'], memoryNotes: ['heard "tobin.made-up": it didn\'t come out in front of them this scene'] })
    // Once learned, it isn't offered again.
    const again = { ...said(state.scene ? state : startScene(fixture, state, 'the-yard', ['mara', 'tobin']), tells, 'tobin') }
    expect(buildMemoryPrompt(fixture, again, 'mara').user).not.toContain("Other people's secrets")
  })

  it('teaches it to everyone present even when the summary leaves it out of heard (decided 2026-11-16)', () => {
    const { state, reports } = end(told, 'mara', { memories: [{ text: 'A long night.', level: 'fleeting', why: '' }], heard: [] })
    expect(state.memories.map((m) => [m.level, m.secret, m.text])).toEqual([['fleeting', undefined, 'A long night.'], ['normal', 'tobin.after-closing', "Mara learned Tobin's secret: Tobin let someone into the yard after closing."]])
    expect(reports[0]!).toMatchObject({ heard: ['tobin.after-closing'], memoryNotes: ['heard "tobin.after-closing": left out of the summary, learned all the same'] })
    // A failed summary call (the plain summary) learns it too.
    expect(end(told, 'mara', {}).state.memories.some((m) => m.secret === 'tobin.after-closing')).toBe(true)
  })

  it('carries a linked secret’s codex pointer, so the knowledge filter counts the learner, and the knowledge outlasts recall', () => {
    // Mara warm enough toward the player to tell it (her secret's disclosure minimums).
    const base = { ...yardScene(), meters: { ...yardScene().meters, mara: { warmth: 9, bond: 9 } } }
    const p = validatePlan(fixture, base, parsePlan(JSON.stringify({ speakers: [{ id: 'mara', goal: 'confide' }], moves: [{ who: 'mara', answers: 'player', move: 'reveal', uses: ['mara.two-books'] }] }))!, 'x').plan
    const exposed = applyTurn(fixture, base, { id: 't1', input: 'x', plan: p, beats: [{ kind: 'dialogue', speaker: 'mara', text: 'x' }], tags: parseReply('', []).tags, dice: 1 })
    const { state } = end(exposed, 'tobin', { heard: [{ id: 'mara.two-books', memory: 'Mara keeps a second ledger.' }] })
    const learned = state.memories.find((m) => m.secret === 'mara.two-books')!
    expect(learned.codex).toBe('faction.guild.second-ledger')
    const entry = entryById(fixture.codex, 'faction.guild.second-ledger')!
    const tobin = characterById(fixture, 'tobin')!
    expect(knows(fixture.setting, entry, knowerIn(state, tobin))).toBe(true)
    expect(knows(fixture.setting, entry, knowerIn({ ...state, memories: state.memories.filter((m) => m !== learned) }, tobin))).toBe(false)
    const faded = { ...state, memories: state.memories.map((m) => (m === learned ? { ...m, inRecall: false } : m)) }
    expect(knows(fixture.setting, entry, knowerIn(faded, tobin))).toBe(true)
  })
})

describe('after a save and reload (acceptance 8)', () => {
  it('lets the learner use the secret when it comes up, holder here or not, with no kept-secret cue, and nobody else', () => {
    const { state } = end(said(yardScene(), tells, 'tobin'), 'mara', { heard: [{ id: 'tobin.after-closing', memory: 'Tobin let someone in.' }] })
    const reloaded = GameStateSchema.parse(JSON.parse(JSON.stringify(state)))
    // A scene with Mara and without Tobin: she can say it, and her brief brings it in when the player asks about it.
    const alone = startScene(fixture, reloaded, 'the-yard', ['mara'])
    const fact = sceneFacts(fixture, alone).find((f) => f.id === 'tobin.after-closing')!
    expect(fact).toMatchObject({ owner: 'tobin', knownBy: ['mara'] })
    expect(canSay(alone.scene!, fact, 'mara')).toBe(true)
    const briefs = buildBriefs(fixture, alone, 'Who came into the yard after closing?')
    expect(briefs.details.find((d) => d.id === 'mara:tobin.after-closing')).toMatchObject({ kind: 'knows', rank: 'answer', text: "[tobin.after-closing] Learned Tobin's secret: Tobin let someone into the yard after closing." })
    expect(briefs.sheets['mara']).not.toContain('Secret [tobin.after-closing]')
    // Tobin, who never learned Mara's, gains nothing.
    const other = startScene(fixture, reloaded, 'the-yard', ['tobin'])
    expect(sceneFacts(fixture, other).some((f) => f.id === 'mara.two-books')).toBe(false)
  })

  it('keeps a secret on the holder’s sheet only from those here who don’t know it', () => {
    const { state } = end(said(yardScene(), tells, 'tobin'), 'mara', { heard: [{ id: 'tobin.after-closing', memory: 'Tobin let someone in.' }] })
    const scene = startScene(fixture, state, 'the-yard', ['mara', 'tobin'])
    const line = (s: GameState) => buildBriefs(fixture, s, 'Evening.').sheets['tobin']!.split('\n').find((l) => l.includes('tobin.after-closing'))
    expect(line(scene)).toMatch(/Already known to Mara\.$/)
    // Once the player knows it too, everyone here does: it costs no cue.
    expect(line({ ...scene, facts: { tobin: ['Tobin let someone into the yard after closing.'] } })).toBeUndefined()
  })
})

describe('dormant secrets (acceptance 9)', () => {
  // A variant where Mara holds two secrets and the sheet shows one.
  const two: Pack = {
    ...fixture,
    ruleset: { ...fixture.ruleset, codex: { ...fixture.ruleset.codex, activeSecrets: 1 } },
    characters: fixture.characters.map((c) => (c.id === 'mara' ? { ...c, secrets: [...c.secrets, { id: 'dockmaster', text: 'Mara owes the dockmaster a favor.', tell: 'Changes the subject', keywords: ['dockmaster'] }] } : c))
  }
  const sheet = (s: GameState, input = 'Evening.') => buildBriefs(two, s, input, turnLore(two, s, input)).sheets['mara']!
  const shownIds = (s: GameState, input?: string) => [...sheet(s, input).matchAll(/Secret \[(mara\.[a-z-]+)\]/g)].map((m) => m[1])

  it('shows the most recently active, keeps the rest off across scenes and reloads, and brings one back on its keyword', () => {
    const start = startScene(two, { ...yardScene(), scene: null }, 'the-yard', ['mara', 'tobin'])
    // Nothing active yet: the card's order.
    expect(shownIds(start)).toEqual(['mara.two-books'])
    // The dockmaster comes up: it is back, and that is saved.
    expect(shownIds(start, 'Do you know the dockmaster?')).toEqual(['mara.dockmaster'])
    const lore = turnLore(two, start, 'Do you know the dockmaster?')
    const p = validatePlan(two, start, parsePlan(JSON.stringify({ speakers: [{ id: 'mara', goal: 'x' }], moves: [{ who: 'mara', answers: 'player', move: 'answer' }] }))!, 'x', lore).plan
    const after = applyTurn(two, start, { id: 't1', input: 'Do you know the dockmaster?', plan: p, beats: [], tags: parseReply('', []).tags, dice: 1, secrets: lore.secrets.filter((x) => x.priority).map((x) => ({ id: x.id, how: x.priority! })) })
    expect(after.secretActivity['mara.dockmaster']).toEqual({ at: start.time, how: 'keyword' })
    const reloaded = GameStateSchema.parse(JSON.parse(JSON.stringify({ ...after, scene: null })))
    const later = startScene(two, { ...reloaded, time: reloaded.time + 60 }, 'the-yard', ['mara', 'tobin'])
    expect(shownIds(later)).toEqual(['mara.dockmaster'])
    expect(turnLore(two, later, 'Evening.').secrets.find((x) => x.id === 'mara.two-books')).toMatchObject({ form: 'off', off: 'dormant' })
  })

  it('keeps a pinned secret on the sheet, counting toward the limit', () => {
    const pinned: Pack = { ...two, characters: two.characters.map((c) => (c.id === 'mara' ? { ...c, secrets: c.secrets.map((s) => (s.id === 'dockmaster' ? { ...s, pinned: true } : s)) } : c)) }
    const s = startScene(pinned, { ...yardScene(), scene: null }, 'the-yard', ['mara', 'tobin'])
    expect([...buildBriefs(pinned, s, 'Evening.', turnLore(pinned, s, 'Evening.')).sheets['mara']!.matchAll(/Secret \[(mara\.[a-z-]+)\]/g)].map((m) => m[1])).toEqual(['mara.dockmaster'])
  })
})
