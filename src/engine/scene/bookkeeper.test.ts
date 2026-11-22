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
  facts: [],
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
    expect(p.user).toContain(`[${TOBIN}] Tobin's secret: ${tobinText.replace(/\.$/, '')}. In full: ${tobinText}`)
    // A linked secret is named by its codex title: what is hidden, apart from the background in full.
    expect(p.user).toMatch(/\[mara\.two-books\] Mara's secret: [a-z][^.]*\. In full: /)
    expect(p.system).toContain('Only the hidden part counts')
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

  it('talk around a secret (a denial, a question, a dodge) is kept and teaches no one, whoever says it', () => {
    // The bench run of 2026-11-19: with no kind for a denial, a holder's "it's not that" was read as stating it.
    const denial = check(yardScene(), [say('tobin', 'Nobody came by after closing. Not a soul.')], [{ how: 'around', words: 'Nobody came by after closing' }])
    expect(denial.out).toEqual([])
    expect(denial.unresolved).toEqual([])
    expect(denial.around).toEqual([{ secret: TOBIN, by: 'tobin', at: 1, words: 'Nobody came by after closing' }])
    const asked = check(yardScene(), [say('mara', 'Did you let someone in, Tobin?')], [{ how: 'around', words: 'Did you let someone in' }])
    expect(asked.leaks).toEqual([])
    expect(asked.guesses).toEqual([])
    expect(asked.around.map((a) => a.by)).toEqual(['mara'])
  })

  it('a denial can’t come back as a settled detail', () => {
    const r = check(yardScene(), [say('tobin', 'Nobody came by after closing.')], [{ how: 'around', words: 'Nobody came by after closing' }], {}, { new: [{ text: 'nobody came by after closing', at: 1 }] })
    expect(r.new).toEqual([])
    expect(r.refused.join(' | ')).toMatch(/claim or a guess/)
  })

  it('nobody guesses what they know: a holder’s dodge or a knower’s guess is turned down, not counted', () => {
    const dodge = check(yardScene(), [say('tobin', 'Who knows who comes by after closing?')], [{ how: 'guess', words: 'Who knows who comes by after closing' }])
    expect(dodge.guesses).toEqual([])
    expect(dodge.refused).toEqual([`${TOBIN} at line 1: a guess by tobin, who knows it`])
    const coy = check(maraLearned(yardScene()), [say('mara', 'Maybe somebody let someone in.')], [{ how: 'guess', words: 'Maybe somebody let someone in' }])
    expect(coy.guesses).toEqual([])
    expect(coy.refused).toEqual([`${TOBIN} at line 1: a guess by mara, who knows it`])
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

  it('turns down what it can’t check: an unlisted secret, a line that isn’t there, a way it came up that isn’t one, words in no line', () => {
    const beats = [say('tobin', 'I did.')]
    const r = check(yardScene(), beats, [{ id: 'tobin.nothing' }, { at: 4, words: 'I did' }, { at: 1, how: 'shouted', words: 'I did' }, { at: 1, words: 'I let her in' }])
    expect(r.out).toEqual([])
    expect(r.refused).toHaveLength(4)
  })

  it('takes words from the one line they are in, and leaves out an answer that isn’t before it, keeping the observation', () => {
    const input = 'Did you let her in? Tobin let someone in after closing.'
    const knowing = { ...yardScene(), facts: { tobin: [tobinText] } }
    const moved = check(knowing, [say('mara', 'Well?')], [{ at: 1, words: 'Tobin let someone in after closing', answers: 'player' }], { input })
    expect(moved.out).toMatchObject([{ by: 'player', at: 'player' }])
    expect(moved.refused.join(' | ')).toMatch(/is in the player's words, not line 1; taken from there.*isn't before it; left out/)
    const r = check(yardScene(), [say('tobin', 'I did.')], [{ at: 1, words: 'I did', answers: 1 }])
    expect(r.out).toMatchObject([{ by: 'tobin', at: 1 }])
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
    const rolled = { id: 'c1', who: 'player', skill: 'insight', stakes: 'spot the lie', line: 'Ada — Insight 9 vs 12: failure', result: { degree: 'failure' } } as unknown as PlannedCheck
    const r = check(yardScene(), beats, [], { plan: plan({ checks: [rolled] }) }, {
      changed: 'Mara suspects Tobin.',
      moods: [{ id: 'mara', shade: 'sore', family: 'mad', intensity: 3 }, { id: 'mara', shade: 'sore', intensity: 3 }, { id: 'ghost', shade: 'glum', intensity: 1 }],
      checks: [{ id: 'c1', shown: 'happens', at: 1, words: 'at the east gate' }, { id: 'c9', shown: 'happens' }, { id: 'c1', shown: 'maybe' }]
    })
    expect(r.changed).toBe('Mara suspects Tobin.')
    expect(r.moods).toEqual([{ id: 'mara', feeling: { shade: 'sore', family: 'mad', intensity: 3 } }])
    expect(r.checks).toEqual([{ id: 'c1', honored: false, shown: 'happens', at: 1, words: 'at the east gate', note: 'rolled failure; in the prose it happens' }])
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

describe('facts the scene writer was offered (Milestone 5 task 4, Q12)', () => {
  const TALLY = { id: 'lore.guild.tallies', text: 'Every tally at the gate is rounded up a crate or two', source: 'lore' as const, unheard: true }
  const scenePlan = (pools: Record<string, (typeof TALLY)[]>) => plan({ scene: { pools } as never })
  const offeredTo = (who: string) => ({ plan: scenePlan({ [who]: [TALLY] }) })

  it('lists them for the bookkeeper on the scene pipeline only', () => {
    const p = buildBookkeeperPrompt(fixture, yardScene(), turn([say('mara', 'Every tally is rounded.')], offeredTo('mara')))
    expect(p.user).toContain('Facts the writer could use:\n- [lore.guild.tallies] Every tally at the gate is rounded up a crate or two')
    expect(p.system).toContain('- facts: each fact from the list below that a line said as true')
    const situation = buildBookkeeperPrompt(fixture, yardScene(), turn([say('mara', 'Every tally is rounded.')]))
    expect(situation.user).not.toContain('Facts the writer could use')
    expect(situation.system).not.toContain('"facts"')
  })

  it('records a fact a line stated, by someone it was offered to, and turns down what it can’t check', () => {
    const beats = [say('mara', 'Every tally at the gate gets rounded up.'), narrate('Tobin shrugs.'), say('tobin', 'Not by me.')]
    const facts = [
      { id: TALLY.id, at: 1, words: 'Every tally at the gate' },
      { id: 'lore.nothing', at: 1, words: 'Every tally' },
      { id: TALLY.id, at: 3, words: 'rounded up' }
    ]
    const records = check(yardScene(), beats, [], offeredTo('mara'), { facts })
    expect(records.said).toEqual([{ fact: TALLY.id, text: TALLY.text, by: 'mara', words: 'Every tally at the gate' }])
    expect(records.refused).toEqual(['fact lore.nothing: not on the list', 'fact lore.guild.tallies: "rounded up" isn\'t in line 3'])
    // Said aloud by someone it wasn't offered to, who doesn't know it: still heard, marked as not theirs to know.
    const tobin = check(yardScene(), [say('tobin', 'Every tally at the gate gets rounded up.')], [], offeredTo('mara'), { facts: [{ id: TALLY.id, at: 1, words: 'Every tally' }] })
    expect(tobin.said).toEqual([{ fact: TALLY.id, text: TALLY.text, by: 'tobin', words: 'Every tally', unowned: true }])
    expect(tobin.refused).toEqual([])
  })

  it('when the call fails, takes a fact a line by someone it was offered to repeats in its own words', () => {
    const said = planBookkeeping(fixture, yardScene(), turn([say('mara', 'Every tally at the gate is rounded up, Kit.')], offeredTo('mara')))
    expect(said.said).toEqual([{ fact: TALLY.id, text: TALLY.text, by: 'mara', words: '' }])
    expect(planBookkeeping(fixture, yardScene(), turn([say('mara', 'The tallies are fine.')], offeredTo('mara'))).said).toEqual([])
  })
})

describe('checks: what the prose shows, against the roll (task 4)', () => {
  const beats = [say('mara', 'You were here after closing, Tobin.'), narrate('Mara watches him and learns nothing.')]
  const rolledAs = (degree: string) => ({ id: 'c1', who: 'mara', skill: 'insight', target: 'tobin', stakes: 'Mara sees he is lying', line: `Mara — Insight: ${degree}`, result: { degree } }) as unknown as PlannedCheck
  const checked = (degree: string, c: Record<string, unknown>) => check(yardScene(), beats, [], { plan: plan({ checks: [rolledAs(degree)] }) }, { checks: [{ id: 'c1', ...c }] })

  it('asks what the attempt shows, without its result', () => {
    const p = buildBookkeeperPrompt(fixture, yardScene(), turn(beats, { plan: plan({ checks: [rolledAs('failure')] }) }))
    expect(p.user).toContain('- [c1] Mara tries insight on Tobin. If it works: Mara sees he is lying')
    expect(p.system).toContain('Judge that person\'s attempt only: someone else\'s dodge landing is the attempt failing.')
    expect(p.user).not.toContain('failure')
  })

  it('a failure that doesn’t happen in the prose is kept; one that happens isn’t', () => {
    expect(checked('failure', { shown: "doesn't happen", at: 2, words: 'learns nothing' }).checks).toEqual([{ id: 'c1', honored: true, shown: "doesn't happen", at: 2, words: 'learns nothing' }])
    expect(checked('failure', { shown: 'happens', at: 2, words: 'Mara watches him' }).checks[0]).toMatchObject({ honored: false, note: 'rolled failure; in the prose it happens' })
    expect(checked('cost', { shown: 'at a cost', at: 2, words: 'Mara watches him' }).checks[0]).toMatchObject({ honored: true })
  })

  it('unclear records no verdict; a quote that isn’t in the line records nothing', () => {
    expect(checked('success', { shown: 'unclear' }).checks).toEqual([{ id: 'c1', shown: 'unclear' }])
    const r = checked('success', { shown: 'happens', at: 1, words: 'she sees it' })
    expect(r.checks).toEqual([])
    expect(r.refused).toEqual(['check c1: "she sees it" isn\'t in line 1'])
  })
})

describe('part of a secret (Q11)', () => {
  it('is kept and shown, teaches no one, and can’t come back as a settled detail', () => {
    const beats = [say('mara', 'Someone was let in after closing, that much I know.')]
    const r = check(yardScene(), beats, [{ at: 1, how: 'partial', words: 'Someone was let in after closing' }], {}, { new: [{ text: 'Someone was let in after closing', at: 1 }] })
    expect(r.partial).toEqual([{ secret: TOBIN, by: 'mara', at: 1, words: 'Someone was let in after closing' }])
    expect(r.out).toEqual([])
    expect(r.leaks).toEqual([])
    expect(r.new).toEqual([])
    const p = buildBookkeeperPrompt(fixture, yardScene(), turn(beats))
    expect(p.system).toContain('- "partial": part of the hidden part said as true and known, but not all of it')
  })
})
