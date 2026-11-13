import { describe, expect, it } from 'vitest'
import type { Pack } from '@engine/pack'
import type { GameState, Turn } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { carryDetails, contentWords, selectDetails } from './brief'
import { buildBriefs, buildDirectorPrompt } from './director'
import { parsePlan, validatePlan } from './plan'
import { buildWriterPrompt, speakerTies } from './writer'
import type { BeatPlan } from './planShape'

// Director briefs (director writer §7, milestone 4a task 7): what every character present carries always, and what
// optional detail is chosen, by rule, for this turn.

const withBriefs = (over: Partial<Pack['ruleset']['briefs']>): Pack => ({ ...fixture, ruleset: { ...fixture.ruleset, briefs: { ...fixture.ruleset.briefs, ...over } } })
const turn = (over: Partial<Turn> = {}): Turn => ({ id: 't1', player: 'Evening.', beats: [], checks: [], speakers: [], texture: [], ...over })
const withTurns = (state: GameState, ...turns: Turn[]): GameState => ({ ...state, scene: { ...state.scene!, turns } })
const ids = (state: GameState, input: string, content: Pack = fixture) => selectDetails(content, state, input).details.map((d) => d.id)

describe('the always-on brief', () => {
  it('names who they are, a cue, their nature and what they care about, and keeps optional detail out', () => {
    const { sheets } = buildBriefs(fixture, yardScene(), 'Evening.')
    const mara = sheets.mara!
    expect(mara).toContain('Who: ')
    expect(mara).toContain('Cue: ')
    expect(mara).toMatch(/Nature: .+/)
    expect(mara).toMatch(/Cares about: a ledger that balances/)
    expect(mara).toContain('Tonight: Find out who keeps skimming the tallies')
    // Nothing touches the yard, the guild or Tobin: no knowledge, goals or contradictions this turn.
    expect(mara).not.toContain('[mara.k1]')
    expect(mara).not.toContain("Become the Guild's chief clerk")
    expect(mara).not.toContain('Relevant now')
  })

  it('still shows every held secret, as a cue or in full', () => {
    const { sheets } = buildBriefs(fixture, yardScene(), 'Evening.')
    expect(sheets.mara).toMatch(/Secret \[mara\.two-books\]/)
    expect(sheets.tobin).toMatch(/Secret \[tobin\.after-closing\]/)
  })

  it('shows tags and meter bands toward the others here, and what the player is to them', () => {
    const { sheets } = buildBriefs(fixture, yardScene(), 'Evening.')
    expect(sheets.mara).toMatch(/Toward others here: Tobin: rival · /)
    expect(sheets.tobin).toMatch(/Toward the player: .* · employer: took him on for the night shift last month/)
  })

  it('gives a Major Character the close-ties line for people not here, leaving out private tags; never a Recurring one', () => {
    const alone = (state: GameState): GameState => ({ ...state, scene: { ...state.scene!, cast: ['mara'] } })
    expect(buildBriefs(fixture, alone(yardScene()), 'Evening.').sheets.mara).toContain('Close ties, not here: rival: Tobin')
    const hidden = yardScene()
    hidden.relations = hidden.relations.map((r) => ({ ...r, tags: r.tags.map((t) => ({ ...t, private: true })) }))
    expect(buildBriefs(fixture, alone(hidden), 'Evening.').sheets.mara).not.toContain('Close ties')
    expect(buildBriefs(fixture, yardScene(), 'Evening.').sheets.tobin).not.toContain('Close ties')
  })

  it('shows the director a private tag between people here, marked as private', () => {
    const hidden = yardScene()
    hidden.relations = hidden.relations.map((r) => ({ ...r, tags: r.tags.map((t) => ({ ...t, private: true })) }))
    expect(buildBriefs(fixture, hidden, 'Evening.').sheets.mara).toMatch(/Tobin: rival \(private\) · /)
  })

  it('records each character’s always-on cost in the trace', () => {
    const { trace } = buildBriefs(fixture, yardScene(), 'Evening.')
    expect(Object.keys(trace.recurring).sort()).toEqual(['mara', 'tobin'])
    expect(trace.recurring.mara).toBeGreaterThan(0)
  })
})

