import { useEffect, useRef, useState } from 'react'
import type { GameState } from '@engine/state'
import { locationById, type Pack } from '@engine/pack'
import { seedFrom } from '@engine/core'
import { createInitialState, startScene } from '@engine/state'
import type { WitnessReport } from '@engine/relationships'
import { AUTO_SLOT_ID, latestSave, type SaveSummary } from '@engine/state'
import { Button } from './ui/Button'
import { PackPicker } from './ui/PackPicker'
import { SavesView } from './ui/SavesView'
import { SceneView } from './ui/SceneView'
import { Settings } from './ui/Settings'
import { SummaryView } from './ui/SummaryView'

type Screen = 'picker' | 'title' | 'settings' | 'scene' | 'ending' | 'summary' | 'save' | 'load'

/**
 * Owns which screen is showing, the chosen pack and the game state; main only runs turns and summaries on it, and
 * keeps the saves. The pack picker comes first, always (architecture §10).
 */
export function App() {
  const [screen, setScreen] = useState<Screen>('picker')
  const [content, setContent] = useState<Pack | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [reports, setReports] = useState<WitnessReport[]>([])
  const [error, setError] = useState('')
  const [saves, setSaves] = useState<SaveSummary[]>([])
  // Where the save and settings screens go back to.
  const [from, setFrom] = useState<Screen>('title')

  useEffect(() => {
    if (screen === 'title') window.api.listSaves().then(setSaves)
    // A log session runs from starting or loading a game until the title screen (milestone 2, A2).
    if (screen === 'title' || screen === 'picker') void window.api.endLog()
  }, [screen])

  /** A pack was picked: a fresh start in it, nothing carried over from another pack. */
  const choose = (pack: Pack) => {
    setContent(pack)
    setState(null)
    setError('')
    setScreen('title')
  }
  const changePack = () => {
    setContent(null)
    setState(null)
    setScreen('picker')
  }

  // Autosave whenever the game changes: after each turn, a scene's end or a new scene. The first state after a load
  // is the save itself, so it isn't written back.
  const loaded = useRef<GameState | null>(null)
  useEffect(() => {
    if (!state || state === loaded.current) return
    window.api.saveGame({ slotId: AUTO_SLOT_ID, state }).then((r) => {
      if (!r.ok) console.error('Autosave failed:', r.error)
    })
  }, [state])

  /** Play starts: a log session begins, saying what it started from. */
  const play = (from: string) => void window.api.beginLog(from)

  const enterScene = (game: GameState) => {
    if (!content) return
    const { location, cast } = content.manifest.start
    // A unique scene id, so turn ids never repeat across sessions or loads of the same save.
    setState(startScene(content, game, location, cast, `scene-${crypto.randomUUID().slice(0, 8)}`))
    setScreen('scene')
  }
  const newGame = () => {
    if (!content) return
    play('new game')
    enterScene(createInitialState(content, seedFrom(`${Date.now()}`)))
  }

  const resume = (game: GameState, from = 'save') => {
    play(from)
    loaded.current = game
    setState(game)
    setScreen(game.scene ? 'scene' : 'title')
  }
  const continueLatest = async () => {
    const latest = latestSave(saves)
    if (!latest) return
    const response = await window.api.loadGame(latest.slotId)
    if (response.ok) resume(response.state, `save ${latest.slotId}`)
    else setError(response.error)
  }
  const openSaves = (mode: 'save' | 'load') => {
    setFrom(screen)
    setScreen(mode)
  }
  const openSettings = () => {
    setFrom(screen)
    setScreen('settings')
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

  if (screen === 'settings') return <Settings onClose={() => setScreen(from)} />
  if (screen === 'picker' || !content) return <PackPicker onChosen={choose} onSettings={openSettings} />
  if (screen === 'save' || screen === 'load') {
    return <SavesView mode={screen} state={state ?? undefined} onLoaded={(game) => resume(game)} onClose={() => setScreen(from)} />
  }
  if (screen === 'ending') {
    return (
      <div className="screen title">
        <p className="tagline">Everyone takes something away from tonight…</p>
      </div>
    )
  }
  if (screen === 'summary' && content && state) {
    const again = locationById(content, content.manifest.start.location)?.name ?? ''
    return <SummaryView content={content} reports={reports} againLabel={`Back to ${again}`} onAgain={() => enterScene(state)} onTitle={() => setScreen('title')} />
  }
  if (screen === 'scene' && content && state?.scene) {
    return <SceneView content={content} state={state} onState={setState} onEnd={endScene} onSave={() => openSaves('save')} endError={error} />
  }

  const latest = latestSave(saves)
  const startName = locationById(content, content.manifest.start.location)?.name ?? ''
  return (
    <div className="screen title">
      <h1 className="logo">{content.manifest.ui.title ?? content.manifest.name}</h1>
      <p className="tagline">{content.manifest.ui.tagline}</p>
      <div className="menu">
        {state?.scene && (
          <Button variant="primary" onClick={() => (play('continue'), setScreen('scene'))}>
            Continue
          </Button>
        )}
        {!state && latest && (
          <Button variant="primary" onClick={continueLatest}>
            Continue
          </Button>
        )}
        {state && !state.scene && (
          <Button variant="primary" onClick={() => (play('continue'), enterScene(state))}>
            Back to {startName}
          </Button>
        )}
        <Button onClick={newGame} disabled={!content}>
          New game
        </Button>
        {state && <Button onClick={() => openSaves('save')}>Save game</Button>}
        <Button onClick={() => openSaves('load')} disabled={saves.length === 0}>
          Load game
        </Button>
        <Button onClick={openSettings}>Settings</Button>
        <Button variant="ghost" onClick={changePack}>
          Change game
        </Button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
