import { describe, expect, it } from 'vitest'
import { npmSwallowed } from '../tools/bench/config'

describe('the bench options npm kept for itself', () => {
  it('names each bench option npm set as its own config', () => {
    expect(npmSwallowed({ npm_config_score: 'true', npm_config_pipeline: 'true', npm_config_no_summaries: 'true', npm_config_cache: '/x' })).toEqual(['--no-summaries', '--score', '--pipeline'])
  })

  it('finds none when the options came after --', () => {
    expect(npmSwallowed({ npm_config_cache: '/x' })).toEqual([])
  })
})
