import type { Pack } from '@engine/pack'
import { directorRules } from './director'
import { ADULTS_ONLY, BEATS, OVERUSED_PHRASES, STYLE_GUIDE } from './style'
import { WRITER_FORMAT } from './writer'

/**
 * The fixed text the turn prompts are built from: the director's rules, the writer's format, the style guide, the
 * phrase lists, the beat budget and the pack's tone. The logs record a hash of it as the prompt version, so two runs
 * can be told apart when any of it changed. Per-turn material (the scene, the plan) is not part of it.
 */
export function promptSources(content: Pack): string[] {
  return [directorRules(content.ruleset), WRITER_FORMAT, STYLE_GUIDE, ADULTS_ONLY, JSON.stringify(BEATS), OVERUSED_PHRASES.join('\n'), content.phrases.join('\n'), content.tone]
}
