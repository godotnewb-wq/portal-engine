import { describe, expect, it } from 'vitest'
import { finishedPart, parseReply } from './beats'
import { checkReply, salvage } from './checks'
import { parsePlan, validatePlan } from './plan'
import { resolvePlan } from './resolve'
import { barScene, content } from '../../../tests/support/bar'
import { buildRewritePrompt, buildWriterPrompt, sceneSpeakers } from './writer'

const state = barScene(5)
const speakers = sceneSpeakers(content, state)
const { plan } = validatePlan(content, state, parsePlan(JSON.stringify({
  speakers: [
    { id: 'oria-senn', intent: 'Deflect.', mood: 'composed', hiding: 'client is the grid consortium', approach: 'lie' },
    { id: 'vex', intent: 'Call out the lie if she catches it.', mood: 'wary', depends_on_check: 'vex_empathy' }
  ],
  reactions: [{ id: 'brask', beat: 'fidgets with his glass, ears flat' }],
  checks: [{ id: 'vex_empathy', who: 'vex', skill: 'empathy', difficulty: 'moderate', stakes: 'notices Oria is lying' }],
  walk_ons: [{ id: 'bartender', line: 'slides a lantern-pour across without being asked' }],
  texture: ['condensation dripping from an Aether-cooled pipe overhead'],
  avoid: ['darling, darling']
}))!)

const INPUT = 'So, Oria, who is the client, really?'

/** The worked example's turn, as the writer should return it. */
const GOOD = `NARRATION: Water ticks from the cooled pipe onto the table edge, inches from your hand. Oria doesn't move her glass.
Oria: "A private collector, darling. Discreet, generous, and entirely uninterested in being named."
NARRATION: At the next table someone slaps down a losing hand. Brask flinches and turns his glass in a slow circle, ears flat.
Vex: "'Darling.' She only says that when she's lying."
[Vex: EXPRESSION smirk]
[Oria: EXPRESSION polite]
[Brask: COMFORT 2 too loud, doesn't like her]`

describe('parseReply', () => {
  it('reads beats and hidden tags, resolving first names to ids', () => {
    const parsed = parseReply(GOOD, speakers)
    expect(parsed.beats.map((b) => (b.kind === 'dialogue' ? b.speaker : 'narration'))).toEqual(['narration', 'oria-senn', 'narration', 'vex'])
    expect(parsed.beats[1]).toEqual({ kind: 'dialogue', speaker: 'oria-senn', text: 'A private collector, darling. Discreet, generous, and entirely uninterested in being named.' })
    expect(parsed.tags.expressions).toEqual({ vex: 'smirk', 'oria-senn': 'polite' })
    expect(parsed.tags.comfort).toEqual({ brask: { level: 2, reason: "too loud, doesn't like her" } })
    expect(parsed.droppedTags).toEqual([])
  })

  it('reads bold names, unlabelled narration, a colon in narration, walk-ons, departures and the scene end', () => {
    const parsed = parseReply(
      '**Vex:** Let\'s go.\nThe card game collapses into shouting.\nOne rule down here: nobody asks.\nDunmar: "Two cinders."\n[LEAVES: Brask]\n[END SCENE]\n[Ghost: MOOD sad]',
      speakers
    )
    expect(parsed.beats).toEqual([
      { kind: 'dialogue', speaker: 'vex', text: "Let's go." },
      { kind: 'narration', text: 'The card game collapses into shouting.' },
      { kind: 'narration', text: 'One rule down here: nobody asks.' },
      { kind: 'dialogue', speaker: 'bartender', text: 'Two cinders.' }
    ])
    expect(parsed.tags.leaves).toEqual(['brask'])
    expect(parsed.tags.ended).toBe(true)
    expect(parsed.droppedTags).toEqual(['[Ghost: MOOD sad]'])
  })

  it('marks a name-like label nobody here answers to', () => {
    expect(parseReply('Marla: "Evening."', speakers).unknownSpeakers).toEqual(['Marla'])
  })

  it('only counts finished lines while streaming', () => {
    expect(finishedPart('NARRATION: one\nVex: two')).toBe('NARRATION: one')
    expect(finishedPart('NARRATION: one')).toBe('')
  })
})

