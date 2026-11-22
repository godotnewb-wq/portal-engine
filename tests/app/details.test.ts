import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { answerTie, type GameState } from '@engine/state'
import { applyRecords, bookkeep, runTurn, type TurnLlm } from '@engine/scene'
import { endScene, judgeScene, witnesses } from '@engine/relationships'
import { PlayLogs, summarized, type SceneEndDetails, type TurnDetails } from '@platform/logs'
import type { DetailsTab } from '@app/renderer/src/ui/DetailsOverlay'
import { turnTabs } from '@app/renderer/src/ui/TurnDetails'
import { sceneEndTabs } from '@app/renderer/src/ui/SceneEndDetails'
import { fixture, yardScene } from '../fixture'
import { SUMMARIES, TURNS } from '../yard'

/**
 * Turn details and the scene's end on recorded logs (milestone 4d task 3). The yard scene's first three turns are
 * played and logged the way the app does it (the turn, then its bookkeeper), read back from the log folder, and every
 * tab of both overlays is drawn from what was read: one test per tab, an old log missing what later milestones added,
 * and tabs with nothing in them.
 */

const TOBIN = 'tobin.after-closing'
const nameOf = (id: string) => (id === 'player' ? fixture.player.name : (fixture.characters.find((c) => c.id === id)?.name.split(' ')[0] ?? id))

/** A tab drawn as plain text, the way it reads on screen. */
const text = (tab: DetailsTab) =>
  renderToStaticMarkup(createElement(Fragment, null, tab.render()))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

const tabsOf = (details: TurnDetails) => turnTabs(details, details.records, nameOf, [], () => {})
const tab = (tabs: DetailsTab[], id: string) => tabs.find((t) => t.id === id)!

/** Each turn's bookkeeper reply, found by the words it quotes so the beat numbers come from the turn itself. */
const BOOKKEEPER: ((beats: { text: string }[]) => object | null)[] = [
  // Turn 1: Mara says Tobin's secret as if she knew it (a leak), a secret nobody holds (refused), and the reading
  // check the prose dropped, and Tobin's dodge, talk around his secret.
  (beats) => ({
    secrets: [
      { id: TOBIN, at: beats.findIndex((b) => b.text.includes('You were here after closing')) + 1, how: 'stated', words: 'You were here after closing' },
      { id: 'pell.nothing', at: 1, how: 'stated', words: 'gate' },
      { id: TOBIN, at: beats.findIndex((b) => b.text.includes('I sang to them')) + 1, how: 'around', words: 'I sang to them' }
    ],
    new: [],
    changed: 'Mara has caught Tobin out.',
    moods: [{ id: 'tobin', shade: 'sore', family: 'mad', intensity: 3 }],
    checks: [{ id: 'read-tobin', shown: 'falls short', at: beats.findIndex((b) => b.text.includes('You were here after closing')) + 1, words: 'You were here after closing' }]
  }),
  // Turn 2: Tobin says the secret he is keeping, which is left for review.
  (beats) => ({
    secrets: [{ id: TOBIN, at: beats.findIndex((b) => b.text.includes('Guild seal knocked')) + 1, how: 'stated', words: 'Someone with a Guild seal knocked' }],
    new: [],
    changed: 'Tobin admits it.',
    moods: [],
    checks: [{ id: 'persuade-tobin', shown: 'comes off', at: beats.findIndex((b) => b.text.includes('Guild seal knocked')) + 1, words: 'Someone with a Guild seal knocked' }]
  }),
  // Turn 3: the call fails, so the plan's records stand in.
  () => null
]

