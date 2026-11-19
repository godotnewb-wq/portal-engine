import { describe, expect, it } from 'vitest'
import { MemorySchema, type Beat, type GameState } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { bookkeep, buildBookkeeperPrompt, checkBookkeeping, parseBookkeeping, planBookkeeping, secretCandidates, type WrittenBookkeeping, type WrittenSecret } from './bookkeeper'
import type { BeatPlan, Move, PlannedCheck } from './planShape'

// The bookkeeper (milestone 4c task 1; milestone-4 plan Part 4c, decisions J–L): the model judges how a secret came up,
// the game decides who could say it and whether anyone learns it.

const TOBIN = 'tobin.after-closing'
const plan = (over: Partial<BeatPlan> = {}): BeatPlan => ({ speakers: [], exchange: [], reactions: [], checks: [], walk_ons: [], texture: [], avoid: [], leaves: [], end_scene: false, ...over })
const say = (speaker: string, text: string): Beat => ({ kind: 'dialogue', speaker, text })
const narrate = (text: string): Beat => ({ kind: 'narration', text })
const turn = (beats: Beat[], over: { input?: string; plan?: BeatPlan } = {}) => ({ id: 't1', input: over.input ?? 'What happened last night?', beats, plan: over.plan ?? plan() })
const reply = (secrets: Partial<WrittenSecret>[], more: Partial<WrittenBookkeeping> = {}): WrittenBookkeeping => ({
  secrets: secrets.map((s) => ({ id: TOBIN, at: 1, how: 'stated', words: '', ...s })),
  new: [],
  changed: '',
  moods: [],
  checks: [],
  ...more
})
const check = (state: GameState, beats: Beat[], secrets: Partial<WrittenSecret>[], over: Parameters<typeof turn>[1] = {}, more: Partial<WrittenBookkeeping> = {}) =>
  checkBookkeeping(fixture, state, turn(beats, over), reply(secrets, more))
/** Mara remembers learning Tobin's secret in an earlier scene. */
const maraLearned = (state: GameState): GameState => ({
  ...state,
  memories: [MemorySchema.parse({ id: 'mara.m1', owner: 'mara', text: 'Tobin let someone in after closing.', level: 'normal', at: 0, fadeFrom: 0, secret: TOBIN })]
})
const tobinText = fixture.characters.find((c) => c.id === 'tobin')!.secrets[0]!.text

describe('what the bookkeeper is shown', () => {
  it('watches every secret held here, learned here, or known to the player, whatever was said', () => {
    expect(secretCandidates(fixture, yardScene()).map((c) => c.id).sort()).toEqual(['mara.two-books', TOBIN])
    // Tobin gone: the player still knows his secret, so it is still watched.
    const gone = yardScene()
    const away: GameState = { ...gone, facts: { tobin: [tobinText] }, scene: { ...gone.scene!, departed: ['tobin'] } }
    expect(secretCandidates(fixture, away).map((c) => c.id)).toContain(TOBIN)
  })

  it('numbers the lines, lists the secrets and checks, and takes the new-detail limit from the ruleset', () => {
    const p = buildBookkeeperPrompt(fixture, yardScene(), turn([say('tobin', 'Nothing happened.'), narrate('Mara looks away.')]))
    expect(p.user).toContain(`[${TOBIN}] Tobin's: ${tobinText}`)
    expect(p.user).toContain('1. Tobin: "Nothing happened."')
    expect(p.user).toContain('2. (narration) Mara looks away.')
    expect(p.user).toContain('(player): What happened last night?')
    expect(p.system).toContain(`At most ${fixture.ruleset.bookkeeper.newDetails}`)
    expect(p.user).not.toContain('Earlier:')
  })
})

describe('reading the reply', () => {
  it('reads a JSON object, thinking and all, and nothing else', () => {
    const r = parseBookkeeping('<think>hm</think>{"secrets":[{"id":"tobin.after-closing","at":"2","how":"Guess","words":"x"}],"changed":"He admits it."}')
    expect(r?.secrets[0]).toMatchObject({ id: TOBIN, at: '2', how: 'guess', words: 'x' })
    expect(r?.changed).toBe('He admits it.')
    expect(parseBookkeeping('no')).toBeUndefined()
  })
})

