import { describe, expect, it } from 'vitest'
import type { Prompt } from '@engine/core'
import type { GameState } from '@engine/state'
import { fixture, yardScene } from '@tests/fixture'
import { runTurn, type TurnLlm } from './runTurn'
import { checkEvent, ownedProblems, placeDetails, portraitNow } from './sceneWriter'
import { parseReply } from './beats'
import { checkReply, salvaged } from './checks'
import { sceneSpeakers } from './writer'
import { sceneView, sceneFallback } from './scenePlan'
import { gatherScene } from './gather'
import { applyRecords } from './turn'
import { TurnSchema } from '@engine/state'
import { RECENT_USE_TURNS, recentlyUsed } from './repeats'

// A turn made by the `scene` pipeline (Milestone 5 plan, task 3): the game-master director, the scene writer, and
// everything after them reading the scene plan through its view.

/** The yard with Tobin knowing Mara, so he could see through her. */
function yard(): GameState {
  const state = yardScene(13)
  state.relations = [...state.relations, { from: 'tobin', to: 'mara', tags: [], note: 'has worked under her a year', meters: { warmth: 0, bond: 0 } }]
  return state
}

const LEDGER = {
  player_action: { doing: 'asks Mara about a second ledger', uncertain: false },
  checks: [{ id: 'read-mara', who: 'tobin', skill: 'notice', target: 'mara', stakes: 'Tobin sees the lie for what it is' }],
  focus: ['mara'],
  moments: [{ who: 'mara', feels: { shade: 'glum', intensity: 3, reason: 'the question she dreads' }, lands: 'the question she has no good answer to', wants: 'to close it down', pressure: 'keen' }],
  pressures: [{ who: 'mara', kind: 'secret', secret: 'mara.two-books', approach: 'lie' }],
  draws_on: [],
  stakes: 'whether Kit believes there is one book'
}

/** A scripted director and writer; `writes` are the writer's replies in order (a second is the rewrite). */
function scripted(plan: object | string, writes: string[]): TurnLlm & { prompts: Prompt[] } {
  const prompts: Prompt[] = []
  let n = 0
  return {
    prompts,
    direct: async (p) => (prompts.push(p), typeof plan === 'string' ? plan : JSON.stringify(plan)),
    write: async (p, onDelta) => {
      prompts.push(p)
      const text = writes[Math.min(n++, writes.length - 1)]!
      onDelta(text)
      return text
    }
  }
}

const SCENE = [
  'Mara: She closes the tally book. "One book, Kit. The Guild keeps one."',
  'Tobin: "Hm." He looks at the floor and says nothing more.',
  'NARRATION: The lamp over the gate ticks as it cools.',
  '[Mara: EXPRESSION guarded]',
  '[Tobin: EXPRESSION doubtful]'
].join('\n')

