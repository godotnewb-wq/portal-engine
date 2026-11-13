// Every import form the architecture test must read (milestone 3.6, task 3). It is parsed, never run; the test
// checks how each form is read and that the rules catch the forbidden ones when the file is judged as if it sat in
// the engine or the renderer. Double quotes on purpose: the old regex reader missed them.
import { SaveStore } from "@platform/saves"
import type { Pack } from '@engine/pack'
import { type GameState } from "@engine/state"
import * as llm from '@llm'
import type * as settings from "@platform/settings"
import '@engine/core'
export { runTurn } from "@engine/scene"
export type { Ruleset } from '@engine/rules'
export * from '@engine/codex'

export const store = SaveStore
export type Pair = [Pack, GameState]
export type Settings = typeof settings
export type Reader = typeof import("@platform/logs").readSession
export const client = llm
export const later = () => import("@platform/logs")