describe('when a secret comes out (J, K)', () => {
  it('a guess, even a right one, teaches no one', () => {
    const r = check(yardScene(), [say('mara', 'I bet Tobin let someone in after closing.')], [{ how: 'guess', words: 'Tobin let someone in after closing' }])
    expect(r.out).toEqual([])
    expect(r.leaks).toEqual([])
    expect(r.guesses).toMatchObject([{ secret: TOBIN, by: 'mara', at: 1 }])
  })

  it('said as known by someone who couldn’t know it is a leak: their claim, teaching no one', () => {
    const r = check(yardScene(), [say('mara', 'Tobin let someone in after closing. Everyone knows it.')], [{ words: 'Tobin let someone in after closing' }])
    expect(r.out).toEqual([])
    expect(r.leaks).toMatchObject([{ secret: TOBIN, by: 'mara', why: "mara couldn't know it" }])
  })

  it('the holder confirming it, not keeping it, brings it out in front of everyone present but them', () => {
    const r = check(yardScene(), [say('tobin', 'Yes. I let her in.')], [{ words: 'Yes. I let her in', answers: 'player' }], { input: 'Did you let someone in after closing?' })
    expect(r.out).toEqual([{ secret: TOBIN, by: 'tobin', at: 1, words: 'Yes. I let her in', how: 'confirmed', to: ['mara'] }])
  })

  it('a holder saying the secret they were keeping that turn is left for review, not taken as a confirmation', () => {
    const keeping = plan({ speakers: [{ id: 'tobin', intent: '', kept: [TOBIN] }] })
    const r = check(yardScene(), [say('tobin', 'Fine, I let someone in.')], [{ words: 'I let someone in' }], { plan: keeping })
    expect(r.out).toEqual([])
    expect(r.unresolved).toMatchObject([{ secret: TOBIN, why: 'tobin said it while keeping it' }])
  })

  it('someone who learned it before can tell it', () => {
    const r = check(maraLearned(yardScene()), [say('mara', 'He let someone in after closing.')], [{ words: 'He let someone in after closing' }])
    expect(r.out).toMatchObject([{ by: 'mara', how: 'confirmed' }])
    expect(r.leaks).toEqual([])
  })

  it('the player tells what they know; said by a player who doesn’t know it, it is a guess', () => {
    const input = 'Tobin let someone in after closing.'
    const knowing = { ...yardScene(), facts: { tobin: [tobinText] } }
    expect(check(knowing, [], [{ at: 'player', words: input }], { input }).out).toMatchObject([{ by: 'player', at: 'player', to: ['mara'] }])
    const guessing = check(yardScene(), [], [{ at: 'player', words: input }], { input })
    expect(guessing.out).toEqual([])
    expect(guessing.leaks).toEqual([])
    expect(guessing.guesses).toMatchObject([{ by: 'player', why: "the player didn't know it" }])
  })

  it('evidence the prose shows brings it out, whoever is holding it', () => {
    const r = check(yardScene(), [narrate('The gate book falls open at a name signed in after closing.')], [{ how: 'evidence', words: 'a name signed in after closing' }])
    expect(r.out).toMatchObject([{ by: 'narration', how: 'discovered', to: ['mara'] }])
  })

  it('narration that says a hidden fact without showing it is a leak', () => {
    const r = check(yardScene(), [narrate('Tobin, of course, had let someone in after closing.')], [{ words: 'had let someone in after closing' }])
    expect(r.leaks).toMatchObject([{ by: 'narration' }])
  })

  it('goes in order: an earlier leak stays a leak, and a confirmation lets a later speaker say it', () => {
    const beats = [say('mara', 'You let someone in after closing.'), say('tobin', 'I did.'), say('mara', 'So you let her in.')]
    const r = check(yardScene(), beats, [
      { at: 3, words: 'So you let her in' },
      { at: 1, words: 'You let someone in after closing' },
      { at: 2, words: 'I did', answers: 1 }
    ])
    expect(r.leaks).toMatchObject([{ at: 1, by: 'mara' }])
    expect(r.out).toMatchObject([{ at: 2, by: 'tobin' }])
    expect(r.out).toHaveLength(1)
  })

  it('a unclear case is left for review and teaches no one', () => {
    const r = check(yardScene(), [say('tobin', 'Maybe.')], [{ how: 'unclear', words: 'Maybe' }])
    expect(r.out).toEqual([])
    expect(r.unresolved).toMatchObject([{ why: "the bookkeeper couldn't tell" }])
  })

  it('turns down what it can’t check: an unlisted secret, a line that isn’t there, words not in the line, an answer that comes after', () => {
    const beats = [say('tobin', 'I did.')]
    const r = check(yardScene(), beats, [
      { id: 'tobin.nothing' },
      { at: 4, words: 'I did' },
      { at: 1, how: 'shouted', words: 'I did' },
      { at: 1, words: 'I let her in' },
      { at: 1, words: 'I did', answers: 1 }
    ])
    expect(r.out).toEqual([])
    expect(r.refused).toHaveLength(5)
    // Punctuation, case and ellipses don't decide a match.
    expect(check(yardScene(), [say('tobin', 'Yes — I did, all right? I let her in.')], [{ words: 'yes i did ... i let her in' }]).out).toHaveLength(1)
  })
})