describe('checkReply', () => {
  const kinds = (reply: string, input = INPUT) => checkReply(parseReply(reply, speakers), plan, speakers, input).map((p) => p.kind)

  it('passes the worked example', () => {
    expect(kinds(GOOD)).toEqual([])
  })

  it('catches a speaker who was not planned, and someone who is not here', () => {
    expect(kinds(`${GOOD}\nBrask: "Can we go?"`)).toEqual(['unplanned-speaker'])
    expect(kinds(`${GOOD}\nMarla: "Evening."`)).toEqual(['unknown-speaker'])
  })

  it('lets a planned walk-on speak', () => {
    expect(kinds(`${GOOD}\nDunmar: "On the slate."`)).toEqual([])
  })

  it('catches speaking or acting for the player, unless the player said they did it', () => {
    expect(kinds(`${GOOD}\nRook: "Fine, I'll take it."`)).toEqual(['player-voice'])
    expect(kinds(`${GOOD}\nNARRATION: You tell her, "Fine, I'll take it."`)).toEqual(['player-voice'])
    expect(kinds(`${GOOD}\nNARRATION: You nod slowly and reach for the case.`)).toEqual(['player-action'])
    expect(kinds(`${GOOD}\nNARRATION: You nod slowly and reach for the case.`, 'I nod. "Who is it?"')).toEqual([])
    // A character telling the player what they do is just talk.
    expect(kinds(`${GOOD.replace('when she\'s lying', 'when she\'s lying. You laugh, but I mean it')}`)).toEqual([])
  })

  it('catches overused phrases, the director’s avoid list, long beats and a bad beat count', () => {
    expect(kinds(GOOD.replace('Water ticks', 'The air is thick. Water ticks'))).toEqual(['overused-phrase'])
    expect(kinds(GOOD.replace('A private collector, darling.', 'A private collector, darling, darling.'))).toEqual(['overused-phrase'])
    expect(kinds(`NARRATION: ${'word '.repeat(70)}`)).toEqual(['beat-length', 'beat-count'])
  })
})

describe('salvage', () => {
  it('drops beats that speak for the player or come from the unplanned, and cuts to the budget', () => {
    const parsed = parseReply(`${GOOD}\nBrask: "Can we go?"\nRook: "Sure."`, speakers)
    const kept = salvage(parsed.beats, checkReply(parsed, plan, speakers, INPUT))
    expect(kept.map((b) => (b.kind === 'dialogue' ? b.speaker : 'n'))).toEqual(['n', 'oria-senn', 'n', 'vex'])
  })
})

describe('buildWriterPrompt', () => {
  const resolved = resolvePlan(content, state, plan).plan
  const prompt = buildWriterPrompt(content, state, resolved, INPUT)

  it('gives the writer only this beat’s speakers’ voice cards and no secrets they aren’t told', () => {
    expect(prompt.system).toMatch(/## Oria's voice/)
    expect(prompt.system).toMatch(/## Vex's voice/)
    expect(prompt.system).not.toMatch(/## Brask's voice/)
    // Vex's own secret is not part of this beat.
    expect(prompt.system + prompt.user).not.toMatch(/running partner/)
    expect(prompt.user).toMatch(/Hiding: client is the grid consortium/)
  })

  it('states the check result as decided', () => {
    const degree = resolved.checks[0]!.result!.degree
    expect(prompt.user).toMatch(degree === 'failure' ? /FAILURE: this does not happen: notices Oria is lying/ : /success.*notices Oria is lying/)
  })

  it('carries the reactions, the walk-on and the texture, and ends on the player’s words', () => {
    expect(prompt.user).toMatch(/Brask \(no dialogue\): fidgets/)
    expect(prompt.user).toMatch(/Dunmar \(the bartender/)
    expect(prompt.user).toMatch(/condensation dripping/)
    expect(prompt.user.trim().endsWith('Write the beats.')).toBe(true)
  })

  it('builds the rewrite from the same prompt plus the draft and the fixes', () => {
    const rewrite = buildRewritePrompt(prompt, 'draft text', ['Remove beat 3.'])
    expect(rewrite.system).toBe(prompt.system)
    expect(rewrite.user).toMatch(/# Your draft\ndraft text[\s\S]*- Remove beat 3\./)
  })
})
