/**
 * The ways a scene turn can be made (scene system redesign §9; Milestone 5 plan, task 0b). `situation` is the turn
 * in code since Milestone 2 and the only one since 3.6 removed `lines`. Milestone 5 builds `scene` beside it, so the
 * two can be played on the same scenarios and compared, and then removes `situation`.
 */
export const PIPELINES = ['situation'] as const

export type Pipeline = (typeof PIPELINES)[number]

/** The pipeline a turn runs when none is chosen, and the one logs from before the choice existed were made with. */
export const DEFAULT_PIPELINE: Pipeline = 'situation'

/** Whether a string from outside the type system (a command-line flag, a settings file) names a pipeline. */
export const isPipeline = (value: string): value is Pipeline => (PIPELINES as readonly string[]).includes(value)
