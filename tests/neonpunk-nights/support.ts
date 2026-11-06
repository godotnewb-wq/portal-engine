import { join } from 'node:path'
import { loadPack } from '@platform/packs'
import type { GameState } from '@engine/state'
import type { Pack } from '@engine/pack'
import { createInitialState, startScene } from '@engine/state'

/** The Neonpunk Nights pack as shipped, for its tests. */
export const PACK_DIR = join(__dirname, '../../packs/neonpunk-nights')
export const content: Pack = loadPack(PACK_DIR)

/** The milestone 1 bar scene, freshly opened, with a fixed seed. */
export function barScene(seed = 1): GameState {
  return startScene(content, createInitialState(content, seed), 'sump-lantern', ['vex', 'brask', 'oria-senn'])
}
