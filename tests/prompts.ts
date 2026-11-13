import type { Prompt } from '@engine/core'
import type { Pack } from '@engine/pack'
import type { GameState } from '@engine/state'
import { runTurn, type TurnLlm } from '@engine/scene'
import { endScene, witnesses } from '@engine/relationships'

/**
 * Prompt snapshots (milestone 3.6, task 2): plays a scripted scene through the real turn pipeline and the end of the
 * scene, and renders every prompt sent and everything the turns decided as text. A refactor meant to change nothing
 * must leave both texts unchanged; a change meant to alter prompts or behavior updates them in the same commit.
 */

/** One scripted turn: what the player does, the director's reply, and the writer's replies (a second one is the rewrite). */
export interface ScriptedTurn {
  input: string
  plan: object | string
  writes: string[]
}

export interface PlayedScene {
  /** Every prompt, in the order sent. */
  prompts: string
  /** What each turn decided, and the end-of-scene summaries. */
  record: string
  state: GameState
}

/** Pack text read on Windows keeps its CRLF line ends; snapshots compare the same on every platform. */
const lf = (s: string) => s.replace(/\r\n?/g, '\n')
const json = (value: unknown) => lf(JSON.stringify(value, null, 2))
const promptText = (heading: string, p: Prompt) => `===== ${heading} =====\n----- system -----\n${lf(p.system)}\n----- user -----\n${lf(p.user)}\n`

export async function playScene(content: Pack, start: GameState, turns: ScriptedTurn[], summaries: Record<string, object | string> = {}): Promise<PlayedScene> {
  const prompts: string[] = []
  const record: string[] = []
  let state = start
  for (const [i, t] of turns.entries()) {
    const n = i + 1
    const writes = [...t.writes]
    let written = 0
    const llm: TurnLlm = {
      async direct(prompt) {
        prompts.push(promptText(`turn ${n}: director`, prompt))
        return typeof t.plan === 'string' ? t.plan : JSON.stringify(t.plan)
      },
      async write(prompt, onDelta) {
        prompts.push(promptText(`turn ${n}: ${written++ === 0 ? 'writer' : 'rewrite'}`, prompt))
        const reply = writes.shift() ?? ''
        onDelta(reply)
        return reply
      }
    }
    const outcome = await runTurn(content, state, t.input, llm, () => {}, { now: () => 0 })
    state = outcome.state
    const { turns: _turns, ...scene } = state.scene!
    record.push(
      `===== turn ${n} =====\n${json({
        input: t.input,
        fallback: outcome.fallback,
        corrections: outcome.corrections,
        plan: outcome.trace.director.plan,
        checks: outcome.trace.checks,
        lore: outcome.trace.lore,
        brief: outcome.trace.brief,
        findings: outcome.problems,
        remaining: outcome.remaining,
        salvage: outcome.trace.rewrite?.salvage,
        beats: outcome.beats,
        tags: outcome.trace.tags,
        scene
      })}\n`
    )
  }
  // endScene asks for every witness's summary at once, in witness order, so the nth call is the nth witness.
  const order = witnesses(state)
  let asked = 0
  const ended = await endScene(
    content,
    state,
    async (prompt) => {
      const id = order[asked++]!
      prompts.push(promptText(`summary: ${id}`, prompt))
      const reply = summaries[id]
      return reply === undefined ? '' : typeof reply === 'string' ? reply : JSON.stringify(reply)
    },
    () => 0
  )
  record.push(`===== end of scene =====\n${json({ witnesses: ended.trace.witnesses.map(({ callId: _c, ...w }) => w) })}\n`)
  return { prompts: prompts.join('\n'), record: record.join('\n'), state: ended.state }
}
