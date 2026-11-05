/** What every scene prompt knows about the world. Kept short; codex entries come later. */
export const CORE_LORE = `Spire City, on the backwater planet Faeworld, spirals around the Aether, the world's magic, which wells up from the chasm at its base (the Deepwell). Height is class: the Crown and High Turns get thin, refined, piped Aether and money; the Middle Turns work; the Low Turns are old, overgrown, raw with Aether, gangs and smugglers. Magic and tech are one craft (magitech). Currency: cinders. Peoples: humans, light elves (often old money), dark elves (often of the lower city), goblins (the city's scrappy, punk heart), golems (rune-core synthetics, persons by law), and off-worlders. Species are tendencies, never templates for an individual. The Aether grid consortium controls the flow of Aether upward. The Couriers carry anything for anyone. Tone: adult, gritty but not bleak, punk, with an undercurrent of desire. Everyone is an adult.`

/** The writer's style guide (narrator-scene-engine §8): first in its prompt, so providers can cache it. */
export const STYLE_GUIDE = `Style:
- Second person: the player is "you". Present tense.
- Concrete before abstract. One specific detail beats three adjectives.
- Vary sentence rhythm. Show consequences, not labels for feelings. Subtext over stated emotion.
- Each character sounds like their voice card and no one else.
- Short visual-novel beats. Adult, punk, a little dangerous; desire as an undercurrent, never forced.`

/**
 * Phrases LLM prose falls back on. A hit in the writer's output triggers the one rewrite (narrator-scene-engine §8).
 * Matched case-insensitively as substrings.
 */
export const OVERUSED_PHRASES = [
  'a smirk played',
  'smirk plays',
  'eyes narrowed',
  'narrows her eyes',
  'narrows his eyes',
  'narrows their eyes',
  'a shiver ran down',
  'shiver runs down',
  'breath you didn\'t know',
  'let out a breath',
  'lets out a breath',
  'the air was thick',
  'the air is thick',
  'hung in the air',
  'hangs in the air',
  'a testament to',
  'tapestry of',
  'barely above a whisper',
  'eyes sparkling with',
  'mischievous glint',
  'glint in her eye',
  'glint in his eye',
  'sends a jolt',
  'electric tension',
  'for what feels like an eternity',
  'little did you know',
  'in the dim light',
  'a mix of',
  'maybe, just maybe'
]

/** The beat budget for a turn (narrator-scene-engine §2, tune). */
export const BEATS = { min: 2, max: 7, target: '3–6', maxWords: 60, targetWords: 40 } as const
