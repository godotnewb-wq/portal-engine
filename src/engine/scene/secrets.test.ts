import { describe, expect, it } from 'vitest'
import type { Prompt } from '@engine/core'
import { SecretSchema, type Character } from '@engine/characters'
import { packWarnings, type Pack } from '@engine/pack'
import type { GameState } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { buildDirectorPrompt } from './director'
import { turnLore } from './lore'
import { parsePlan, validatePlan } from './plan'
import { runTurn, type TurnLlm } from './runTurn'
import { secretDisplay } from './secrets'

// Secrets on the director's situation sheet (lore injection.md §7.1, milestone 3.5 task 5).

/** The fixture with Tobin carrying extra personal secrets, and the secret budgets set. */
function pack(secrets: Partial<Character['secrets'][number]>[] = [], budgets: { linked?: number; personal?: number } = {}): Pack {
  return {
    ...fixture,
    ruleset: {
      ...fixture.ruleset,
      codex: { ...fixture.ruleset.codex, ...(budgets.linked !== undefined && { linkedSecretTokens: budgets.linked }), ...(budgets.personal !== undefined && { personalSecretTokens: budgets.personal }) }
    },
    characters: fixture.characters.map((c) => (c.id === 'tobin' ? { ...c, secrets: [...c.secrets, ...secrets.map((s) => ({ tell: 'Hums', ...s }) as Character['secrets'][number])] } : c))
  }
}
const shown = (content: Pack, state: GameState, input: string) => turnLore(content, state, input).secrets
const form = (list: ReturnType<typeof shown>, id: string) => list.find((s) => s.id === id)
/** A scene where these secrets were validly kept, one turn each, oldest first. */
function keptBefore(state: GameState, ...turns: string[][]): GameState {
  const scene = state.scene!
  return { ...state, scene: { ...scene, turns: turns.map((kept, i) => ({ id: `t${i + 1}`, player: '...', beats: [], checks: [], speakers: [], texture: [], kept })) } }
}
const LONG = 'He owes a fence on the far side of the river for a cart of tallow, and the fence has started asking after his sister by name.'

describe('secret cues and full text on the sheet', () => {
  it('shows every held secret, as a cue or in full, with its id', () => {
    const list = shown(fixture, yardScene(), 'Ask the Guild.')
    expect(list.map((s) => s.id).sort()).toEqual(['mara.two-books', 'tobin.after-closing'])
    const prompt = buildDirectorPrompt(fixture, yardScene(), 'Nice evening.', turnLore(fixture, yardScene(), 'Nice evening.')).system
    expect(prompt).toContain('Secret [mara.two-books]')
    expect(prompt).toContain('Secret [tobin.after-closing]')
  })

  it('writes a linked cue from the holder’s part and the codex summary, and a personal one from its summary or first sentence', () => {
    const content = pack([{ id: 'debt', text: LONG, summary: 'He owes a fence across the river' }, { id: 'name', text: 'He was born Tobias Hale. Nobody here knows it.' }], { linked: 0 })
    const state = yardScene()
    const system = buildDirectorPrompt(content, state, 'Nice evening.', turnLore(content, state, 'Nice evening.')).system
    expect(system).toContain("Secret [mara.two-books] (in short): Mara's part: she keeps the second ledger. The Guild keeps a second set of books.")
    expect(system).toContain('Secret [tobin.debt] (in short): He owes a fence across the river.')
    expect(system).toContain('Secret [tobin.name] (in short): He was born Tobias Hale.')
    // A cue leaves the tell and the reveal condition for the full form.
    expect(system).not.toMatch(/\[tobin\.debt\][^\n]*Tell:/)
  })

  it('expands a linked secret once the conversation brings up its faction, not because the faction is background here', () => {
    // Mara is a Guild member, so the Guild's own entry is in the scene layer in full from the start.
    expect(turnLore(fixture, yardScene(), 'Nice evening.').layers.scene.entries.map((e) => e.id)).toContain('faction.guild')
    const quiet = form(shown(fixture, yardScene(), 'Nice evening.'), 'mara.two-books')
    expect(quiet).toMatchObject({ form: 'cue' })
    expect(quiet?.priority).toBeUndefined()
    // Named in the conversation, it counts, though the triggered layer leaves the Guild out as already carried.
    expect(form(shown(fixture, yardScene(), 'What does the Guild want with me?'), 'mara.two-books')).toMatchObject({ form: 'full', priority: 'context' })
    expect(secretDisplay(fixture, yardScene(), { texts: ['Nice evening.'], mentioned: new Set(['faction.guild']) }).find((s) => s.id === 'mara.two-books')?.priority).toBe('context')
  })

  it('expands a personal secret once the conversation names something canon in it', () => {
    const content = pack([{ id: 'watch', text: 'He sold the Ward Watch a list of names, and they paid in pennies.', summary: 'Sold the Watch some names' }])
    expect(form(shown(content, yardScene(), 'Nice evening.'), 'tobin.watch')?.form).toBe('cue')
    expect(form(shown(content, yardScene(), 'Is the watch about tonight?'), 'tobin.watch')).toMatchObject({ form: 'full', priority: 'context' })
  })

  it('expands a personal secret whose own keywords were just said', () => {
    const content = pack([{ id: 'debt', text: LONG, keywords: ['fence', 'tallow'] }])
    expect(form(shown(content, yardScene(), 'Who buys tallow round here?'), 'tobin.debt')).toMatchObject({ form: 'full', priority: 'keyword' })
    expect(form(shown(content, yardScene(), 'Nice evening.'), 'tobin.debt')).toMatchObject({ form: 'cue' })
  })

  it('puts a secret kept last turn first, then keyword hits, then context, within one budget', () => {
    // Room for exactly one of the two long secrets.
    const content = pack([{ id: 'debt', text: LONG, summary: 'Owes a fence', keywords: ['fence'] }, { id: 'river', text: LONG.replace('tallow', 'lamp oil'), summary: 'Owes a fence too', keywords: ['fence'] }], { personal: 35 })
    const list = shown(content, keptBefore(yardScene(), ['tobin.river']), 'Ask the fence.')
    expect(form(list, 'tobin.river')).toMatchObject({ form: 'full', priority: 'kept' })
    expect(form(list, 'tobin.debt')).toMatchObject({ form: 'cue', priority: 'keyword' })
  })

  it('breaks ties by the most recently kept secret in the scene, then by id', () => {
    const content = pack([{ id: 'debt', text: LONG, summary: 'Owes a fence', keywords: ['fence'] }, { id: 'river', text: LONG.replace('tallow', 'lamp oil'), summary: 'Owes a fence too', keywords: ['fence'] }], { personal: 35 })
    // Neither was kept last turn, so both rank as keyword hits; river was kept more recently.
    const recent = shown(content, keptBefore(yardScene(), ['tobin.debt'], ['tobin.river'], []), 'Ask the fence.')
    expect(form(recent, 'tobin.river')?.form).toBe('full')
    expect(form(recent, 'tobin.debt')?.form).toBe('cue')
    // Never kept: the id decides.
    const fresh = shown(content, yardScene(), 'Ask the fence.')
    expect(form(fresh, 'tobin.debt')?.form).toBe('full')
    expect(form(fresh, 'tobin.river')?.form).toBe('cue')
  })

  it('keeps linked and personal budgets apart, charging only the extra text, and keeps every cue when both are spent', () => {
    const content = pack([{ id: 'debt', text: LONG, summary: 'Owes a fence', keywords: ['fence'] }], { linked: 0, personal: 1000 })
    const list = shown(content, yardScene(), 'Ask the fence.')
    expect(form(list, 'mara.two-books')).toMatchObject({ form: 'cue', expansionTokens: 0 })
    const debt = form(list, 'tobin.debt')!
    expect(debt.form).toBe('full')
    expect(debt.expansionTokens).toBeGreaterThan(0)
    const spent = shown(pack([{ id: 'debt', text: LONG, summary: 'Owes a fence', keywords: ['fence'] }], { linked: 0, personal: 0 }), yardScene(), 'Ask the fence.')
    expect(spent.map((s) => s.form)).toEqual(['cue', 'cue', 'cue'])
    // A secret whose cue is as long as its full text costs nothing extra, so it shows in full even then.
    expect(form(shown(pack([{ id: 'short', text: 'He hums.', keywords: ['hum'] }], { personal: 0 }), yardScene(), 'Why do you hum?'), 'tobin.short')?.form).toBe('full')
  })
})

