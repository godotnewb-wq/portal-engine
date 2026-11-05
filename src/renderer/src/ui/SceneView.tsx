import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { GameState } from '../../../shared/model'
import { characterById, locationById, type Content } from '../../../shared/game/content'
import { firstName } from '../../../shared/game/names'
import { presentCast } from '../../../shared/game/plan'
import { Button } from './Button'
import { atEnd, awaitingBeat, canAdvance, canGoBack, nameplate, sceneHistory, streamingBeats, type Reading, type ShownBeat } from './reading'
import { SpriteStage } from './SpriteStage'

interface Props {
  content: Content
  state: GameState
  onState: (next: GameState) => void
  onLeave: () => void
}

const COMFORT_WORD = ['', 'wants out', 'uneasy', 'all right', 'comfortable', 'at ease']

/**
 * The scene: the stage, the text box read a beat at a time, and the player's line. A reply streams in and its
 * beats can be read as they arrive. A click, Space, Enter or → turns to the next beat; ← or the wheel turned up goes
 * back through the scene, which changes nothing.
 */
export function SceneView({ content, state, onState, onLeave }: Props) {
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

  const live: ShownBeat[] = busy ? streamingBeats(content, state, streamed).map((beat) => ({ beat, turn: scene.turns.length })) : []
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
  const figures = presentCast(scene).map((id) => ({ character: characterById(content, id)!, expression: scene.expressions[id] ?? 'neutral', speaking: speaker === id }))
  const name = shown && !waitingFirst ? nameplate(content, state, shown.beat) : undefined
  const checks = shown && !waitingFirst && shown.turn >= 0 ? (scene.turns[shown.turn]?.checks.map((c) => c.line) ?? planned) : waitingFirst ? planned : []
  const uneasy = presentCast(scene).filter((id) => (scene.comfort[id] ?? 3) <= 2)
  const reviewing = !busy && index < beats.length - 1

  return (
    <div className="scene">
      <header className="scene-bar">
        <span className="place">{location.name}</span>
        <span className="district">{location.district}</span>
        <span className="spacer" />
        {status && <span className="status">{status}</span>}
        <Button size="sm" variant="ghost" onClick={onLeave} disabled={busy}>
          Leave
        </Button>
      </header>

      <SpriteStage figures={figures} />

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
          <div className="textbox-foot">
            <span>
              {Math.min(index, beats.length - 1) + 1} / {beats.length}
            </span>
            {canAdvance(reading) && <span className="more">▸</span>}
            {awaitingBeat(reading) && !waitingFirst && <span className="more pulse">…</span>}
          </div>
        </div>

        {error && <div className="error">{error}</div>}

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