let root: string
const read: TurnDetails[] = []
let end: SceneEndDetails

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'details-'))
  const logs = new PlayLogs(root, fixture, () => ({ engine: 'test', models: {} }), () => true)
  const session = logs.begin('test')!
  let state: GameState = yardScene(13)
  for (const [i, t] of TURNS.slice(0, 3).entries()) {
    const writes = [...t.writes]
    const llm: TurnLlm = {
      direct: async () => JSON.stringify(t.plan),
      async write(_prompt, onDelta) {
        const reply = writes.shift() ?? ''
        onDelta(reply)
        return reply
      }
    }
    const before = state
    const turnId = `${before.scene!.id}-${i + 1}`
    const outcome = await runTurn(fixture, before, t.input, llm, () => {}, { turnId, log: session, now: () => 0 })
    logs.turn(outcome.trace, { location: before.scene!.locationId, cast: before.scene!.cast })
    const last = outcome.state.scene!.turns.at(-1)!
    const reply = BOOKKEEPER[i]!(last.beats)
    const kept = await bookkeep(fixture, before, { id: last.id, input: t.input, beats: last.beats, plan: outcome.plan }, async () => {
      if (!reply) throw new Error('timeout')
      return JSON.stringify(reply)
    })
    logs.bookkeeping(kept.trace)
    state = applyRecords(outcome.state, kept.records)
    read.push(logs.details(session, turnId)!)
  }
  // The scene's end, as the app passes it to the summary screen.
  const order = witnesses(state)
  let asked = 0
  const reply = async () => JSON.stringify(SUMMARIES[order[asked++] as keyof typeof SUMMARIES] ?? {})
  const judged = await judgeScene(fixture, state, reply, () => 0)
  logs.ties(judged.trace)
  state = judged.state
  while (state.scene!.pendingTies.length > 0) state = answerTie(fixture, state, 0, true)
  asked = 0
  const ended = await endScene(fixture, state, reply, () => 0)
  logs.sceneEnd(ended.trace)
  end = { session, ties: summarized(judged.trace), end: summarized(ended.trace) }
  logs.end()
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('Turn details on a recorded turn', () => {
  it('reads every turn back with its bookkeeper record', () => {
    expect(read.map((d) => d.records?.records.source)).toEqual(['bookkeeper', 'bookkeeper', 'plan'])
    expect(read.map((d) => d.turn.turn)).toEqual([1, 2, 3])
  })

  it('Turn: the player, the change meant, the outline and the beats', () => {
    const s = text(tab(tabsOf(read[0]!), 'turn'))
    expect(s).toContain('Who was in the yard last night?')
    expect(s).toContain('Read as: asks who was in the yard last night')
    expect(s).toContain('Mara suspects Tobin.')
    expect(s).toContain('I sang to them.')
  })

  it('People: each person present, what they felt and showed, and the memories brought in', () => {
    const people = tab(tabsOf(read[0]!), 'people')
    expect(people.count).toBe(2)
    const s = text(people)
    expect(s).toContain('Tobin')
    expect(s).toContain('Mara')
    expect(s).toContain('Speaks: change the subject')
    expect(s).toMatch(/Showed: \S/)
    expect(s).not.toContain('not recorded')
  })

  it('Secrets and knowledge: a leak warns, and a kept secret said aloud is left for review', () => {
    const first = tab(tabsOf(read[0]!), 'secrets')
    expect(first).toMatchObject({ count: 1, warn: true })
    expect(text(first)).toContain(`Leak, a claim that teaches no one: ${TOBIN} by Mara`)
    expect(text(first)).toContain('Secrets on the director')
    // Talk around the secret is shown, and counts for nothing.
    expect(text(first)).toContain(`Talked around: ${TOBIN} by Tobin, beat`)
    const second = text(tab(tabsOf(read[1]!), 'secrets'))
    expect(second).toContain(`Left for review: ${TOBIN} by Tobin`)
  })

  it('Lore: the layers, with their budgets', () => {
    const s = text(tab(tabsOf(read[0]!), 'lore'))
    expect(s).toContain('Lore lines planned')
    expect(s).not.toContain('before the codex')
  })

  it('Checks: the arithmetic, and whether the prose kept the result', () => {
    const checks = tab(tabsOf(read[0]!), 'checks')
    expect(checks).toMatchObject({ count: 1, warn: true })
    const s = text(checks)
    expect(s).toMatch(/d20 \d+.* = -?\d+ vs DC \d+ \(tough\)/)
    expect(s).toContain("The prose didn't keep the result: rolled success; the prose shows it falling short (“You were here after closing”)")
    expect(text(tab(tabsOf(read[1]!), 'checks'))).toContain('The prose kept the result: “Someone with a Guild seal knocked”')
  })

  it('Fixes: the corrections the plan needed and the rewrite', () => {
    const first = tab(tabsOf(read[0]!), 'fixes')
    expect(first.warn).toBe(true)
    expect(text(first)).toContain('read-pell')
    expect(text(tab(tabsOf(read[1]!), 'fixes'))).toContain("The writer's draft")
  })

  it('Calls: the director, the writer and the bookkeeper', () => {
    const calls = tab(tabsOf(read[0]!), 'calls')
    expect(calls.count).toBe(3)
    const s = text(calls)
    expect(s).toContain('director:')
    expect(s).toContain('writer:')
    expect(s).toContain('bookkeeper:')
  })

  it('Records: what changed, the moods read, and what the game turned down', () => {
    const records = tab(tabsOf(read[0]!), 'records')
    expect(records).toMatchObject({ count: 1, warn: true })
    const s = text(records)
    expect(s).toContain('Mara has caught Tobin out.')
    expect(s).toContain('Tobin: read as')
    expect(s).toContain('pell.nothing')
  })

  it('Records: a failed bookkeeper says the plan stood in', () => {
    const records = tab(tabsOf(read[2]!), 'records')
    expect(records.warn).toBe(true)
    expect(text(records)).toContain('timeout')
  })
})