describe('choosing optional detail', () => {
  it('a question about one character brings in what another knows about them, even while that one is quiet', () => {
    const chosen = selectDetails(fixture, yardScene(), 'Tobin, where were you last night?').details
    expect(chosen.find((d) => d.id === 'mara.k1')).toMatchObject({ owner: 'mara', rank: 'answer', trigger: expect.stringContaining('named: Tobin') })
  })

  it('the player’s own words qualify a detail; a direct question outranks a passing mention', () => {
    const chosen = selectDetails(fixture, yardScene(), 'Who was in the yard after closing?').details
    expect(chosen[0]).toMatchObject({ id: 'mara.k1', rank: 'answer' })
  })

  it('brings in a history note when the pair both spoke last turn', () => {
    const state = withTurns(yardScene(), turn({ speakers: ['mara', 'tobin'] }))
    expect(selectDetails(fixture, state, 'Go on.').details.find((d) => d.id === 'note.mara.tobin')).toMatchObject({ rank: 'choice' })
  })

  it('a motive comes in when its holder is addressed', () => {
    expect(ids(yardScene(), 'Mara, a word.')).toContain('mara.motive1')
    expect(ids(yardScene(), 'A word, anyone.')).not.toContain('mara.motive1')
  })

  it('fits the shared budget, ranking first, and records what it cut', () => {
    const tight = withBriefs({ detailTokens: 12 })
    const { details, trace } = selectDetails(tight, yardScene(), 'Tobin, were you in the yard after closing?')
    expect(trace.used).toBeLessThanOrEqual(12)
    expect(details.map((d) => d.id)).toEqual(['mara.k1'])
    expect(trace.cut.map((c) => c.why)).toContain('budget')
    expect(trace.budget).toBe(12)
  })

  it('caps ties to people who aren’t here', () => {
    const alone: GameState = { ...yardScene(), scene: { ...yardScene().scene!, cast: ['mara'] } }
    expect(ids(alone, 'Is Tobin about?')).toContain('tie.mara.tobin')
    const capped = selectDetails(withBriefs({ absentPerCharacter: 0 }), alone, 'Is Tobin about?')
    expect(capped.details.map((d) => d.id)).not.toContain('tie.mara.tobin')
    expect(capped.trace.cut).toContainEqual(expect.objectContaining({ id: 'tie.mara.tobin', why: 'absent cap' }))
  })

  it('a tag word counts only when it belongs to someone: "your rival", not "a rival"', () => {
    const alone: GameState = { ...yardScene(), scene: { ...yardScene().scene!, cast: ['mara'] } }
    expect(selectDetails(fixture, alone, 'How is your rival these days?').details.find((d) => d.id === 'tie.mara.tobin')?.trigger).toContain('said: rival')
    expect(ids(alone, 'Everyone needs a rival.')).not.toContain('tie.mara.tobin')
  })

  it('caps ties to people who aren’t here across the whole scene, too', () => {
    const alone: GameState = { ...yardScene(), scene: { ...yardScene().scene!, cast: ['mara'] } }
    const capped = selectDetails(withBriefs({ absentPerScene: 0 }), alone, 'Is Tobin about?')
    expect(capped.trace.cut).toContainEqual(expect.objectContaining({ id: 'tie.mara.tobin', why: 'absent cap' }))
  })

  it('brings in someone not here when the place is one of their haunts, as texture', () => {
    // Tobin, alone in the yard, with a tie to Mara, whose card puts her at the yard's tally desk.
    const state = yardScene()
    const alone: GameState = {
      ...state,
      relations: [...state.relations, { from: 'tobin', to: 'mara', tags: [{ tag: 'foe' }], note: 'she counts his tallies twice', meters: { warmth: 0, bond: 0 } }],
      scene: { ...state.scene!, cast: ['tobin'] }
    }
    expect(selectDetails(fixture, alone, 'Evening.').details.find((d) => d.id === 'tie.tobin.mara')).toMatchObject({ rank: 'texture', trigger: 'a haunt of theirs' })
  })

  it('brings in someone not here who was named last turn', () => {
    const alone: GameState = withTurns({ ...yardScene(), scene: { ...yardScene().scene!, cast: ['mara'] } }, turn({ player: 'Seen Tobin?', speakers: ['mara'] }))
    expect(selectDetails(fixture, alone, 'Go on.').details.find((d) => d.id === 'tie.mara.tobin')).toMatchObject({ rank: 'choice', trigger: 'named last turn: Tobin' })
  })

  it('needs no model call and gives the same answer twice', () => {
    expect(ids(yardScene(), 'Tobin, where were you?')).toEqual(ids(yardScene(), 'Tobin, where were you?'))
  })
})

