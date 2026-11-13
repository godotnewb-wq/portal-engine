import { useEffect, useState } from 'react'
import type { GameState } from '@engine/state'
import { AUTO_SLOT_ID, SAVE_NAME_CHARS, SLOT_IDS, slotLabel, type SaveSummary, type SlotId } from '@engine/state'
import { Button } from './Button'

interface Props {
  mode: 'save' | 'load'
  /** The game to save, in save mode. */
  state?: GameState
  onLoaded: (state: GameState) => void
  onClose: () => void
}

/** In-game time as the slot list shows it: day and clock. Time counts minutes from the start of day one. */
function clock(minutes: number): string {
  const day = Math.floor(minutes / 1440) + 1
  const m = minutes % 1440
  return `Day ${day}, ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function describe(summary: SaveSummary): string {
  if (summary.unreadable) return summary.outdated ? 'Made with an earlier version of the game; can’t be loaded' : 'Unreadable save'
  const where = summary.inScene ? `in a scene, ${summary.turns} turn${summary.turns === 1 ? '' : 's'} in` : 'between scenes'
  return `${summary.playerName} · ${clock(summary.time)} · ${where} · ${summary.memories} memor${summary.memories === 1 ? 'y' : 'ies'}`
}

/**
 * The save slots. The autosave is written by the game and can only be loaded; manual slots can be saved to, named,
 * loaded and deleted. Overwriting or deleting asks once more on the same button.
 */
export function SavesView({ mode, state, onLoaded, onClose }: Props) {
  const [saves, setSaves] = useState<SaveSummary[] | null>(null)
  const [name, setName] = useState('')
  const [arming, setArming] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const refresh = () => window.api.listSaves().then(setSaves)
  useEffect(() => {
    refresh()
  }, [])

  const save = async (slotId: SlotId) => {
    if (!state) return
    const response = await window.api.saveGame({ slotId, state, ...(name.trim() && { name }) })
    setArming(null)
    setMessage(response.ok ? `Saved to ${slotLabel(slotId)}.` : response.error)
    refresh()
  }
  const load = async (slotId: SlotId) => {
    const response = await window.api.loadGame(slotId)
    if (response.ok) onLoaded(response.state)
    else setMessage(response.error)
  }
  const remove = async (slotId: SlotId) => {
    await window.api.deleteSave(slotId)
    setArming(null)
    setMessage(`${slotLabel(slotId)} deleted.`)
    refresh()
  }
  /** Runs `act` on the second press of a button whose first press only arms it. */
  const twice = (key: string, act: () => void) => () => (arming === key ? act() : setArming(key))

  const slots = mode === 'save' ? SLOT_IDS.filter((id) => id !== AUTO_SLOT_ID) : SLOT_IDS
  return (
    <div className="screen saves">
      <h1>{mode === 'save' ? 'Save game' : 'Load game'}</h1>
      {mode === 'save' && (
        <label className="save-name">
          Name (optional)
          <input value={name} maxLength={SAVE_NAME_CHARS} onChange={(e) => setName(e.target.value)} placeholder="e.g. Before the pump station" />
        </label>
      )}
      <div className="slots">
        {saves === null
          ? 'Loading…'
          : slots.map((slotId) => {
              const summary = saves.find((s) => s.slotId === slotId)
              const empty = !summary
              const title = summary && !summary.unreadable && summary.name ? summary.name : slotLabel(slotId)
              return (
                <div key={slotId} className={['slot', empty && 'empty', summary?.unreadable && 'unreadable'].filter(Boolean).join(' ')}>
                  <div className="slot-text">
                    <span className="slot-title">
                      {title}
                      {title !== slotLabel(slotId) && <small>{slotLabel(slotId)}</small>}
                    </span>
                    <span className="slot-detail">{summary ? `${describe(summary)} · saved ${new Date(summary.savedAt).toLocaleString()}` : 'Empty'}</span>
                  </div>
                  <div className="slot-actions">
                    {mode === 'save' && (
                      <Button size="sm" variant={arming === `save:${slotId}` ? 'primary' : 'secondary'} onClick={empty ? () => save(slotId) : twice(`save:${slotId}`, () => save(slotId))}>
                        {arming === `save:${slotId}` ? 'Overwrite?' : 'Save here'}
                      </Button>
                    )}
                    {mode === 'load' && (
                      <Button size="sm" variant="primary" disabled={empty || summary?.unreadable} onClick={() => load(slotId)}>
                        Load
                      </Button>
                    )}
                    {!empty && slotId !== AUTO_SLOT_ID && (
                      <Button size="sm" variant="ghost" onClick={twice(`delete:${slotId}`, () => remove(slotId))}>
                        {arming === `delete:${slotId}` ? 'Delete?' : 'Delete'}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
      </div>
      <div className="row">
        <Button variant="ghost" onClick={onClose}>
          Back
        </Button>
        {message && <span className="status">{message}</span>}
      </div>
    </div>
  )
}