describe('keeping a secret shown as a cue', () => {
  const llm = (director: string, reply: string): TurnLlm => ({
    direct: async () => director,
    write: async (_p: Prompt, onDelta) => {
      onDelta(reply)
      return reply
    }
  })
  const content = pack([{ id: 'debt', text: LONG, summary: 'He owes a fence across the river', keywords: ['tallow'] }], { personal: 0 })
  const plan = JSON.stringify({
    player_action: { doing: 'asks about the river', uncertain: false },
    speakers: [{ id: 'tobin', goal: 'change the subject', mood: 'uneasy', keeps: ['tobin.debt'], touched: 'across the river', approach: 'deflect' }],
    moves: [{ who: 'tobin', answers: 'player', move: 'dodge', uses: [] }],
    change: 'nothing',
    reactions: [],
    checks: [],
    texture: []
  })

  it('passes the relevance check from the cue and gives the writer the whole secret', () => {
    const input = 'Anyone you know across the river?'
    expect(form(shown(content, yardScene(), input), 'tobin.debt')?.form).toBe('cue')
    const { plan: checked } = validatePlan(content, yardScene(), parsePlan(plan)!, input)
    const tobin = checked.speakers.find((s) => s.id === 'tobin')!
    expect(tobin.kept).toEqual(['tobin.debt'])
    expect(tobin.hiding).toContain('the fence has started asking after his sister')
  })

  it('records the keep, so the secret is first in line next turn', async () => {
    const { state, trace } = await runTurn(pack([{ id: 'debt', text: LONG, summary: 'He owes a fence across the river' }]), yardScene(), 'Anyone you know across the river?', llm(plan, 'Tobin: "Not a soul."'))
    expect(state.scene!.turns.at(-1)!.kept).toEqual(['tobin.debt'])
    expect(trace.lore?.secrets?.map((s) => s.id)).toContain('tobin.debt')
    expect(form(shown(pack([{ id: 'debt', text: LONG }]), state, 'Nice evening.'), 'tobin.debt')).toMatchObject({ form: 'full', priority: 'kept' })
  })
})

describe('secret authoring', () => {
  it('takes a linked secret’s summary and keywords from its codex entry', () => {
    expect(SecretSchema.safeParse({ id: 'x', codex: 'faction.guild.second-ledger', role: 'r', angle: 'a', tell: 't', summary: 's' }).success).toBe(false)
    expect(SecretSchema.safeParse({ id: 'x', text: 'A thing.', tell: 't', summary: 's', keywords: ['k'] }).success).toBe(true)
  })

  it('warns when an authored character starts with more secrets than the ruleset allows', () => {
    expect(packWarnings(fixture)).toEqual([])
    const crowded = pack([{ id: 'a', text: 'A.' }, { id: 'b', text: 'B.' }, { id: 'c', text: 'C.' }])
    expect(packWarnings(crowded)).toEqual(["tobin starts with 4 secrets; more than 3 crowds the director's sheet"])
  })
})
