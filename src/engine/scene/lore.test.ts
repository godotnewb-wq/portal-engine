import { describe, expect, it } from 'vitest'
import { fixture, yardScene } from '@tests/fixture'
import { buildDirectorPrompt } from './director'
import { turnLore } from './lore'
import { LORE_LINE_WORDS, parsePlan, validatePlan } from './plan'
import { buildWriterPrompt } from './writer'

// Lore lines and framing on the situation plan (claude/lore-injection.md §8, option B).
const ASK = 'What do the tallies say about the Guild?'
const raw = (lore: object[], speakers?: object[]) =>
  parsePlan(
    JSON.stringify({
      player_action: { doing: 'asks about the tallies', uncertain: false },
      speakers: speakers ?? [
        { id: 'mara', goal: 'answer', mood: 'guarded', framing: 'proud of the hall, wary of the yard' },
        { id: 'tobin', goal: 'answer', mood: 'tired' }
      ],
      moves: [
        { who: 'mara', answers: 'player', move: 'answer' },
        { who: 'tobin', answers: 1, move: 'push back' }
      ],
      lore,
      reactions: [],
      checks: []
    })
  )!
const validate = (lore: object[], speakers?: object[], budgets = {}) => {
  const state = yardScene()
  return validatePlan(fixture, state, raw(lore, speakers), ASK, turnLore(fixture, state, ASK, budgets))
}

describe('lore lines', () => {
  it('drop a line that gets a name wrong', () => {
    const { plan, corrections } = validate([{ entry: 'faction.guild', line: 'The Night Crew answers to the Guild.' }])
    expect(plan.lore).toBeUndefined()
    expect(corrections).toEqual(['dropped lore line 1: "The Night Crew" isn\'t a name in this world'])
  })

  it('keep a common line for anyone, and an insider line for a speaker who knows it', () => {
    const { plan, corrections } = validate([
      { entry: 'faction.guild', line: 'The Guild owns the yard and sets the cart fees.' },
      { entry: '[faction.guild.tallies]', who: 'Mara', line: 'Every tally is rounded up a crate or two.' }
    ])
    expect(corrections).toEqual([])
    expect(plan.lore).toEqual([
      { entry: 'faction.guild', title: 'The Guild', line: 'The Guild owns the yard and sets the cart fees.' },
      { entry: 'faction.guild.tallies', title: 'How the tallies work', line: 'Every tally is rounded up a crate or two.', who: 'mara' }
    ])
  })

  it('drop an insider line with no speaker who knows it, an entry not given this turn, a secret, and lines past the cap', () => {
    const { plan, corrections } = validate([
      { entry: 'faction.guild.tallies', line: 'Rounded up.' },
      { entry: 'concept.pennies', line: 'A cart fee is three pennies.' },
      { entry: 'faction.guild.second-ledger', line: 'There is a second ledger.' },
      { entry: 'faction.guild', line: 'One.' },
      { entry: 'location.lower', line: 'Two.' },
      { entry: 'location.lower.east-gate', line: 'Three.' },
      { entry: 'location.lower.east-gate.the-yard', line: 'Four.' }
    ])
    expect(plan.lore?.map((l) => l.line)).toEqual(['One.', 'Two.', 'Three.'])
    expect(corrections).toEqual([
      'dropped lore line 1: insider knowledge needs a speaker who knows it',
      'dropped lore line 2: "concept.pennies" wasn\'t given this turn',
      'dropped lore line 3: "faction.guild.second-ledger" wasn\'t given this turn',
      `dropped lore line 7: at most ${fixture.ruleset.codex.loreLines}`
    ])
  })

  it('give way to the entry’s summary when a line runs past the word limit, counted as a correction', () => {
    const long = 'The Guild owns the yard and sets the cart fees, and every porter, carter and clerk who works the gate pays it something each week, whether in coin or in favors owed to the hall, and nobody argues.'
    const { plan, corrections } = validate([{ entry: 'faction.guild', line: long }])
    expect(plan.lore).toEqual([{ entry: 'faction.guild', title: 'The Guild', line: 'Runs the yard and counts every crate.' }])
    expect(corrections).toEqual([`lore line 1 was ${long.split(' ').length} words; the most is ${LORE_LINE_WORDS}, so the entry's summary stands in`])
  })

  it('keep to the lore lines budget the player set, and tell the director nothing about lore lines when it is 0', () => {
    const two = [
      { entry: 'faction.guild', line: 'The Guild owns the yard.' },
      { entry: 'location.lower', line: 'The lower town floods in spring.' }
    ]
    const { plan, corrections } = validate(two, undefined, { loreLines: 1 })
    expect(plan.lore?.map((l) => l.line)).toEqual(['The Guild owns the yard.'])
    expect(corrections).toEqual(['dropped lore line 2: at most 1'])
    const state = yardScene()
    const off = buildDirectorPrompt(fixture, state, ASK, turnLore(fixture, state, ASK, { loreLines: 0 })).system
    expect(off).not.toMatch(/"lore"|lore: at most/)
    const on = buildDirectorPrompt(fixture, state, ASK, turnLore(fixture, state, ASK)).system
    expect(on).toMatch(/lore: at most 3 facts/)
  })

  it('record the budgets in effect, and which the player set', () => {
    const state = yardScene()
    expect(turnLore(fixture, state, ASK).budgets).toEqual({ sceneTokens: 1200, triggeredTokens: 800, loreLines: 3, set: [] })
    const lore = turnLore(fixture, state, ASK, { sceneTokens: 0 })
    expect(lore.budgets).toMatchObject({ sceneTokens: 0, set: ['sceneTokens'] })
    expect(lore.layers.scene.entries).toEqual([])
  })

  it('drop an insider line given to someone who doesn’t know it', () => {
    const tobinOnly = [{ id: 'tobin', goal: 'answer', mood: 'tired' }, { id: 'mara', goal: 'answer', mood: 'guarded' }]
    const ok = validate([{ entry: 'faction.guild.tallies', who: 'tobin', line: 'The porters see it at the gate.' }], tobinOnly)
    expect(ok.plan.lore?.[0]?.who).toBe('tobin')
    const state = yardScene()
    const noPorter = { ...fixture, characters: fixture.characters.map((c) => (c.id === 'tobin' ? { ...c, occupation: undefined } : c)) }
    const { corrections } = validatePlan(noPorter, state, raw([{ entry: 'faction.guild.tallies', who: 'tobin', line: 'x' }]), ASK, turnLore(fixture, state, ASK))
    expect(corrections).toContain("dropped lore line 1: tobin doesn't know faction.guild.tallies")
  })

  it('reach the writer as a pool to draw on, marked with who would say an insider one, and framing on the speaker', () => {
    const state = yardScene()
    const { plan } = validate([
      { entry: 'faction.guild', line: 'The Guild owns the yard.' },
      { entry: 'faction.guild.tallies', who: 'mara', line: 'Every tally is rounded up.' }
    ])
    const brief = buildWriterPrompt(fixture, state, plan, ASK).user
    expect(brief).toContain('# About the world, to draw on only if it fits (some, all or none; never recite)\n- The Guild owns the yard.\n- Every tally is rounded up. (only Mara would say this)')
    expect(brief).toContain('What they say about the world comes with this view: proud of the hall, wary of the yard.')
  })

  it('are asked for in the director’s rules, against entry ids it can see', () => {
    const state = yardScene()
    const p = buildDirectorPrompt(fixture, state, ASK)
    expect(p.system).toContain('"lore": [{"entry","who","line"}]')
    expect(p.system + p.user).toContain('## How the tallies work [faction.guild.tallies]')
  })
})
