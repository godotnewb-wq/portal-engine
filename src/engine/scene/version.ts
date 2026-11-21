import type { Pack } from '@engine/pack'
import { directorRules } from './director'
import { DEFAULT_PIPELINE, type Pipeline } from './pipeline'
import { BEATS, OVERUSED_PHRASES } from './style'
import { WRITER_FORMAT, WRITER_STYLE } from './writer'

/**
 * The fixed text a pipeline's turn prompts are built from: the director's rules, the writer's style and format, the
 * phrase lists, the beat budget and the pack's tone. The logs record a hash of it as the prompt version, so two runs
 * can be told apart when any of it changed. Per-turn material (the scene, the plan) is not part of it.
 *
 * Each pipeline hashes only its own text (Milestone 5 plan, task 0b), so a change to one pipeline's prompts doesn't
 * move the other's version. The pipeline's name isn't hashed: `situation` keeps the version its runs had before the
 * choice existed, so they stay comparable.
 */
export function promptSources(content: Pack, pipeline: Pipeline = DEFAULT_PIPELINE): string[] {
  switch (pipeline) {
    case 'situation':
      return [directorRules(content.ruleset), WRITER_STYLE, WRITER_FORMAT, JSON.stringify(BEATS), OVERUSED_PHRASES.join('\n'), content.phrases.join('\n'), content.tone]
  }
}
