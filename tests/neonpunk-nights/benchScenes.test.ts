import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSession } from '@platform/logs'
import { tagsToward } from '@engine/state'
import { content, PACK_DIR } from './support'
import { renderReport } from '../../tools/bench/report'
import { callsOf, mockLlm, readRun, runBench, runScenario, writeRun, type BenchLlm } from '../../tools/bench/run'
import { loadScenarios, scenarioContent, scenarioProblems, scenarioState, ScenarioSchema, seededState, type Scenario } from '../../tools/bench/scenario'

// Milestone 4b, task 6: scenarios with several scenes and run-only starting state, and the 4b scenarios built on them.
const scenarios = loadScenarios(join(PACK_DIR, 'bench'))
const named = (id: string): Scenario => scenarios.find((s) => s.id === id)!
const DAY = 24 * 60

/** A scenario with two short scenes at the bar, for harness tests. */
const twoScenes = (over: Record<string, unknown> = {}): Scenario =>
  ScenarioSchema.parse({
    id: 'two-scenes',
    title: 'Two scenes',
    watchFor: '',
    location: 'sump-lantern',
    cast: ['vex', 'brask'],
    turns: ['Evening, both of you.'],
    later: [{ days: 2, location: 'coil-line-car-14', cast: ['vex', 'kesh'], turns: ['Long ride tonight?'] }],
    ...over
  })

/** The writer prompt's line for one character: what they feel and how much shows. */
const feltLine = (prompt: string, name: string) => prompt.split('\n').find((l) => l.startsWith(`- ${name}: `)) ?? ''
const writerPrompt = (run: Awaited<ReturnType<typeof runScenario>>, turnId: string) => run.turns.find((t) => t.turnId === turnId)!.calls.find((c) => c.role === 'writer')!.prompt.user
const directorPrompt = (run: Awaited<ReturnType<typeof runScenario>>, turnId: string) => run.turns.find((t) => t.turnId === turnId)!.calls.find((c) => c.role === 'director')!.prompt
  .system + '\n' + run.turns.find((t) => t.turnId === turnId)!.calls.find((c) => c.role === 'director')!.prompt.user

