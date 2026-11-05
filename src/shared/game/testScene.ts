import { join } from 'node:path'
import { loadContent } from '../../main/content/load'
import type { GameState } from '../model'
import type { Content } from './content'
import { createInitialState, startScene } from './state'

/** The shipped content, for tests. */
export const content: Content = loadContent(join(__dirname, '../../../content/default'))

/** The milestone 1 bar scene, freshly opened, with a fixed seed. */
export function barScene(seed = 1): GameState {
  return startScene(content, createInitialState(content, seed), 'sump-lantern', ['vex', 'brask', 'oria-senn'])
}
