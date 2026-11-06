import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { GameState, Turn } from '@engine/state'
import { flagKey, type Flag, type FlagRecord } from '@engine/review'
import type { TurnDetails as Details } from '@platform/logs'
import { characterById, locationById, type Pack } from '@engine/pack'
import { firstName } from '@engine/core'
import { presentCast } from '@engine/scene'
import { speciesById } from '@engine/world'
import { Button } from './Button'
import { atEnd, awaitingBeat, beatCounter, canAdvance, canGoBack, nameplate, sceneHistory, streamingBeats, type Reading, type ShownBeat } from './reading'
import { FlagPanel } from './FlagPanel'
import { SpriteStage } from './SpriteStage'
import { TurnDetails } from './TurnDetails'

interface Props {
  content: Pack
  state: GameState
  onState: (next: GameState) => void
  /** Ends the scene: summaries run and the summary screen follows. */
  onEnd: () => void
  onSave: () => void
  /** Why ending the scene failed, if it did. */
  endError: string
}

const COMFORT_WORD = ['', 'wants out', 'uneasy', 'all right', 'comfortable', 'at ease']

/** What the flag panel is open on: a beat of a turn, or (no beat) the whole turn. */
interface FlagTarget {
  turn: Turn
  beat?: number
}

/** The key a flag on a beat or turn is kept under, here and in the logs. */
const keyOf = (turn: Turn, beat?: number) => flagKey({ turnSession: turn.log ?? '', turnId: turn.id, ...(beat !== undefined && { beat }) })

/**
 * The scene: the stage, the text box read a beat at a time, and the player's line. A reply streams in and its
 * beats can be read as they arrive. A click, Space, Enter or → turns to the next beat; ← or the wheel turned up goes
 * back through the scene, which changes nothing.
 */