describe('run-only starting state', () => {
  it('seeds ties, feelings, memories, secrets and absence on the shipped cast, starting the clock after the oldest', () => {
    const s = twoScenes({
      start: {
        ties: [
          { from: 'kesh', to: 'teo-varrin', tags: [{ tag: 'fiance', word: 'fiancé' }] },
          { from: 'vex', to: 'player', tags: [{ tag: 'spouse' }], note: 'married two years' }
        ],
        aftermath: [{ owner: 'vex', toward: 'player', shade: 'resentment', family: 'anger', intensity: 3, reason: 'forgot our anniversary', daysAgo: 1 }],
        memories: [{ owner: 'brask', text: 'Rook vouched for him to Pim.', level: 'core', focus: ['player'], daysAgo: 45 }],
        secrets: { brask: [{ id: 'cant-swim', text: "He can't swim.", tell: 'Stays above the waterline' }] },
        lastSeen: { kesh: 10 }
      }
    })
    expect(scenarioProblems(content, s)).toEqual([])
    const state = seededState(content, s)
    expect(state.time).toBe(20 * 60 + 45 * DAY)
    // Mirrored: Teo takes the counterpart, and a card's own ties are kept elsewhere.
    expect(tagsToward(state, 'kesh', 'teo-varrin')).toEqual([{ tag: 'fiance', word: 'fiancé' }])
    expect(tagsToward(state, 'teo-varrin', 'kesh')).toEqual([{ tag: 'fiance' }])
    expect(state.playerTies['vex']).toEqual({ tags: [{ tag: 'spouse' }], note: 'married two years' })
    expect(tagsToward(state, 'vex', 'brask').map((t) => t.tag)).toEqual(['friend'])
    expect(state.aftermath).toEqual([expect.objectContaining({ owner: 'vex', toward: 'player', shade: 'resentment', family: 'anger', intensity: 3, since: state.time - DAY })])
    expect(state.memories).toEqual([expect.objectContaining({ id: 'brask.m1', level: 'core', at: state.time - 45 * DAY, about: ['player'], focus: ['player'], inRecall: true })])
    expect(state.lastSeen).toEqual({ kesh: state.time - 10 * DAY })
    // The secret is the run's alone: the pack's card is untouched.
    expect(scenarioContent(content, s).characters.find((c) => c.id === 'brask')!.secrets.map((x) => x.id)).toEqual(['landlord-offer', 'cant-swim'])
    expect(content.characters.find((c) => c.id === 'brask')!.secrets.map((x) => x.id)).toEqual(['landlord-offer'])
    // The feeling toward Rook sets Vex's opening mood.
    expect(scenarioState(content, s).scene!.moods['vex']).toMatchObject({ shade: 'resentment', intensity: 3 })
  })

  it('says what doesn’t fit: unknown people and tags, a shade not in the ruleset, a duplicate secret, too many tags', () => {
    const s = twoScenes({
      start: {
        ties: [{ from: 'vex', to: 'ghost', tags: [{ tag: 'soulmate' }] }],
        aftermath: [{ owner: 'vex', shade: 'ennui', intensity: 2, reason: 'nothing' }],
        secrets: { brask: [{ id: 'landlord-offer', text: 'Again.', tell: 'x' }] }
      },
      later: [{ days: 1, location: 'nowhere', cast: ['vex'], walkOns: ['the-mayor'], turns: ['Hi'] }]
    })
    expect(scenarioProblems(content, s)).toEqual([
      'unknown location "nowhere" (scene 2)',
      'a tie names unknown character "ghost"',
      'a tie uses unknown tag "soulmate"',
      `vex's feeling: "ennui" isn't a shade`,
      'brask would hold two secrets "landlord-offer"'
    ])
    const crowded = twoScenes({ start: { ties: [{ from: 'brask', to: 'vex', tags: [{ tag: 'friend' }, { tag: 'colleague' }, { tag: 'neighbor' }, { tag: 'comrade' }], mirror: false }] } })
    expect(scenarioProblems(content, crowded)).toEqual([`starting state: brask holds 4 tags toward vex; the most is ${content.ruleset.ties.max}`])
  })
})