describe('a scene turn', () => {
  it('plays end to end: the scene plan rides along, its view is applied, and the turn keeps what was live', async () => {
    const llm = scripted(LEDGER, [SCENE])
    const out = await runTurn(fixture, yard(), 'Is there a second ledger, Mara?', llm, () => {}, { pipeline: 'scene', forceNatural: 15 })
    expect(out.trace.director.pipeline).toBe('scene')
    expect(out.plan.scene).toMatchObject({ pipeline: 'scene', focus: ['mara'], pressures: [{ who: 'mara', kind: 'secret', ref: 'mara.two-books', approach: 'lie' }] })
    // The rolled check reached the scene plan too.
    expect(out.plan.scene!.checks[0]!.result).toBeDefined()
    // A paragraph mixing action and speech is cut into beats; Tobin, present but not in focus, may speak.
    expect(out.beats.map((b) => b.kind)).toEqual(['narration', 'dialogue', 'dialogue', 'narration', 'narration'])
    expect(out.problems).toEqual([])
    const turn = out.state.scene!.turns.at(-1)!
    expect(turn.live).toEqual([{ who: 'mara', kind: 'secret', ref: 'mara.two-books' }])
    expect(turn.kept).toEqual(['mara.two-books'])
    expect(out.state.scene!.pressures['mara']).toBe(1)
    expect(out.state.scene!.expressions).toMatchObject({ mara: 'guarded', tobin: 'doubtful' })
  })

  it('falls back to the game’s own plan on an unreadable reply, at no extra call', async () => {
    const out = await runTurn(fixture, yard(), 'Evening.', scripted('Sorry, no plan.', ['NARRATION: The yard is quiet.\nMara: "Evening."']), () => {}, { pipeline: 'scene' })
    expect(out.fallback).toBe(true)
    expect(out.calls).toBe(2)
    expect(out.plan.scene!.pressures).toEqual([])
  })

  it('sends back a speaker saying what only someone else knows, and repeats only from the third', async () => {
    // Tobin can't know it, and he says it in the secret's own words. A paraphrase gets past this check by design; the
    // bookkeeper records such a line as his claim after the turn (milestone 4c).
    const leak = 'Tobin: "A second ledger records what the yard really takes in, Kit."\nMara: "Tobin."'
    const llm = scripted({ ...LEDGER, checks: [] }, [leak, SCENE])
    const out = await runTurn(fixture, yard(), 'Is there a second ledger, Mara?', llm, () => {}, { pipeline: 'scene' })
    expect(out.problems.map((p) => p.kind)).toContain('unowned-fact')
    expect(out.problems.find((p) => p.kind === 'unowned-fact')!.fix).toMatch(/^Beat 1: Tobin says what only Mara knows \("/)
    expect(out.calls).toBe(3)
  })
})

describe('the scene writer’s brief', () => {
  it('gives the moment, the undercurrent, the stakes and the rolls as events, and the format’s tag footer', async () => {
    const llm = scripted(LEDGER, [SCENE])
    await runTurn(fixture, yard(), 'Is there a second ledger, Mara?', llm, () => {}, { pipeline: 'scene', forceNatural: 2 })
    const writer = llm.prompts[1]!
    expect(writer.system).toMatch(/One continuous scene, written by one hand/)
    expect(writer.system).toMatch(/Then the tags, one per line/)
    // Everyone present is portrayed; the people in the moment get their voice cards.
    expect(writer.system).toMatch(/## Mara\n[\s\S]*### Mara's voice/)
    expect(writer.system).toMatch(/## Tobin\n(?![\s\S]*### Tobin's voice)/)
    expect(writer.user).toMatch(/# This moment\n- Mara: the question she has no good answer to\. Right now Mara wants to close it down\./)
    expect(writer.user).toMatch(/Underneath, Mara is keeping something \(lie\): /)
    expect(writer.user).toMatch(/# Also here \(they may react or say a little\)\n- Tobin\./)
    expect(writer.user).toContain("# What's at stake\nwhether Kit believes there is one book")
    expect(writer.user).toContain('# What the rolls decided (this happens; honor it)\n- Tobin fails. This does not happen: Tobin sees the lie for what it is. Show the attempt not coming off.')
    expect(writer.user).not.toContain('# The scene ends this turn')
  })

  it('says when the plan ends the scene', async () => {
    const llm = scripted({ ...LEDGER, checks: [], end_scene: true }, [SCENE])
    await runTurn(fixture, yard(), 'Goodnight, Mara.', llm, () => {}, { pipeline: 'scene' })
    expect(llm.prompts[1]!.user).toContain('# The scene ends this turn\nBring it to a close, and add [END SCENE].')
  })

  it('writes each roll as what happens', () => {
    const check = (degree: 'strong' | 'success' | 'cost' | 'failure') => checkEvent(fixture, { id: 'c', who: 'player', skill: 'notice', difficulty: 'routine', stakes: 'you spot the loose board.', result: { degree } as never })
    expect(check('success')).toBe('- You succeed: you spot the loose board.')
    expect(check('cost')).toBe('- You succeed, at a cost: you spot the loose board, and something goes wrong with it.')
    expect(check('failure')).toBe('- You fail. This does not happen: you spot the loose board. Show the attempt not coming off.')
  })
})


describe('the scene writer’s checks (fixes from the first scored run)', () => {
  const state = yard()
  const speakers = sceneSpeakers(fixture, state)

  it('spells out a contraction or a possessive when an action cut from a line takes the speaker’s name', () => {
    const narration = (line: string) => parseReply(line, speakers, { script: true }).beats.find((b) => b.kind === 'narration')
    // From play (2026-11-24): "She's" became "Mara's at the near end", and "He's got" "Tobin's got".
    expect(narration('Mara: She\'s at the near end with a coin. "He says that to everyone."')).toEqual({ kind: 'narration', text: 'Mara is at the near end with a coin.' })
    expect(narration('Tobin: He\'s got a washer going in his pocket. "That joint\'s weeping."')).toEqual({ kind: 'narration', text: 'Tobin has got a washer going in his pocket.' })
    expect(narration('Tobin: He’d been watching the door. "Late."')).toEqual({ kind: 'narration', text: 'Tobin had been watching the door.' })
    expect(narration('Mara: She\'d rather not. "No."')).toEqual({ kind: 'narration', text: 'Mara would rather not.' })
    expect(narration('Mara: She\'ll wait. "Fine."')).toEqual({ kind: 'narration', text: 'Mara will wait.' })
    expect(narration('Mara: Her coin walks a slow lap. "Go on."')).toEqual({ kind: 'narration', text: "Mara's coin walks a slow lap." })
    expect(narration('Mara: She sets the book down. "Go on."')).toEqual({ kind: 'narration', text: 'Mara sets the book down.' })
  })

  it('reads a speaker who starts partway through a line, in the script form only', () => {
    const line = 'Tobin looks at his boots. Mara: "One book, Kit." She closes it.'
    expect(parseReply(line, speakers, { script: true }).beats).toEqual([
      { kind: 'narration', text: 'Tobin looks at his boots.' },
      { kind: 'dialogue', speaker: 'mara', text: 'One book, Kit.' },
      { kind: 'narration', text: 'Mara closes it.' }
    ])
    expect(parseReply(line, speakers).beats).toHaveLength(1)
    // A label that names no one here is ordinary prose.
    expect(parseReply('NARRATION: The sign is clear. Rule: no carts after dark.', speakers, { script: true }).beats).toHaveLength(1)
  })

  it('takes "[Name: WORD]" as what the face shows, in the script form only', () => {
    expect(parseReply('Mara: "Fine."\n[Mara: WARY]', speakers, { script: true }).tags.expressions).toEqual({ mara: 'wary' })
    expect(parseReply('Mara: "Fine."\n[Mara: WARY]', speakers).droppedTags).toEqual(['[Mara: WARY]'])
  })

  it('measures a scene in words, not in the beats the cutter makes, and never cuts it', () => {
    const plan = sceneView(sceneFallback(state, gatherScene(fixture, state, 'Evening.')))
    const short = Array.from({ length: 8 }, (_, i) => `Mara: "Count ${i}." She ticks it.`).join('\n')
    const parsedShort = parseReply(short, speakers, { script: true })
    expect(parsedShort.beats).toHaveLength(16)
    expect(checkReply(parsedShort, plan, speakers, 'Evening.', [], { alsoSpeaking: ['mara', 'tobin'] }).map((p) => p.kind)).not.toContain('beat-count')
    const long = Array.from({ length: 8 }, () => `Mara: "${'count it again and again '.repeat(6).trim()}."`).join('\n')
    const kinds = checkReply(parseReply(long, speakers, { script: true }), plan, speakers, 'Evening.', [], { alsoSpeaking: ['mara', 'tobin'] }).map((p) => p.kind)
    expect(kinds).toContain('scene-length')
    expect(salvaged(16, [], false)).toHaveLength(16)
    expect(salvaged(16, [])).toHaveLength(12)
  })

  it('lets someone say what they know from lore, and passes over runs of everyday words', () => {
    const extra = (knowledge: string[]) => ({ ...fixture, characters: fixture.characters.map((c) => (c.id === 'mara' ? { ...c, knowledge: [...c.knowledge, ...knowledge] } : c)) })
    const said = (content: typeof fixture, line: string) => ownedProblems(content, state, parseReply(line, sceneSpeakers(content, state), { script: true })).map((p) => p.kind)
    // Tobin is a porter, and porters know how the tallies are rounded.
    const tallies = extra(['Every tally is rounded up a crate or two at the gate'])
    expect(said(tallies, 'Tobin: "Every tally is rounded up a crate or two."')).toEqual([])
    // Only Mara knows this one, and nothing open to Tobin says it.
    const gin = extra(['The night foreman drinks cheap gin behind the stables'])
    expect(said(gin, 'Tobin: "The night foreman drinks cheap gin, you know."')).toEqual(['unowned-fact'])
    expect(said(gin, 'Tobin: "It was in the yard after all, Kit."')).toEqual([])
  })
})

describe('the place’s details for the scene writer', () => {
  it('offers the place’s details, less any the last turns used', async () => {
    const state = yard()
    const llm = scripted(LEDGER, [SCENE])
    await runTurn(fixture, state, 'Is there a second ledger, Mara?', llm, () => {}, { pipeline: 'scene' })
    expect(llm.prompts[1]!.user).toMatch(/# The place's details \(use one or two in the narration\)\n- /)
    const texture = { sights: ['a lamp swinging over the scales', 'crates stacked to the rafters'], sounds: ['gulls over the water'], smells: ['tar'] }
    const scene = { ...state.scene!, turns: [{ ...state.scene!.turns[0]!, beats: [{ kind: 'narration' as const, text: 'The lamp over the scales swings once.' }] }] }
    expect(placeDetails(texture, scene)).toEqual(['crates stacked to the rafters', 'gulls over the water', 'tar'])
  })
})

describe('what the player has heard, on the scene pipeline (task 4, Q12)', () => {
  const TALLIES = {
    player_action: { doing: 'asks how the tallies work', uncertain: false },
    focus: ['tobin'],
    moments: [{ who: 'tobin', lands: 'a question he can answer', wants: 'to explain', pressure: 'idle' }],
    draws_on: [{ who: 'tobin', facts: ['lore.faction.guild.tallies'] }],
    stakes: 'whether Kit learns how the tallies work'
  }
  const SAID = 'Tobin: "The tallies are rounded in the Guild\'s favor. Always have been."\n[Tobin: EXPRESSION frank]'

  it('a pool fact a line said is heard: it joins told, leaves the pool, and the writer lists it as told', async () => {
    const out = await runTurn(fixture, yardScene(13), 'How do the tallies work?', scripted(TALLIES, [SAID]), () => {}, { pipeline: 'scene' })
    const scene = out.state.scene!
    expect(scene.told).toContain('lore.faction.guild.tallies')
    expect(scene.turns.at(-1)!.toldFacts).toEqual(['lore.faction.guild.tallies'])
    expect((gatherScene(fixture, out.state, 'How do the tallies work?').pools['tobin'] ?? []).map((f) => f.id)).not.toContain('lore.faction.guild.tallies')
    const next = scripted({ ...TALLIES, draws_on: [] }, ['Tobin: "Same as ever."'])
    await runTurn(fixture, out.state, 'And the watch?', next, () => {}, { pipeline: 'scene' })
    expect(next.prompts[1]!.user).toContain("# What the player has been told this scene\n- The tallies are rounded in the Guild's favor.")
    // Applying the same records again changes nothing.
    expect(applyRecords(out.state, scene.turns.at(-1)!.records!)).toEqual(out.state)
  })
})

describe('the director’s concrete details (task 4: a move’s `new`)', () => {
  const PRICE = {
    player_action: { doing: 'asks what the crates cost', uncertain: false },
    focus: ['mara'],
    moments: [{ who: 'mara', lands: 'a price question', wants: 'to quote it', pressure: 'idle' }],
    details: [{ who: 'mara', text: 'two pennies a crate' }, { who: 'tobin', text: 'the gate shuts at nine' }, { who: 'mara', text: 'Tobin let someone in after closing' }],
    stakes: 'whether Kit pays'
  }

  it('joins the person’s pool as a short fact, never a secret, and once said is common ground', async () => {
    const llm = scripted(PRICE, ['Mara: "Two pennies a crate, Kit. Take it or leave it."'])
    const out = await runTurn(fixture, yardScene(13), 'What do the crates cost?', llm, () => {}, { pipeline: 'scene' })
    expect(out.plan.scene!.pools['mara']).toEqual([{ id: 'detail.1.1', text: 'two pennies a crate', source: 'plan', unheard: true }])
    expect(out.trace.director.corrections).toEqual(expect.arrayContaining(['dropped the detail for "tobin": not in focus', 'dropped mara\'s detail "Tobin let someone in after closing": it says a secret']))
    expect(llm.prompts[1]!.user).toContain('May draw on, if a line needs it: two pennies a crate [new to the player]')
    expect(out.state.scene!.newFacts).toEqual([expect.objectContaining({ text: 'two pennies a crate', by: 'mara' })])
  })
})

describe('gestures over the whole scene, on the scene pipeline (task 8)', () => {
  it('lists a gesture from three turns back, which the two-turn window lost', () => {
    const state = yardScene(13)
    const scene = state.scene!
    const old = (beats: { kind: 'narration'; text: string }[], n: number) => ({ ...scene.turns[0]!, id: `old-${n}`, beats })
    const turns = [old([{ kind: 'narration', text: 'Mara straightens her ledger.' }], 1), old([{ kind: 'narration', text: 'Tobin shrugs.' }], 2), old([{ kind: 'narration', text: 'The lamp hisses.' }], 3)]
    const later = { ...scene, turns }
    expect(recentlyUsed(fixture, later)['mara']).toBeUndefined()
    expect(recentlyUsed(fixture, later, RECENT_USE_TURNS, later.turns.length)['mara']).toEqual({ slang: [], gestures: ['straightens her ledger'] })
  })
})

describe('a portrait without the habits already shown this scene (task 8)', () => {
  const PORTRAIT = 'A broker in a pressed coat. She turns her glass by the stem while she listens. Her laugh comes a beat late.'

  it('drops the sentence with a used habit, keeps the rest, and keeps the whole portrait when nothing was used', () => {
    expect(portraitNow(PORTRAIT, ['turns her glass by the stem'])).toBe('A broker in a pressed coat. Her laugh comes a beat late.')
    expect(portraitNow(PORTRAIT, ['taps the table'])).toBe(PORTRAIT)
    // Another verb for the same glass still counts: the writer varies it.
    expect(portraitNow(PORTRAIT, ['sets her glass down'])).toBe('A broker in a pressed coat. Her laugh comes a beat late.')
    expect(portraitNow(PORTRAIT, [])).toBe(PORTRAIT)
  })

  it('in the writer’s brief, once the habit is in the scene', async () => {
    const content = { ...fixture, characters: fixture.characters.map((c) => (c.id === 'mara' ? { ...c, portrait: `${c.portrait} She straightens her ledger when she is nervous.` } : c)) }
    const state = yardScene(13)
    const earlier = TurnSchema.parse({ id: 'earlier', player: 'Busy?', beats: [{ kind: 'narration', text: 'Mara straightens her ledger.' }] })
    const turned = { ...state, scene: { ...state.scene!, turns: [earlier] } }
    const plan = { player_action: { doing: 'greets her', uncertain: false }, focus: ['mara'], moments: [{ who: 'mara', lands: 'a greeting', wants: 'to finish', pressure: 'idle' }], stakes: 'none' }
    const first = scripted(plan, ['Mara: "Evening."'])
    await runTurn(content, state, 'Evening.', first, () => {}, { pipeline: 'scene' })
    expect(first.prompts[1]!.system).toContain('She straightens her ledger when she is nervous.')
    const later = scripted(plan, ['Mara: "Evening."'])
    await runTurn(content, turned, 'Evening.', later, () => {}, { pipeline: 'scene' })
    expect(later.prompts[1]!.system).not.toContain('She straightens her ledger when she is nervous.')
    expect(later.prompts[1]!.system).toContain('She notices numbers that are off.')
    expect(later.prompts[1]!.user).toContain('- Mara: straightens her ledger')
  })
})