describe('carrying detail from one turn to the next', () => {
  const asked = selectDetails(fixture, yardScene(), 'Who was in the yard after closing?').details
  const plan = (move: string, uses: string[] = []): BeatPlan =>
    ({ speakers: [], exchange: [], reactions: [], checks: [], walk_ons: [], texture: [], avoid: [], leaves: [], end_scene: false, moves: [{ who: 'mara', answers: 'player', move, says: uses.map((id) => ({ id, text: '', unheard: true })) }] }) as BeatPlan

  it('carries what a move used, and what answered the player when the exchange ends on something open', () => {
    expect(carryDetails(asked, plan('answer', ['mara.k1']))).toContain('mara.k1')
    expect(carryDetails(asked, plan('dodge'))).toContain('mara.k1')
    // Having been in the prompt isn't enough.
    expect(carryDetails(asked, plan('answer'))).toEqual([])
  })

  const after = withTurns(yardScene(), turn({ player: 'Who was in the yard after closing?', beats: [{ kind: 'dialogue', speaker: 'mara', text: 'Ask him.' }], speakers: ['mara'], details: ['mara.k1'] }))

  it('keeps it for a short follow-up', () => {
    expect(selectDetails(fixture, after, 'Why?').details.find((d) => d.id === 'mara.k1')).toMatchObject({ trigger: 'carried' })
  })

  it('drops it on a clear change of topic, and says so', () => {
    const changed = selectDetails(fixture, after, 'Nice weather for the season, cold mornings though.')
    expect(changed.details.map((d) => d.id)).not.toContain('mara.k1')
    expect(changed.trace.dropped).toEqual(['mara.k1'])
  })
})