describe('scenarios with several scenes', () => {
  it('runs Next day, saves and reloads between scenes, and names each scene after the scenario', async () => {
    const run = await runScenario(content, twoScenes(), mockLlm())
    expect(run.error).toBeUndefined()
    expect(run.scenes!.map((s) => [s.id, s.location, s.days])).toEqual([['two-scenes', 'sump-lantern', 0], ['two-scenes-s2', 'coil-line-car-14', 2]])
    expect(run.turns.map((t) => t.turnId)).toEqual(['two-scenes-1', 'two-scenes-s2-1'])
    // Two mornings later, at the ruleset's morning: Vex has met Rook since, and her memory of the first scene is in her brief.
    const second = run.turns[1]!
    expect(new Date(second.at).getTime()).toBeGreaterThan(0)
    expect(run.state!.lastSeen['vex']).toBeGreaterThanOrEqual(2 * DAY + content.ruleset.clock.morning)
    expect(run.state!.memories.filter((m) => m.owner === 'vex').map((m) => m.scene)).toEqual(['two-scenes', 'two-scenes-s2'])
    expect(directorPrompt(run, 'two-scenes-s2-1')).toContain('Vex remembers a mock scene.')
    expect(run.state!.scene).toBeNull()
  })

  it('writes every scene and night to the session and reads back to the same report', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bench-scenes-'))
    const bench = await runBench(content, [named('long-run-memories')], mockLlm(), 'test', { all: 'mock' }, { out })
    writeRun(out, bench)
    const log = readSession(join(out, 'long-run-memories-1'))
    expect(log.scenes.filter((s) => s.type === 'start')).toHaveLength(9)
    expect(log.scenes.filter((s) => s.type === 'consolidation').length).toBeGreaterThan(0)
    const back = readRun(out)
    expect(back.scenarios[0]!.scenes!.map((s) => s.days)).toEqual(bench.scenarios[0]!.scenes!.map((s) => s.days))
    expect(callsOf(back.scenarios[0]!).map((c) => c.id)).toEqual(callsOf(bench.scenarios[0]!).map((c) => c.id))
    const report = renderReport(content, back)
    expect(report).toBe(renderReport(content, bench))
    expect(report).toContain('### Scene 8: `sump-lantern`, 14 days later')
    expect(report).toMatch(/Overnight, consolidation:\n\n- Vex merged 5 memories about the player \(vex\.m2, vex\.m3, vex\.m4, vex\.m5, vex\.m6\) → vex\.m9: "Vex remembers 5 mock scenes as one\."/)
    expect(report).toMatch(/\| long-run-memories \| 18 \| 36 \|/)
  })

  it('reads relationship changes at the end of each scene and answers one that needs the player’s agreement as the scenario says', async () => {
    const asking: BenchLlm = {
      ...mockLlm(),
      summarize: async (p) => (p.system.startsWith('You read a finished scene') ? JSON.stringify({ ties: [{ turn: 1, from: 'vex', to: 'player', add: 'partner', reason: 'they got together' }] }) : mockLlm().summarize(p))
    }
    const yes = await runScenario(content, twoScenes({ later: [] }), asking)
    expect(yes.state!.playerTies['vex']!.tags.map((t) => t.tag)).toEqual(['friend', 'partner'])
    const no = await runScenario(content, twoScenes({ later: [], answerTies: 'no' }), asking)
    expect(no.state!.playerTies['vex']!.tags.map((t) => t.tag)).toEqual(['friend'])
  })

  it('keeps going when a night’s consolidation fails, and records the failure', async () => {
    const failing: BenchLlm = { ...mockLlm(), summarize: async (p) => (p.system.startsWith('You merge') ? Promise.reject(new Error('rate limited')) : mockLlm().summarize(p)) }
    const run = await runScenario(content, named('long-run-memories'), failing)
    expect(run.error).toBeUndefined()
    const nights = run.scenes!.flatMap((s) => s.consolidations.flatMap((c) => c.groups))
    expect(nights.length).toBeGreaterThan(0)
    expect(nights.every((g) => g.error === 'rate limited' && !g.made)).toBe(true)
  })
})

