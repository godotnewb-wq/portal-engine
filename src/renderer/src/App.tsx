import { useEffect, useRef, useState } from 'react'
import type { GameState } from '../../shared/model'
import type { Content } from '../../shared/game/content'
import { seedFrom } from '../../shared/game/dice'
import { createInitialState, startScene } from '../../shared/game/state'
import type { WitnessReport } from '../../shared/game/summary'
import { AUTO_SLOT_ID, latestSave, type SaveSummary } from '../../shared/saves'
import { Button } from './ui/Button'
import { SavesView } from './ui/SavesView'
import { SceneView } from './ui/SceneView'
import { Settings } from './ui/Settings'
import { SummaryView } from './ui/SummaryView'

type Screen = 'title' | 'settings' | 'scene' | 'ending' | 'summary' | 'save' | 'load'

/** Milestone 1's one scene: the Sump Lantern, with everyone in it. */
const OPENING = { locationId: 'sump-lantern', cast: ['vex', 'brask', 'oria-senn'] }

/** Owns which screen is showing and the game state; main only runs turns and summaries on it, and keeps the saves. */
export function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const [content, setContent] = useState<Content | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [reports, setReports] = useState<WitnessReport[]>([])
  const [error, setError] = useState('')
  const [saves, setSaves] = useState<SaveSummary[]>([])
  // Where the save screen goes back to.
  const [from, setFrom] = useState<Screen>('title')

  useEffect(() => {
    window.api.getContent().then(setContent)
  }, [])
  useEffect(() => {
    if (screen === 'title') window.api.listSaves().then(setSaves)
  }, [screen])

  // Autosave whenever the game changes: after each turn, a scene's end or a new scene. The first state after a load
  // is the save itself, so it isn't written back.
  const loaded = useRef<GameState | null>(null)
  useEffect(() => {
    if (!state || state === loaded.current) return
    window.api.saveGame({ slotId: AUTO_SLOT_ID, state }).then((r) => {
      if (!r.ok) console.error('Autosave failed:', r.error)
    })
  }, [state])

  const enterScene = (game: GameState) => {
    if (!content) return
    setState(startScene(content, game, OPENING.locationId, OPENING.cast))
    setScreen('scene')
  }
  const newGame = () => content && enterScene(createInitialState(content, seedFrom(`${Date.now()}`)))

  const resume = (game: GameState) => {
    loaded.current = game
    setState(game)
    setScreen(game.scene ? 'scene' : 'title')
  }
  const continueLatest = async () => {
    const latest = latestSave(saves)
    if (!latest) return
    const response = await window.api.loadGame(latest.slotId)
    if (response.ok) resume(response.state)
    else setError(response.error)
  }
  const openSaves = (mode: 'save' | 'load') => {
    setFrom(screen)
    setScreen(mode)
  }

  /** Closing a scene where nothing was said needs no summaries; otherwise every witness writes theirs. */
  const endScene = async () => {
    if (!state?.scene) return
    if (state.scene.turns.length === 0) {
      setState({ ...state, scene: null })
      setScreen('title')
      return
    }
    setScreen('ending')
    setError('')
    const response = await window.api.sceneEnd(state)
    if (response.ok) {
      setState(response.state)
      setReports(response.reports)
      setScreen('summary')
    } else {
      setError(response.error)
      setScreen('scene')
    }
  }

  if (screen === 'settings') return <Settings onClose={() => setScreen('title')} />
  if (screen === 'save' || screen === 'load') {
    return <SavesView mode={screen} state={state ?? undefined} onLoaded={resume} onClose={() => setScreen(from)} />
  }
  if (screen === 'ending') {
    return (
      <div className="screen title">
        <p className="tagline">Everyone takes something away from tonight…</p>
      </div>
    )
  }
  if (screen === 'summary' && content && state) {
    return <SummaryView content={content} reports={reports} onAgain={() => enterScene(state)} onTitle={() => setScreen('title')} />
  }
  if (screen === 'scene' && content && state?.scene) {
    return <SceneView content={content} state={state} onState={setState} onEnd={endScene} onSave={() => openSaves('save')} endError={error} />
  }

  const latest = latestSave(saves)
  return (
    <div className="screen title">
      <h1 className="logo">Neonpunk Nights</h1>
      <p className="tagline">Spire City · the Low Turns</p>
      <div className="menu">
        {state?.scene && (
          <Button variant="primary" onClick={() => setScreen('scene')}>
            Continue
          </Button>
        )}
        {!state && latest && (
          <Button variant="primary" onClick={continueLatest}>
            Continue
          </Button>
        )}
        {state && !state.scene && (
          <Button variant="primary" onClick={() => enterScene(state)}>
            Back to the Sump Lantern
          </Button>
        )}
        <Button onClick={newGame} disabled={!content}>
          New game
        </Button>
        {state && <Button onClick={() => openSaves('save')}>Save game</Button>}
        <Button onClick={() => openSaves('load')} disabled={saves.length === 0}>
          Load game
        </Button>
        <Button onClick={() => setScreen('settings')}>Settings</Button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
