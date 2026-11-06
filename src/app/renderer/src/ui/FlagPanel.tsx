import { useEffect, useRef, useState } from 'react'
import { FLAG_REASONS, RATINGS, type Flag, type FlagReason, type Rating } from '@engine/review'
import { Button } from './Button'

interface Props {
  /** What is being flagged, as the panel's heading says it: "beat 3 · Ada", or "the whole turn". */
  title: string
  /** The flag already on it, to change or clear. */
  existing?: Flag
  onSave: (flag: Flag | null) => void
  onCancel: () => void
}

/**
 * One small panel for flagging a beat or a turn (milestone 2, A3), by key or by mouse: 1 / 2 / 3 rate good / meh /
 * bad; reasons are tags to click; typing goes into the note; Enter saves, Esc cancels. Keys are caught before the
 * scene's own, so reading never moves while the panel is open.
 */
export function FlagPanel({ title, existing, onSave, onCancel }: Props) {
  const [rating, setRating] = useState<Rating | undefined>(existing?.rating)
  const [reasons, setReasons] = useState<FlagReason[]>(existing?.reasons ?? [])
  const [note, setNote] = useState(existing?.note ?? '')
  const [hint, setHint] = useState('')
  const noteRef = useRef<HTMLInputElement>(null)

  const save = () => {
    if (!rating) {
      setHint('Pick a rating first: 1, 2 or 3.')
      return
    }
    onSave({ rating, reasons, note: note.trim() })
  }
  const toggle = (reason: FlagReason) => setReasons((rs) => (rs.includes(reason) ? rs.filter((r) => r !== reason) : [...rs, reason]))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        save()
        return
      }
      const inNote = event.target === noteRef.current
      if (inNote || event.ctrlKey || event.metaKey || event.altKey) return
      const n = ['1', '2', '3'].indexOf(event.key)
      if (n >= 0) {
        event.preventDefault()
        setRating(RATINGS[n])
        setHint('')
      } else if (event.key.length === 1 && event.key !== ' ') {
        // Any other character starts the note: it goes in, and the note keeps the focus from then on.
        event.preventDefault()
        setNote((t) => t + event.key)
        noteRef.current?.focus()
      }
    }
    // Capture, so the scene's keys (Space, arrows, F) never see what the panel takes.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className="flag-panel" role="dialog" aria-label={`Flag ${title}`} onClick={(e) => e.stopPropagation()}>
      <div className="flag-head">
        <span>Flag {title}</span>
        <span className="status">Enter saves · Esc cancels</span>
      </div>
      <div className="flag-ratings">
        {RATINGS.map((r, i) => (
          <button key={r} type="button" className={['flag-rating', r, rating === r && 'on'].filter(Boolean).join(' ')} onClick={() => (setRating(r), setHint(''))}>
            <kbd>{i + 1}</kbd> {r}
          </button>
        ))}
      </div>
      <div className="flag-reasons">
        {FLAG_REASONS.map((r) => (
          <button key={r} type="button" className={['flag-reason', reasons.includes(r) && 'on'].filter(Boolean).join(' ')} onClick={() => toggle(r)}>
            {r}
          </button>
        ))}
      </div>
      <input ref={noteRef} className="flag-note" value={note} placeholder="Note: just start typing" onChange={(e) => setNote(e.target.value)} />
      <div className="row">
        <Button size="sm" variant="primary" onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {existing && (
          <Button size="sm" variant="ghost" onClick={() => onSave(null)}>
            Clear flag
          </Button>
        )}
        {hint && <span className="error">{hint}</span>}
      </div>
    </div>
  )
}