export function SceneView({ content, state, onState, onEnd, onSave, endError }: Props) {
  const scene = state.scene!
  const location = locationById(content, scene.locationId)!
  const history = useMemo(() => sceneHistory(content, state), [content, state])

  // A fresh scene is read from its opening; one returned to, from where it stands.
  const [index, setIndex] = useState(() => (scene.turns.length === 0 ? 0 : Math.max(0, history.length - 1)))
  const [busy, setBusy] = useState(false)
  const [streamed, setStreamed] = useState('')
  const [planned, setPlanned] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [flags, setFlags] = useState<Map<string, FlagRecord>>(new Map())
  const [flagging, setFlagging] = useState<FlagTarget | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [details, setDetails] = useState<Map<string, Details | null>>(new Map())
  const turnStart = useRef(0)
  const turned = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      window.api.onSceneEvent((event) => {
        if (event.type === 'delta') setStreamed((s) => s + event.text)
        else if (event.type === 'planned') {
          setPlanned(event.checks)
          setStatus(event.fallback ? 'Director reply unreadable; the game planned this turn.' : '')
        } else if (event.type === 'restart') {
          // What was streamed is being replaced: start reading the turn again from its first beat.
          setStreamed('')
          setIndex(turnStart.current)
          setStatus(event.reason === 'rewrite' ? 'Revising…' : 'Trying the fallback model…')
        }
      }),
    []
  )

  // The flags standing on this scene's logged turns, from whichever session they were made in.
  useEffect(() => {
    const logged = scene.turns.flatMap((t) => (t.log ? [{ session: t.log, turnId: t.id }] : []))
    if (logged.length === 0) return
    window.api.flagsFor(logged).then((records) => setFlags(new Map(records.map((r) => [flagKey(r), r]))))
    // Only on opening the scene; flags made here are added as they're saved.
  }, [scene.id])

  const live: ShownBeat[] = busy ? streamingBeats(content, state, streamed).map((beat, i) => ({ beat, turn: scene.turns.length, n: i + 1 })) : []
  const beats = [...history, ...live]
  const reading: Reading = { index, total: beats.length, streaming: busy }
  const shown = beats[Math.min(index, beats.length - 1)]
  const waitingFirst = busy && index >= beats.length

  const next = () => {
    if (canAdvance(reading)) setIndex(index + 1)
  }
  const back = () => {
    if (canGoBack(reading)) setIndex(Math.min(index, beats.length - 1) - 1)
  }

  // The turn on screen, once it is in the state (not while streaming): what Details and flags are about.
  const shownTurn: Turn | undefined = shown && !busy && shown.turn >= 0 ? scene.turns[shown.turn] : undefined
  const flaggable = !!shownTurn?.log
  const openFlag = (wholeTurn: boolean) => {
    if (!shownTurn?.log || !shown) return
    setFlagging({ turn: shownTurn, ...(!wholeTurn && { beat: shown.n }) })
  }

  async function saveFlag(target: FlagTarget, flag: Flag | null) {
    setFlagging(null)
    const beat = target.beat !== undefined ? target.turn.beats[target.beat - 1] : undefined
    const record = await window.api.flag({
      turnSession: target.turn.log!,
      turnId: target.turn.id,
      ...(target.beat !== undefined && { beat: target.beat }),
      ...(beat?.kind === 'dialogue' && { speaker: beat.speaker }),
      ...(beat && { text: beat.text }),
      flag
    })
    if (!record) return
    setFlags((current) => {
      const next = new Map(current)
      if (record.flag) next.set(flagKey(record), record)
      else next.delete(flagKey(record))
      return next
    })
  }

  // Details of the turn on screen: the fresh trace from this session, or read back from its log.
  const detailsOf = shownTurn ? details.get(shownTurn.id) : undefined
  useEffect(() => {
    if (!detailsOpen || !shownTurn || details.has(shownTurn.id)) return
    const turn = shownTurn
    if (!turn.log) {
      setDetails((d) => new Map(d).set(turn.id, null))
      return
    }
    window.api.turnDetails(turn.log, turn.id).then((found) => setDetails((d) => new Map(d).set(turn.id, found)))
  }, [detailsOpen, shownTurn, details])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (flagging) return
      // F flags only while reading: never from a text field, so it can't add an "f" to the player's line.
      const inField = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (!inField && (event.key === 'f' || event.key === 'F') && !event.ctrlKey && !event.metaKey && !event.altKey && flaggable) {
        event.preventDefault()
        openFlag(event.shiftKey)
        return
      }
      const typing = event.target instanceof HTMLInputElement && event.target.value !== ''
      if (typing) return
      if (['ArrowRight', ' ', 'Enter'].includes(event.key) && canAdvance(reading)) {
        event.preventDefault()
        next()
      } else if (event.key === 'ArrowLeft' && canGoBack(reading)) {
        event.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Once everything is read, the line is the player's.
  const done = atEnd(reading) && !scene.ended
  useEffect(() => {
    if (done) inputRef.current?.focus()
  }, [done])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const said = input.trim()
    if (!said || busy || scene.ended) return
    setBusy(true)
    setError('')
    setStatus('')
    setPlanned([])
    setStreamed('')
    turnStart.current = history.length
    setIndex(history.length)
    setInput('')
    const response = await window.api.sceneTurn({ state, input: said })
    setBusy(false)
    setStreamed('')
    if (response.ok) {
      const turn = response.state.scene?.turns.at(-1)
      if (turn) setDetails((d) => new Map(d).set(turn.id, response.details))
      onState(response.state)
      if (response.rewrite.length === 0) setStatus('')
      else setStatus(`Revised: ${response.rewrite.length} fix${response.rewrite.length === 1 ? '' : 'es'}`)
    } else {
      setError(response.error)
      setInput(said)
      setIndex(Math.max(0, history.length - 1))
    }
  }

  // Whoever has the line on screen is lit on the stage.
  const speaker = shown && !waitingFirst && shown.beat.kind === 'dialogue' ? shown.beat.speaker : undefined
  const figures = presentCast(scene).map((id) => {
    const character = characterById(content, id)!
    const color = speciesById(content.setting, character.species)?.color
    return { character, expression: scene.expressions[id] ?? 'neutral', speaking: speaker === id, ...(color && { color }) }
  })
  const name = shown && !waitingFirst ? nameplate(content, state, shown.beat) : undefined
  const checks = shown && !waitingFirst && shown.turn >= 0 ? (scene.turns[shown.turn]?.checks.map((c) => c.line) ?? planned) : waitingFirst ? planned : []
  const uneasy = presentCast(scene).filter((id) => (scene.comfort[id] ?? 3) <= 2)
  const reviewing = !busy && index < beats.length - 1
  // A flagged beat shows its mark when read back, so it isn't flagged twice by accident.
  const shownMark = shownTurn && shown ? flags.get(keyOf(shownTurn, shown.n))?.flag?.rating : undefined
  const nameOf = (b: ShownBeat) => nameplate(content, state, b.beat)

  return (
    <div className="scene">
      <header className="scene-bar">
        <span className="place">{location.name}</span>
        <span className="district">{location.district}</span>
        <span className="spacer" />
        {status && <span className="status">{status}</span>}
        <Button size="sm" variant={detailsOpen ? 'primary' : 'ghost'} onClick={() => setDetailsOpen(!detailsOpen)} title="The turn on screen: plan, rolls, checks, rewrite, timings, flags">
          Details
        </Button>
        <Button size="sm" variant="ghost" onClick={onSave} disabled={busy}>
          Save
        </Button>
        <Button size="sm" variant={scene.ended ? 'primary' : 'ghost'} onClick={onEnd} disabled={busy} title="End the scene; everyone writes what they take from it">
          End scene
        </Button>
      </header>

      <div className="stage-wrap">
        <SpriteStage figures={figures} />
        {detailsOpen && (
          <TurnDetails
            nameOf={(id) => nameplate(content, state, { kind: 'dialogue', speaker: id, text: '' }) ?? id}
            details={detailsOf ?? null}
            loading={!!shownTurn && detailsOf === undefined}
            flags={shownTurn ? [...flags.values()].filter((f) => f.turnId === shownTurn.id && f.turnSession === shownTurn.log) : []}
            flaggable={flaggable}
            onFlagTurn={() => openFlag(true)}
            onBeat={(n) => shown && setIndex(beats.findIndex((b) => b.turn === shown.turn && b.n === n))}
            onClose={() => setDetailsOpen(false)}
          />
        )}
      </div>

      <div className="lower">
        {(checks.length > 0 || uneasy.length > 0) && (
          <div className="chips">
            {checks.map((line) => (
              <span key={line} className={/failure/.test(line) ? 'chip bad' : /cost/.test(line) ? 'chip warn' : 'chip good'}>
                {line}
              </span>
            ))}
            {uneasy.map((id) => (
              <span key={id} className="chip warn" title={`Comfort ${scene.comfort[id]}/5`}>
                {firstName(characterById(content, id)!.name)}: {COMFORT_WORD[scene.comfort[id] ?? 3]}
              </span>
            ))}
          </div>
        )}

        <div
          className={['textbox', canAdvance(reading) && 'turning'].filter(Boolean).join(' ')}
          onClick={next}
          onWheel={(event) => {
            // One beat for each turn of the wheel, however many events a turn sends.
            if (event.timeStamp - turned.current < 180 || event.deltaY === 0) return
            turned.current = event.timeStamp
            if (event.deltaY < 0) back()
            else next()
          }}
        >
          {name && <div className="nameplate">{name}</div>}
          {shown?.said && reviewing && <div className="said">You: {shown.said}</div>}
          {waitingFirst ? (
            <p className="beat thinking">…</p>
          ) : shown ? (
            <p className={shown.beat.kind === 'narration' ? 'beat narration' : 'beat dialogue'}>{shown.beat.text}</p>
          ) : null}
          {flagging && (
            <FlagPanel
              title={flagging.beat !== undefined ? `beat ${flagging.beat}${shown && nameOf(shown) ? ` · ${nameOf(shown)}` : ''}` : `turn ${scene.turns.indexOf(flagging.turn) + 1}`}
              {...(flags.get(keyOf(flagging.turn, flagging.beat))?.flag && { existing: flags.get(keyOf(flagging.turn, flagging.beat))!.flag! })}
              onSave={(flag) => saveFlag(flagging, flag)}
              onCancel={() => setFlagging(null)}
            />
          )}
          <div className="textbox-foot">
            {shownMark && <span className={`flag-mark ${shownMark}`}>⚑ {shownMark}</span>}
            {shown && !waitingFirst && <span>{beatCounter(shown)}</span>}
            {shownTurn && (
              <button
                type="button"
                className="flag-button"
                disabled={!flaggable}
                title={flaggable ? 'Flag this beat (F); Shift+F flags the turn' : 'This turn was not logged'}
                onClick={(e) => {
                  e.stopPropagation()
                  openFlag(e.shiftKey)
                }}
              >
                ⚑
              </button>
            )}
            {canAdvance(reading) && <span className="more">▸</span>}
            {awaitingBeat(reading) && !waitingFirst && <span className="more pulse">…</span>}
          </div>
        </div>

        {(error || endError) && <div className="error">{error || endError}</div>}

        <form className="say" onSubmit={submit}>
          <input
            ref={inputRef}
            value={input}
            placeholder={scene.ended ? 'The scene has ended.' : busy ? 'Waiting…' : 'Say or do something…'}
            disabled={busy || scene.ended}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={busy || scene.ended || input.trim().length === 0}>
            Send
          </Button>
        </form>
      </div>
    </div>
  )
}