describe('the other records', () => {
  const beats = [say('tobin', 'Three pennies, at the east gate, by the bell.'), say('mara', 'I bet he let someone in after closing.')]

  it('keeps new details within the ruleset’s limit, never a guess about a secret, never one already said', () => {
    const state = yardScene()
    const said: GameState = { ...state, scene: { ...state.scene!, newFacts: [{ id: 'said.1', text: 'by the bell', by: 'tobin' }] } }
    const r = check(said, beats, [{ at: 2, how: 'guess', words: 'he let someone in after closing' }], {}, {
      new: [
        { text: 'three pennies', at: 1 },
        { text: 'by the bell', at: 1 },
        { text: 'let someone in after closing', at: 2 },
        { text: 'at the east gate', at: 1 },
        { text: 'a third detail', at: 1 },
        { text: 'nowhere', at: 9 }
      ]
    })
    expect(r.new).toEqual([
      { text: 'three pennies', by: 'tobin' },
      { text: 'at the east gate', by: 'tobin' }
    ])
    expect(r.refused.join(' | ')).toMatch(/claim or a guess.*over the limit of 2.*no such line/)
  })

  it('keeps moods in the ruleset’s shades for people present, and checks for this turn’s checks, for the logs only', () => {
    const rolled = { id: 'c1', who: 'player', stakes: 'spot the lie', line: 'Ada — Insight 9 vs 12: failure' } as unknown as PlannedCheck
    const r = check(yardScene(), beats, [], { plan: plan({ checks: [rolled] }) }, {
      changed: 'Mara suspects Tobin.',
      moods: [{ id: 'mara', shade: 'sore', family: 'mad', intensity: 3 }, { id: 'mara', shade: 'sore', intensity: 3 }, { id: 'ghost', shade: 'glum', intensity: 1 }],
      checks: [{ id: 'c1', honored: false, note: 'played as a success' }, { id: 'c9', honored: true }, { id: 'c1', honored: 'yes' }]
    })
    expect(r.changed).toBe('Mara suspects Tobin.')
    expect(r.moods).toEqual([{ id: 'mara', feeling: { shade: 'sore', family: 'mad', intensity: 3 } }])
    expect(r.checks).toEqual([{ id: 'c1', honored: false, note: 'played as a success' }])
    expect(r.refused).toHaveLength(4)
  })
})

describe('when the call fails (decision L, change 1)', () => {
  const moving = (who: string, move: string, id = TOBIN): Move => ({ who, answers: 'player', move, says: [{ id, text: tobinText, unheard: true }] })

  it('keeps only a holder’s voiced reveal or concede, not kept, and marks the turn unaudited', () => {
    const records = (m: Move, beats: Beat[], over: Partial<BeatPlan> = {}) => planBookkeeping(fixture, yardScene(), turn(beats, { plan: plan({ moves: [m], ...over }) }))
    const line = [say('tobin', 'All right, I let someone in after closing.')]
    expect(records(moving('tobin', 'concede'), line)).toMatchObject({ source: 'plan', unaudited: true, out: [{ secret: TOBIN, by: 'tobin', at: 1, to: ['mara'] }] })
    expect(records(moving('tobin', 'reveal'), []).out).toEqual([])
    expect(records(moving('tobin', 'answer'), line).out).toEqual([])
    expect(records(moving('tobin', 'concede'), line, { speakers: [{ id: 'tobin', intent: '', kept: [TOBIN] }] }).out).toEqual([])
    expect(records(moving('mara', 'reveal'), [say('mara', 'He let someone in.')]).out).toEqual([])
  })

  it('takes the plan’s new details, as before', () => {
    const m: Move = { who: 'tobin', answers: 'player', move: 'answer', says: [{ text: 'three pennies', unheard: true }] }
    expect(planBookkeeping(fixture, yardScene(), turn([say('tobin', 'Three.')], { plan: plan({ moves: [m] }) })).new).toEqual([{ text: 'three pennies', by: 'tobin' }])
  })

  it('falls back on a failed or unreadable call, and records the call either way', async () => {
    const written = turn([say('tobin', 'I did.')])
    const failed = await bookkeep(fixture, yardScene(), written, async () => {
      throw new Error('timeout')
    })
    expect(failed.records).toMatchObject({ source: 'plan', unaudited: true })
    expect(failed.trace).toMatchObject({ turnId: 't1', error: 'timeout', calls: [{ role: 'bookkeeper', error: 'timeout' }] })
    const garbled = await bookkeep(fixture, yardScene(), written, async () => 'sorry')
    expect(garbled.trace.error).toBe('the reply was not a JSON object')
    const good = await bookkeep(fixture, yardScene(), written, async () => JSON.stringify({ secrets: [{ id: TOBIN, at: 1, how: 'stated', words: 'I did', answers: 'player' }] }))
    expect(good.records).toMatchObject({ source: 'bookkeeper', out: [{ secret: TOBIN }] })
    expect(good.trace.error).toBeUndefined()
    expect(good.trace.calls[0]).toMatchObject({ id: 't1:bookkeeper', role: 'bookkeeper', turnId: 't1' })
  })
})
