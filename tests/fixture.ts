import { join } from 'node:path'
import type { Pack } from '@engine/pack'
import { createInitialState, startScene, type GameState } from '@engine/state'
import { loadPack } from '@platform/packs'

/**
 * The test-fixture pack, which engine tests run against. Its ruleset is deliberately unlike any game's (other
 * attribute and skill names, another difficulty table, two meters on 0–20), so an engine test that only passes with
 * one game's numbers fails here.
 */
export const FIXTURE_DIR = join(__dirname, '../packs/test-fixture')
export const fixture: Pack = loadPack(FIXTURE_DIR)

/** The fixture's opening scene, freshly started. */
export function yardScene(seed = 1): GameState {
  const { location, cast } = fixture.manifest.start
  return startScene(fixture, createInitialState(fixture, seed), location, cast)
}
