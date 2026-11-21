import type { Prompt } from '@engine/core'
import type { Pack } from '@engine/pack'
import type { GameState } from '@engine/state'
import { runTurn, type TurnLlm, buildBriefs, buildSceneDirectorPrompt, gatherScene, parseScenePlan, turnLore, validateScenePlan } from '@engine/scene'
import { endScene, judgeScene, witnesses } from '@engine/relationships'
import { answerTie } from '@engine/state'

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
  /** What each turn decided, and what the end of the scene did. */
  record: string
  state: GameState
}

/** Pack text read on Windows keeps its CRLF line ends; snapshots compare the same on every platform. */
const lf = (s: string) => s.replace(/\r\n?/g, '\n')
const json = (value: unknown) => lf(JSON.stringify(value, null, 2))
const promptText = (heading: string, p: Prompt) => `===== ${heading} =====\n----- system -----\n${lf(p.system)}\n----- user -----\n${lf(p.user)}\n`

/**
 * `replies`: each witness's end-of-scene reply, by id. One reply holds both of their calls' answers (the relationship
 * call's meters, feelings and ties, and the memory call's memories), and each call reads its own fields from it.
 * `answer`: how the player answers any relationship change that waits on them (milestone 4b); yes by default.
 */
export async function playScene(content: Pack, start: GameState, turns: ScriptedTurn[], replies: Record<string, object | string> = {}, answer = true): Promise<PlayedScene> {
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
  const replyOf = (id: string) => {
    const reply = replies[id]
    return reply === undefined ? '' : typeof reply === 'string' ? reply : JSON.stringify(reply)
  }
  // Both halves ask every witness at once, in witness order, so the nth call is the nth witness.
  const order = witnesses(state)
  let asked = 0
  // The relationship calls, and the ties settled from them; changes waiting on the player are answered before the memory calls.
  const judged = await judgeScene(
    content,
    state,
    async (prompt) => {
      const id = order[asked++]!
      prompts.push(promptText(`relationship: ${id}`, prompt))
      return replyOf(id)
    },
    () => 0
  )
  state = judged.state
  while (state.scene!.pendingTies.length > 0) state = answerTie(content, state, 0, answer)
  const { calls: _calls, witnesses: said, ...tieRecord } = judged.trace
  record.push(`===== relationship calls =====\n${json({ witnesses: said.map(({ callId: _c, ...w }) => w), ...tieRecord, answered: state.scene!.answered })}\n`)
  asked = 0
  const ended = await endScene(
    content,
    state,
    async (prompt) => {
      const id = order[asked++]!
      prompts.push(promptText(`memory: ${id}`, prompt))
      return replyOf(id)
    },
    () => 0
  )
  record.push(`===== end of scene =====\n${json({ witnesses: ended.trace.witnesses.map(({ callId: _c, ...w }) => w) })}\n`)
  return { prompts: prompts.join('\n'), record: record.join('\n'), state: ended.state }
}

/** One scripted moment for the scene director: a state, what the player says, and the director's scripted reply. */
export interface SceneMoment {
  heading: string
  state: GameState
  input: string
  reply: object
}

/**
 * The `scene` pipeline's director on scripted moments (Milestone 5 plan, task 2), before it can play a turn: each
 * moment's prompt, and what the game gathered and validated from the scripted reply. A refactor must leave both
 * unchanged, as with the situation pipeline's snapshots.
 */
export function sceneDirector(content: Pack, moments: SceneMoment[]): Omit<PlayedScene, 'state'> {
  const prompts: string[] = []
  const record: string[] = []
  for (const m of moments) {
    const lore = turnLore(content, m.state, m.input)
    const briefs = buildBriefs(content, m.state, m.input, lore)
    const gathered = gatherScene(content, m.state, m.input, lore, briefs)
    prompts.push(promptText(`${m.heading}: scene director`, buildSceneDirectorPrompt(content, m.state, m.input, lore, briefs, gathered)))
    const raw = parseScenePlan(JSON.stringify(m.reply))
    record.push(`===== ${m.heading} =====\n${json({ gathered, ...(raw ? validateScenePlan(content, m.state, raw, gathered, m.input) : { unreadable: true }) })}\n`)
  }
  return { prompts: prompts.join('\n'), record: record.join('\n') }
}
