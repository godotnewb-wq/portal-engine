import { useEffect, useState, type ReactNode } from 'react'
import type { CallSummary, CallText } from '@platform/logs'
import { Button } from './Button'

/** One tab of a details overlay: its label, an optional count, and its content, drawn only when open. */
export interface DetailsTab {
  id: string
  label: string
  /** Shown beside the label when above zero, so where to look shows without opening it. */
  count?: number
  /** The count is of something wrong (corrections, refusals, leaks). */
  warn?: boolean
  render: () => ReactNode
}

/**
 * A full-screen overlay with tabs by category (milestone 4d, decided 2026-11-19, user: a full overlay, tabs by
 * meaning). Used for a turn's details and for a scene's end. Escape closes it; the header keeps its own actions.
 */
export function DetailsOverlay({ title, actions, tabs, tab, onTab, onClose }: { title: ReactNode; actions?: ReactNode; tabs: DetailsTab[]; tab: string; onTab: (id: string) => void; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const open = tabs.find((t) => t.id === tab) ?? tabs[0]
  return (
    <div className="details-overlay" onClick={onClose}>
      <div className="details-frame" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <span className="spacer" />
          {actions}
          <Button size="sm" variant="ghost" onClick={onClose} title="Close (Esc)">
            Close
          </Button>
        </header>
        <nav className="details-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === open?.id} className={t.id === open?.id ? 'on' : ''} onClick={() => onTab(t.id)}>
              {t.label}
              {t.count !== undefined && t.count > 0 && <span className={`count${t.warn ? ' warn' : ''}`}>{t.count}</span>}
            </button>
          ))}
        </nav>
        <div className="details-body" role="tabpanel">
          {open?.render()}
        </div>
      </div>
    </div>
  )
}

/** What an older log or a call still running didn't record, said plainly instead of an empty space. */
export const NotRecorded = ({ what }: { what: string }) => <p className="muted not-recorded">{what}</p>

/**
 * Calls with what each cost and who answered; a click opens its prompt and reply, read back from the session's log
 * (`session`), which isn't kept with logging off.
 */
/**
 * The calls, each opening to its prompt and reply. `about` names whom a call is about by its id, where the role alone
 * doesn't tell calls apart (a witness's relationship and memory calls at the scene's end).
 */
export function CallList({ calls, session, about }: { calls: CallSummary[]; session?: string; about?: ReadonlyMap<string, string> }) {
  const [open, setOpen] = useState<string | null>(null)
  const [texts, setTexts] = useState<Map<string, CallText | null>>(new Map())
  const toggle = (id: string) => {
    setOpen(open === id ? null : id)
    if (session && !texts.has(id)) window.api.callText(session, id).then((found) => setTexts((t) => new Map(t).set(id, found)))
  }
  if (calls.length === 0) return <NotRecorded what="No calls." />
  return (
    <ul className="call-list">
      {calls.map((c) => (
        <li key={c.id}>
          <button className="call-row mono" onClick={() => toggle(c.id)} aria-expanded={open === c.id}>
            {open === c.id ? '▾' : '▸'} {c.role}{about?.has(c.id) && ` · ${about.get(c.id)}`}: {c.model ?? '?'} · {c.ms} ms{c.firstTextMs !== undefined && ` (first text ${c.firstTextMs} ms)`}
            {c.tokens && ` · ${c.tokens.input ?? '?'}→${c.tokens.output ?? '?'} tok`}
            {c.restarted && ' · restarted on fallback profile'}
            {c.jsonRetried && ' · retried without JSON mode'}
            {c.error && <span className="warn"> · {c.error}</span>}
          </button>
          {open === c.id && <CallBody text={texts.get(c.id)} session={session} loading={!!session && !texts.has(c.id)} />}
        </li>
      ))}
    </ul>
  )
}

function CallBody({ text, session, loading }: { text: CallText | null | undefined; session?: string; loading: boolean }) {
  if (!session) return <NotRecorded what="Prompts and replies aren't kept with logging off." />
  if (loading) return <p className="muted">Reading the log…</p>
  if (!text) return <NotRecorded what="This call isn't in the log." />
  return (
    <div className="call-text">
      <details>
        <summary>System prompt</summary>
        <pre>{text.system}</pre>
      </details>
      <details open>
        <summary>User prompt</summary>
        <pre>{text.user}</pre>
      </details>
      <details open>
        <summary>Reply</summary>
        <pre>{text.reply || (text.error ? `(failed: ${text.error})` : '(empty)')}</pre>
      </details>
    </div>
  )
}
