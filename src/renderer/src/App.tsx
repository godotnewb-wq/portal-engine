import { useEffect, useState } from 'react'
import type { GameState } from '../../shared/model'
import type { Content } from '../../shared/game/content'
import { seedFrom } from '../../shared/game/dice'
import { createInitialState, startScene } from '../../shared/game/state'
import { Button } from './ui/Button'
import { SceneView } from './ui/SceneView'
import { Settings } from './ui/Settings'

type Screen = 'title' | 'settings' | 'scene'

/** Milestone 1's one scene: the Sump Lantern, with everyone in it. */
const OPENING = { locationId: 'sump-lantern', cast: ['vex', 'brask', 'oria-senn'] }

/** Owns which screen is showing and the game state; main only runs turns on it. */
export function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const [content, setContent] = useState<Content | null>(null)
  const [state, setState] = useState<GameState | null>(null)

  useEffect(() => {
    window.api.getContent().then(setContent)
  }, [])

  const newGame = () => {
    if (!content) return
    const fresh = createInitialState(content, seedFrom(`${Date.now()}`))
    setState(startScene(content, fresh, OPENING.locationId, OPENING.cast))
    setScreen('scene')
  }

  if (screen === 'settings') return <Settings onClose={() => setScreen('title')} />
  if (screen === 'scene' && content && state?.scene) {
    return <SceneView content={content} state={state} onState={setState} onLeave={() => setScreen('title')} />
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
        <Button onClick={() => setScreen('settings')}>Settings</Button>
      </div>
    </div>
  )
}