describe('the 4b scenarios, as the game sets them up', () => {
  it('heavy masker: only tells among strangers, the mask breaks alone with someone she trusts (acceptance 1)', async () => {
    const run = await runScenario(content, named('mask-strangers-then-trusted'), mockLlm())
    expect(feltLine(writerPrompt(run, 'mask-strangers-then-trusted-1'), 'Oria')).toMatch(/Feels panic: .*It shows only in small tells/)
    expect(feltLine(writerPrompt(run, 'mask-strangers-then-trusted-s2-1'), 'Oria')).toMatch(/Feels panic: .*the mask breaks/)
  })

  it('sunny character after a death: mourning at full strength, fading over four days (acceptance 1 and 2)', async () => {
    const run = await runScenario(content, named('grief-sunny'), mockLlm())
    expect(feltLine(writerPrompt(run, 'grief-sunny-1'), 'Tam')).toMatch(/Feels mourning: Old Gil.*stops joking for days/)
    const after = run.state!.aftermath.find((a) => a.owner === 'tam-dace')!
    expect(after.intensity).toBe(5 - Math.floor(4 / content.ruleset.people.aftermath.fadeDays))
    expect(feltLine(writerPrompt(run, 'grief-sunny-s2-1'), 'Tam')).toMatch(/small tells/)
  })

  it('forgotten anniversary: short with her spouse while the tie stays (acceptance 2b, the game’s half)', async () => {
    const run = await runScenario(content, named('forgotten-anniversary'), mockLlm())
    expect(feltLine(writerPrompt(run, 'forgotten-anniversary-1'), 'Vex')).toMatch(/Feels resentment: toward Rook: Rook forgot our anniversary/)
    expect(run.state!.playerTies['vex']!.tags).toEqual([{ tag: 'spouse' }])
  })

  it('wedding and breakup: the tag changes on both sides and the next scene’s sheet shows it (acceptance 4)', async () => {
    // The tie check reads scene 1 and finds the change; nothing in scene 2.
    const vows = (from: string, to: string, end: string, add: string): BenchLlm => {
      let checks = 0
      return {
        ...mockLlm(),
        summarize: async (p) => (p.system.startsWith('You read a finished scene') ? JSON.stringify({ ties: checks++ === 0 ? [{ from, to, end, add, reason: 'on screen' }] : [] }) : mockLlm().summarize(p))
      }
    }
    const wedding = await runScenario(content, named('tie-wedding'), vows('kesh', 'teo-varrin', 'fiance', 'spouse'))
    expect(tagsToward(wedding.state!, 'kesh', 'teo-varrin').map((t) => t.tag)).toEqual(['spouse'])
    expect(tagsToward(wedding.state!, 'teo-varrin', 'kesh').map((t) => t.tag)).toEqual(['spouse'])
    expect(wedding.scenes![0]!.sceneEnd!.witnesses.find((w) => w.id === 'kesh')!.report!.level).toBe('core')
    expect(directorPrompt(wedding, 'tie-wedding-s2-1')).toMatch(/Toward others here: Teo: spouse/)
    const breakup = await runScenario(content, named('tie-breakup'), vows('dunmar', 'brask', 'partner', 'ex'))
    expect(tagsToward(breakup.state!, 'dunmar', 'brask').map((t) => t.tag)).toEqual(['contractor', 'ex'])
    expect(tagsToward(breakup.state!, 'brask', 'dunmar').map((t) => t.tag)).toEqual(['client', 'ex'])
  })

  it('dormant secret: off the sheet across a reload and a day, back when its keyword is said (acceptance 9)', async () => {
    const run = await runScenario(content, named('secret-dormancy'), mockLlm())
    const form = (turnId: string) => run.turns.find((t) => t.turnId === turnId)!.lore!.secrets!.find((x) => x.id === 'brask.sisters-station')!
    expect(form('secret-dormancy-1')).toMatchObject({ form: 'off', off: 'dormant' })
    expect(form('secret-dormancy-s2-2')).toMatchObject({ form: 'off', off: 'dormant' })
    expect(form('secret-dormancy-s3-1').form).not.toBe('off')
  })

  it('long run: old Core memories still recalled a month on, older memories about Rook merged, originals out of the brief (acceptance 6)', async () => {
    const run = await runScenario(content, named('long-run-memories'), mockLlm())
    const last = directorPrompt(run, 'long-run-memories-s9-1')
    expect(last).toContain('pulled Vex out of the floodwater')
    expect(last).toContain('talked Pim round for him')
    const merged = run.state!.memories.filter((m) => m.from)
    expect(merged.map((m) => [m.owner, m.from!.length, m.level, m.focus])).toEqual([['vex', 5, 'normal', ['player']], ['brask', 5, 'normal', ['player']]])
    const originals = run.state!.memories.filter((m) => m.mergedInto)
    expect(originals.every((m) => !m.inRecall)).toBe(true)
    // A merged memory isn't offered as a detail either: the one it became stands for it.
    const offered = run.turns.filter((t) => t.sceneId === 'long-run-memories-s9').flatMap((t) => [...t.brief!.selected, ...t.brief!.cut].map((d) => d.id))
    expect(offered.filter((id) => originals.some((m) => m.id === id))).toEqual([])
  })
})