describe('the director prompt', () => {
  it('carries the briefs it was given', () => {
    const state = yardScene()
    const briefs = buildBriefs(fixture, state, 'Tobin, where were you?')
    const prompt = buildDirectorPrompt(fixture, state, 'Tobin, where were you?', undefined, briefs)
    expect(prompt.system).toContain(briefs.sheets.mara!)
    expect(prompt.system).toContain('[mara.k1]')
  })

  it('tells the director a speaker is never a reaction', () => {
    expect(buildDirectorPrompt(fixture, yardScene(), 'Evening.').system).toMatch(/reactions: only the people present who don't speak this turn/)
  })

  it('a fact left out of the brief can still be cited by its owner, and validation still checks ownership', () => {
    const raw = parsePlan(JSON.stringify({ player_action: { doing: 'asks', uncertain: false }, speakers: [{ id: 'tobin', goal: 'answer' }], moves: [{ who: 'tobin', answers: 'player', move: 'answer', uses: ['mara.k1'] }] }))!
    expect(validatePlan(fixture, yardScene(), raw, 'Evening.').corrections).toContainEqual(expect.stringContaining("tobin can't know mara.k1"))
  })
})

describe('the writer prompt', () => {
  const plan = (speakers: string[]): BeatPlan =>
    ({
      speakers: speakers.map((id) => ({ id, intent: 'give the player a way out without saying so', mood: 'guarded' })),
      exchange: [],
      reactions: [],
      checks: [],
      walk_ons: [],
      texture: [],
      avoid: [],
      leaves: [],
      end_scene: false,
      moves: speakers.map((who, i) => ({ who, answers: i === 0 ? 'player' : i, move: 'answer', says: [] }))
    }) as BeatPlan

  it('gets the settled intention, the speakers’ portrayal and their ties in words', () => {
    const prompt = buildWriterPrompt(fixture, yardScene(), plan(['mara', 'tobin']), 'Well?')
    expect(prompt.user).toContain('give the player a way out without saying so')
    expect(prompt.system).toContain(fixture.characters.find((c) => c.id === 'mara')!.portrait)
    expect(prompt.user).toContain('- Mara → Tobin: rival; has known him since the guild took him on')
    expect(prompt.user).toContain('- Tobin → you: employer; took him on for the night shift last month')
  })

  it('gives a silent bystander’s tie without the history note', () => {
    expect(speakerTies(fixture, yardScene(), plan(['mara']))).toEqual(['- Mara → Tobin: rival'])
  })

  it('never gets layer labels, meter bands, the director’s cue lines or a private tag', () => {
    const state = yardScene()
    const hidden: GameState = { ...state, relations: state.relations.map((r) => ({ ...r, tags: r.tags.map((t) => ({ ...t, private: true })) })) }
    const prompt = buildWriterPrompt(fixture, hidden, plan(['mara', 'tobin']), 'Well?')
    const text = `${prompt.system}\n${prompt.user}`
    for (const label of ['Nature:', 'Cares about:', 'Cue:', 'Close ties', 'Relevant now', '(private)', 'rival']) expect(text).not.toContain(label)
    for (const m of fixture.ruleset.meters.list) expect(text).not.toContain(`${m.id}:`)
  })

  it('gets a secret’s text only when a speaker keeps it', () => {
    const text = (p: BeatPlan) => buildWriterPrompt(fixture, yardScene(), p, 'Well?').user
    expect(text(plan(['tobin']))).not.toContain('Tobin let someone into the yard after closing')
    const keeping = plan(['tobin'])
    keeping.speakers[0] = { ...keeping.speakers[0]!, hiding: 'Tobin let someone into the yard after closing.', kept: ['tobin.after-closing'], approach: 'deflect' }
    expect(text(keeping)).toContain('Tobin let someone into the yard after closing')
  })
})

describe('content words', () => {
  it('leaves out short and stop words and names, and roughly stems', () => {
    expect([...contentWords('Tobin was waiting in the yards after closing', new Set(['tobin']))].sort()).toEqual(['clos', 'wait', 'yard'])
  })
})

describe('two characters at the same stages', () => {
  // npc design §13: two characters with the same layers must stay distinguishable. The stages are only a line of the
  // director's brief; the cue, what they care about in their own words, their aims and their voice are the card's own.
  const twin = { ...fixture.characters.find((c) => c.id === 'tobin')!, layers: fixture.characters.find((c) => c.id === 'mara')!.layers }
  const pack: Pack = { ...fixture, characters: fixture.characters.map((c) => (c.id === 'tobin' ? twin : c)) }

  it('get the same nature line and different briefs otherwise', () => {
    const { sheets } = buildBriefs(pack, yardScene(), 'Evening.')
    const line = (id: string, label: string) => sheets[id]!.split('\n').find((l) => l.startsWith(label))
    expect(line('mara', 'Nature:')).toBe(line('tobin', 'Nature:'))
    for (const label of ['Who:', 'Cue:', 'Tonight:', 'Lying tell:']) expect(line('mara', label)).not.toBe(line('tobin', label))
  })

  it('reach the writer through their own portraits and voices, never the stages', () => {
    const plan = { speakers: [{ id: 'mara', intent: 'answer', mood: 'flat' }, { id: 'tobin', intent: 'answer', mood: 'flat' }], exchange: [], reactions: [], checks: [], walk_ons: [], texture: [], avoid: [], leaves: [], end_scene: false } as unknown as BeatPlan
    const system = buildWriterPrompt(pack, yardScene(), plan, 'Well?').system
    const mara = fixture.characters.find((c) => c.id === 'mara')!
    expect(system).toContain(mara.portrait)
    expect(system).toContain(twin.portrait)
    expect(system).toContain(mara.voice.sampleLines[0]!)
    expect(system).toContain(twin.voice.sampleLines[0]!)
    for (const stage of Object.values(mara.layers?.axes ?? {})) expect(system).not.toMatch(new RegExp(`\\b${stage}\\b`))
  })
})
