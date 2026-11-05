import { useEffect, useState } from 'react'
import type { Content } from '../../shared/game/content'
import { Button } from './ui/Button'
import { Settings } from './ui/Settings'

type Screen = 'title' | 'settings'

/** Owns which screen is showing. Game state will live here once the scene screen exists. */
export function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const [content, setContent] = useState<Content | null>(null)

  useEffect(() => {
    window.api.getContent().then(setContent)
  }, [])

  if (screen === 'settings') return <Settings onClose={() => setScreen('title')} />

  return (
    <div className="screen title">
      <h1 className="logo">Neonpunk Nights</h1>
      <p className="tagline">Spire City · the Low Turns</p>
      <div className="menu">
        <Button variant="primary" disabled title="The scene pipeline is the next step of Milestone 1">
          New game
        </Button>
        <Button onClick={() => setScreen('settings')}>Settings</Button>
      </div>
      {content && (
        <p className="foot">
          {content.characters.length} characters · {content.locations.length} location
        </p>
      )}
    </div>
  )
}