describe('Turn details with nothing to show', () => {
  it('says so in each empty tab instead of leaving it blank', () => {
    const tabs = tabsOf(read[2]!)
    expect(text(tab(tabs, 'checks'))).toBe('No checks this turn.')
    expect(text(tab(tabs, 'secrets'))).toContain('No secret came up.')
    expect(tab(tabs, 'checks').count).toBe(0)
    expect(tab(tabs, 'secrets').count).toBe(0)
  })

  it('a turn the bookkeeper is still reading points to the log', () => {
    const { records: _r, ...waiting } = read[0]!
    const tabs = tabsOf(waiting)
    expect(text(tab(tabs, 'records'))).toContain("The bookkeeper's records aren't here")
    expect(text(tab(tabs, 'secrets'))).toContain("The bookkeeper's records aren't here")
  })
})

describe('Turn details on an older log', () => {
  it('says what the log never recorded', () => {
    const d = read[0]!
    const { shown: _s, lore: _l, ...turn } = d.turn
    const { recalled: _m, ...brief } = turn.brief!
    const { records: _r, ...old } = d
    const tabs = tabsOf({ ...old, turn: { ...turn, brief } as TurnDetails['turn'] })
    const people = text(tab(tabs, 'people'))
    expect(people).toContain('How much showed: not recorded (a log from before milestone 4d).')
    expect(people).toContain('Memories recalled: not recorded (a log from before milestone 4d).')
    expect(text(tab(tabs, 'lore'))).toContain('before the codex')
    expect(text(tab(tabs, 'records'))).toContain('from before milestone 4c')
  })
})

