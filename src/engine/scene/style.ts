/**
 * The writer's style guide (narrator-scene-engine §8), first in its prompt so providers can cache it. The pack's tone
 * follows it; this part holds for every game.
 */
export const STYLE_GUIDE = `Style:
- Second person: the player is "you". Present tense.
- Concrete before abstract. One specific detail beats three adjectives.
- Vary sentence rhythm. Show consequences, not labels for feelings. Subtext over stated emotion.
- Each character sounds like their voice card and no one else.
- Short visual-novel beats.`

/** Said in every scene prompt, whatever the pack: the engine's adult-content guard, which packs can't turn off. */
export const ADULTS_ONLY = 'Every character is an adult.'

/**
 * Phrases LLM prose falls back on, in any world; a pack adds its own. A hit in the writer's output triggers the one rewrite (narrator-scene-engine §8).
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

/**
 * The beat budget for a turn (narrator-scene-engine §2, tune). Speech and action are separate beats (milestone 2,
 * round 0 F1), so a turn needs more of them than when one beat could hold both.
 */
export const BEATS = { min: 2, max: 10, target: '4–8', maxWords: 60, targetWords: 40 } as const
