import type { Character, VoiceCard } from '@engine/characters'
import type { GameState } from '@engine/state'
import type { Speaker } from './beats'
import type { Degree } from '@engine/rules'
import { characterById, locationById, type Pack } from '@engine/pack'
import { RECENT_TURNS, turnText } from './director'
import { type Prompt } from '@engine/core'
import { firstName } from '@engine/core'
import { presentCast, type BeatPlan, type PlannedCheck } from './plan'
import { ADULTS_ONLY, BEATS, STYLE_GUIDE } from './style'

/** Everyone a beat or tag may name in this scene: the cast present, the walk-ons, and the player. */
export function sceneSpeakers(content: Pack, state: GameState): Speaker[] {
  const scene = state.scene!
  const location = locationById(content, scene.locationId)!
  const cast = presentCast(scene).map((id): Speaker => {
    const c = characterById(content, id)!
    return { id, names: [c.id, c.name, firstName(c.name)], kind: 'cast' }
  })
  const walkOns = location.walkOns
    .filter((w) => scene.walkOns.includes(w.id))
    .map((w): Speaker => ({ id: w.id, names: [w.id, w.label, w.label.replace(/^the\s+/i, ''), ...(w.name ? [w.name] : [])], kind: 'walk-on' }))
  const player: Speaker = { id: 'player', names: [state.player.name, 'you', 'player'], kind: 'player' }
  return [...cast, ...walkOns, player]
}

export const WRITER_FORMAT = `Output format, nothing else:
- One beat per line. A narration beat: "NARRATION: …". A dialogue beat: "Name: …" (the character's first name), their spoken words with at most a brief action.
- ${BEATS.target} beats, each under ${BEATS.targetWords} words.
- Only the planned speakers get dialogue beats. Others appear only as their planned reactions, inside narration. A planned walk-on line may be a dialogue beat under the walk-on's name.
- Hidden tags at the end, one per line: [Name: EXPRESSION word] for each speaker; [Name: COMFORT 1-5 reason] when someone's comfort changes; [Name: MOOD words] when a mood shifts; [LEAVES: Name] for a planned departure; [END SCENE] only if the plan ends the scene.
- Never write the player's words, choices, thoughts or actions beyond what their input stated.
- Honor every check result exactly: a failed roll means it does not happen.`

function voiceCard(name: string, v: VoiceCard): string {
  return [
    `## ${name}'s voice`,
    `Rhythm: ${v.rhythm}`,
    `Vocabulary: ${v.vocabulary}`,
    v.slang.length > 0 && `Slang: ${v.slang.join(', ')}`,
    v.avoids.length > 0 && `Avoids: ${v.avoids.join('; ')}`,
    `Sample lines: ${v.sampleLines.map((l) => `"${l}"`).join(' ')}`,
    `When angry: ${v.shifts.angry}. Flirting: ${v.shifts.flirting}. Lying: ${v.shifts.lying}.`
  ]
    .filter(Boolean)
    .join('\n')
}

const OUTCOME: Record<Degree, (stakes: string) => string> = {
  strong: (s) => `strong success: ${s}, with an extra benefit`,
  success: (s) => `success: ${s}`,
  cost: (s) => `success at a cost: ${s}, but add a complication`,
  failure: (s) => `FAILURE: this does not happen: ${s}`
}

function checkLine(content: Pack, state: GameState, check: PlannedCheck): string {
  const who = check.who === 'player' ? state.player.name : firstName(characterById(content, check.who)!.name)
  return `- ${who}'s ${check.skill} check [${check.id}]: ${check.result ? OUTCOME[check.result.degree](check.stakes) : check.stakes}`
}

/** What the writer needs for one beat, and nothing more (narrator-scene-engine §5). */
export function buildWriterPrompt(content: Pack, state: GameState, plan: BeatPlan, input: string): Prompt {
  const scene = state.scene!
  const location = locationById(content, scene.locationId)!
  const speakers = plan.speakers.map((s) => characterById(content, s.id)!) as Character[]
  const nameOf = (id: string) => firstName(characterById(content, id)?.name ?? id)
  const walkOn = (id: string) => location.walkOns.find((w) => w.id === id)!

  const system = [
    'You write the prose of a visual-novel RPG scene from a director\'s plan.',
    STYLE_GUIDE,
    content.tone && `Tone:\n${content.tone}`,
    ADULTS_ONLY,
    WRITER_FORMAT,
    `The player is ${state.player.name} (${state.player.pronouns}), addressed as "you". Setting: ${location.name}, ${location.district}, ${content.setting.name}.`,
    ...speakers.map((c) => voiceCard(firstName(c.name), c.voice))
  ]
    .filter(Boolean)
    .join('\n\n')

  const brief = [
    '# This beat',
    ...plan.speakers.map((s) => {
      const c = characterById(content, s.id)!
      return [
        `- ${firstName(c.name)} speaks. Intent: ${s.intent}`,
        s.mood && `  Mood: ${s.mood}`,
        s.knows && `  Knows: ${s.knows}`,
        s.hiding && `  Hiding: ${s.hiding}. Approach: ${s.approach ?? 'deflect'}.`,
        s.depends_on_check && `  Their line depends on check ${s.depends_on_check}.`,
        `  Look: ${c.appearance}`
      ]
        .filter(Boolean)
        .join('\n')
    }),
    ...plan.reactions.map((r) => `- ${nameOf(r.id)} (no dialogue): ${r.beat}`),
    ...plan.walk_ons.map((w) => `- ${walkOn(w.id).name ?? walkOn(w.id).label} (${walkOn(w.id).label}; ${walkOn(w.id).manner}): ${w.line}`),
    plan.checks.length > 0 && `# Check results (decided; honor them)\n${plan.checks.map((c) => checkLine(content, state, c)).join('\n')}`,
    plan.texture.length > 0 && `# Texture to use\n${plan.texture.map((t) => `- ${t}`).join('\n')}`,
    plan.contrast && `# Voice contrast\n${plan.contrast}`,
    plan.avoid.length > 0 && `# Avoid\n${plan.avoid.join('; ')}`,
    plan.leaves.length > 0 && `# Leaving this beat\n${plan.leaves.map(nameOf).join(', ')}`,
    plan.end_scene && '# The scene closes with this beat. End with [END SCENE].'
  ].filter(Boolean)

  const recent = scene.turns.slice(-RECENT_TURNS)
  const user = [
    scene.summary && `# Earlier in the scene\n${scene.summary}`,
    recent.length > 0 && `# Last turns\n${recent.map((t) => turnText(content, state.player.name, t)).join('\n\n')}`,
    brief.join('\n'),
    `# The player says or does\n${input}`,
    'Write the beats.'
  ]
    .filter(Boolean)
    .join('\n\n')

  return { system, user }
}

/** The one targeted rewrite (call 3), told exactly what to fix. */
export function buildRewritePrompt(writer: Prompt, reply: string, problems: string[]): Prompt {
  return {
    system: writer.system,
    user: `${writer.user}\n\n# Your draft\n${reply}\n\n# Fix these, change nothing else, and return the whole turn in the same format\n${problems.map((p) => `- ${p}`).join('\n')}`
  }
}