describe("The scene's end on a recorded scene", () => {
  const tabs = () => sceneEndTabs(fixture, end)

  it('People: each witness, their meter changes with before and after, and why', () => {
    const people = tab(tabs(), 'people')
    expect(people.count).toBe(2)
    const s = text(people)
    expect(s).toContain('Mara')
    expect(s).toContain('Kit kept it quiet')
    expect(s).toMatch(/Toward Kit: .*→/)
  })

  it('Ties: what each witness stated and how it settled', () => {
    const s = text(tab(tabs(), 'ties'))
    expect(s).toContain('Mara: Tobin is now my apprentice')
  })

  it('Memory: each memory and its level, what each carries, and a secret claimed but never seen', () => {
    const memory = tab(tabs(), 'memory')
    expect(memory.count).toBe(3)
    const s = text(memory)
    expect(s).toContain('(core) Tobin is my apprentice now.')
    expect(s).toContain('Carries toward Tobin: sore 3/5 (he lied to her)')
    // Tobin's line was left for review, so his secret never came out in front of Mara, and she learns nothing.
    expect(s).toContain(`Note: heard "${TOBIN}": it didn't come out in front of them this scene`)
    expect(s).not.toContain('Learned a secret')
  })

  it('Calls: each call names its witness', () => {
    const s = text(tab(tabs(), 'calls'))
    expect(s).toContain('relationship · Mara')
    expect(s).toContain('memory · Tobin')
  })

  it('a scene with nothing recorded says so', () => {
    const empty = sceneEndTabs(fixture, {})
    expect(text(tab(empty, 'people'))).toContain("The relationship calls didn't run")
    expect(text(tab(empty, 'memory'))).toBe("The memory calls haven't run yet.")
    expect(text(tab(empty, 'calls'))).toBe('Calls (click a call for its prompt and reply) No calls.')
  })
})

describe('Turn details on a scene-pipeline turn (Milestone 5 task 4)', () => {
  let scene: TurnDetails
  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'details-scene-'))
    const logs = new PlayLogs(dir, fixture, () => ({ engine: 'test', models: {} }), () => true)
    const session = logs.begin('test')!
    const plan = {
      player_action: { doing: 'asks Mara about a second ledger', uncertain: false },
      focus: ['mara'],
      moments: [{ who: 'mara', lands: 'the one question she dreads', wants: 'to close it down', pressure: 'keen' }],
      pressures: [{ who: 'mara', kind: 'secret', secret: 'mara.two-books', touched: 'second ledger', approach: 'lie' }],
      details: [{ who: 'mara', text: 'one book, closed at six' }],
      stakes: 'whether Kit believes there is one book'
    }
    const llm: TurnLlm = {
      direct: async () => JSON.stringify(plan),
      async write(_p, onDelta) {
        const reply = 'Mara: She shuts the book. "One book, Kit. Closed at six."\n[Mara: EXPRESSION guarded]'
        onDelta(reply)
        return reply
      }
    }
    const before = yardScene(13)
    const outcome = await runTurn(fixture, before, 'Is there a second ledger, Mara?', llm, () => {}, { turnId: 'scene-1', log: session, now: () => 0, pipeline: 'scene' })
    logs.turn(outcome.trace, { location: before.scene!.locationId, cast: before.scene!.cast })
    scene = logs.details(session, 'scene-1')!
    logs.end()
    rmSync(dir, { recursive: true, force: true })
  })

  it('Turn: the stakes and the moment, with what pressed live, in place of moves', () => {
    const s = text(tab(tabsOf(scene), 'turn'))
    expect(s).toContain("What's at stake whether Kit believes there is one book")
    expect(s).toContain('The moment Mara : the one question she dreads · wants to close it down')
    expect(s).toContain('Pressing live Mara: mara.two-books (lie) · touched by “second ledger”')
    expect(s).not.toContain('The change the director meant')
  })

  it('People: the moment, what presses underneath, the pool, and the director’s brief', () => {
    const s = text(tab(tabsOf(scene), 'people'))
    expect(s).toContain('In the moment: the one question she dreads · wants to close it down')
    expect(s).toContain('Underneath: secret mara.two-books (lie)')
    expect(s).toContain('May draw on: “one book, closed at six”')
    expect(s).toMatch(/Brief: ≈\d+ tokens always/)
    expect(s).toContain('Here, not in focus: may react or say a little.')
  })

  it('Secrets: the facts the writer was offered', () => {
    expect(text(tab(tabsOf(scene), 'secrets'))).toContain('Mara: new — one book, closed at six (new to the player)')
  })
})
