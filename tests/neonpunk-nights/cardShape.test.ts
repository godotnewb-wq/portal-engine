import { describe, expect, it } from 'vitest'
import { cardShapeProblems, type Character } from '@engine/characters'
import { worldNames } from '@engine/pack'
import { createInitialState, startScene } from '@engine/state'
import { runTurn, type TurnLlm } from '@engine/scene'
import { content } from './support'

const card = (id: string): Character => structuredClone(content.characters.find((c) => c.id === id)!)

// Issue 4 (2026-11-25 play): Brask's trade filled his portrait, his shifts, his displays and his example lines, and the
// writer played the mechanic every turn. The check holds authored and generated cards to one strand.
describe('a character card keeps its trade to one strand (issue 4)', () => {
  it('passes every card in the pack', () => {
    expect(content.characters.flatMap((c) => cardShapeProblems(c, worldNames(content)))).toEqual([])
  })

  it('names the field and the words when the trade takes over how someone changes or shows a feeling', () => {
    const c = card('brask')
    c.voice.shifts = { ...c.voice.shifts, afraid: 'Gets precise: valves, pumps, how long until the seals go' }
    expect(cardShapeProblems(c)).toEqual([expect.stringMatching(/^brask: how they change: 1 of \d are about their work \(at most 0\): afraid ".+" \[pump, valve, seal\]/)])
  })

  it('needs work beside an occupation', () => {
    const c = card('brask')
    delete c.work
    expect(cardShapeProblems(c)).toEqual([expect.stringMatching(/^brask: has an occupation \("mechanic"\) but no work/)])
  })

  it('sends back a portrait that lists topics they would talk about, and lets a disposition through', () => {
    const c = card('vex')
    c.portrait = `${c.portrait} She'll talk about routes, the weather and bad dispatchers long before anything personal.`
    expect(cardShapeProblems(c)).toEqual([expect.stringMatching(/^vex: portrait sentence \d+ lists topics they'd talk about/)])
    c.portrait = `${card('vex').portrait} She'd sooner talk about anyone else than herself.`
    expect(cardShapeProblems(c)).toEqual([])
  })

  it('keeps an example line to the voice: no names, figures or facts of the card (writing issue 2)', () => {
    const c = card('vex')
    c.voice.sampleLines = ['Forty cinders for a night run. Pump Station Nine isn\'t clear.', 'You eat yet? No? Brask, get them something.', 'Ran sealed packets twice. Both paid.']
    expect(cardShapeProblems(c, worldNames(content))).toEqual([
      expect.stringMatching(/^vex: example lines: 2 of 3 are about their work/),
      expect.stringMatching(/^vex: example line 1 ".+" names Cinders, gives a figure \("Forty"\)\./),
      expect.stringMatching(/^vex: example line 2 ".+" names Brask\./),
      expect.stringMatching(/^vex: example line 3 ".+" says the note on oria-senn \("ran sealed packet"\)\./)
    ])
  })

  it('tells each fact once, in the knowledge or a note', () => {
    const c = card('dunmar')
    c.relations = c.relations.map((r) => (r.to === 'oria-senn' ? { ...r, note: 'her booth, her tab, paid on the first of every month without fail' } : r))
    expect(cardShapeProblems(c, worldNames(content))).toEqual([expect.stringMatching(/^dunmar: knowledge \d+ and the note on oria-senn tell the same fact \[booth, tab, first, month\]/)])
  })

  it('reads a hyphenated word as one word and a longer word as another', () => {
    const c = card('brask')
    // "cut-offs" isn't "off", and "careful" isn't "car"; "fixing" is "fix".
    c.voice.sampleLines = ['Careful with the cut-offs.', 'I fix things.', 'Fixing it now.']
    expect(cardShapeProblems(c)).toEqual([expect.stringMatching(/example lines: 2 of 3 .* line 2 "I fix things\." \[fix\]; line 3 "Fixing it now\." \[fix\]/)])
  })
})

// A mood held all evening isn't re-staged every turn: its display line reaches the writer once, and again when it rises.
describe('a held feeling in the scene writer’s brief (issue 4)', () => {
  const plan = (intensity?: number) => ({
    focus: ['brask'],
    moments: [{ who: 'brask', lands: 'the player asks after him', wants: 'to be left alone', ...(intensity && { feels: { shade: 'worry', intensity, reason: 'the player pushes' } }) }],
    stakes: 'nothing much'
  })
  const brief = async (turns: number, intensity?: number) => {
    let state = startScene(content, createInitialState(content, 5), 'sump-lantern', ['vex', 'brask'])
    let writer = ''
    for (let i = 0; i <= turns; i++) {
      const llm: TurnLlm = { direct: async () => JSON.stringify(plan(i === turns ? intensity : undefined)), write: async (p, d) => ((writer = p.user), d('Brask: "Fine."'), 'Brask: "Fine."') }
      state = (await runTurn(content, state, 'How are you?', llm, () => {}, { pipeline: 'scene' })).state
    }
    return writer.split('\n').find((l) => l.includes('Feels'))!
  }

  it('shows the display line the first time, then says the feeling is held', async () => {
    expect(await brief(0)).not.toContain('as before')
    expect(await brief(1)).toContain('as before. ')
  })

  it('shows it again when the feeling rises', async () => {
    expect(await brief(1, 5)).toContain('more than before. ')
  })
})
