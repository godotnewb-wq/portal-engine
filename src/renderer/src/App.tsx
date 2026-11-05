import { useEffect, useState } from 'react'
import type { GameState } from '../../shared/model'
import type { Content } from '../../shared/game/content'
import { seedFrom } from '../../shared/game/dice'
import { createInitialState, startScene } from '../../shared/game/state'
import type { WitnessReport } from '../../shared/game/summary'
import { Button } from './ui/Button'
import { SceneView } from './ui/SceneView'
import { Settings } from './ui/Settings'
import { SummaryView } from './ui/SummaryView'

type Screen = 'title' | 'settings' | 'scene' | 'ending' | 'summary'

/** Milestone 1's one scene: the Sump Lantern, with everyone in it. */
const OPENING = { locationId: 'sump-lantern', cast: ['vex', 'brask', 'oria-senn'] }

/** Owns which screen is showing and the game state; main only runs turns and summaries on it. */
export function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const [content, setContent] = useState<Content | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [reports, setReports] = useState<WitnessReport[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.getContent().then(setContent)
  }, [])

  const enterScene = (from: GameState) => {
    if (!content) return
    setState(startScene(content, from, OPENING.locationId, OPENING.cast))
    setScreen('scene')
  }
  const newGame = () => content && enterScene(createInitialState(content, seedFrom(`${Date.now()}`)))

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
  if (screen === 'ending') return <div className="screen title"><p className="tagline">Everyone takes something away from tonight…</p></div>
  if (screen === 'summary' && content && state) {
    return <SummaryView content={content} reports={reports} onAgain={() => enterScene(state)} onTitle={() => setScreen('title')} />
  }
  if (screen === 'scene' && content && state?.scene) {
    return <SceneView content={content} state={state} onState={setState} onEnd={endScene} endError={error} />
  }

  return (
    <div className="screen title">
      <h1 className="logo">Neonpunk Nights</h1>
      <p className="tagline">Spire City · the Low Turns</p>
      <div className="menu">
        <Button variant="primary" onClick={newGame} disabled={!content}>
          New game
        </Button>
        {state?.scene && <Button onClick={() => setScreen('scene')}>Continue</Button>}
        {state && !state.scene && <Button onClick={() => enterScene(state)}>Back to the Sump Lantern</Button>}
        <Button onClick={() => setScreen('settings')}>Settings</Button>
      </div>
    </div>
  )
}
