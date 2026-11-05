import type { Meters } from '../../../shared/model'
import { characterById, type Content } from '../../../shared/game/content'
import { firstName } from '../../../shared/game/names'
import type { WitnessReport } from '../../../shared/game/summary'
import { Button } from './Button'

const METER_LABEL: [keyof Meters, string][] = [
  ['approval', 'Approval'],
  ['trust', 'Trust'],
  ['attraction', 'Attraction']
]

function Delta({ before, after }: { before: number; after: number }) {
  const d = after - before
  if (d === 0) return <span className="delta">±0</span>
  return <span className={d > 0 ? 'delta up' : 'delta down'}>{d > 0 ? `+${d}` : d}</span>
}

/** One meter as a bar: where it stood at the start of the scene, and where it is now. */
function Meter({ label, before, after }: { label: string; before: number; after: number }) {
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${after}%` }} />
        <div className="meter-was" style={{ left: `${before}%` }} title={`Was ${before}`} />
      </div>
      <span className="meter-value">{after}</span>
      <Delta before={before} after={after} />
    </div>
  )
}

/** After a scene: what each witness remembers, and how their feelings moved (milestone-1 acceptance 7). */
export function SummaryView({ content, reports, onAgain, onTitle }: { content: Content; reports: WitnessReport[]; onAgain: () => void; onTitle: () => void }) {
  const name = (id: string) => firstName(characterById(content, id)?.name ?? id)
  return (
    <div className="screen summary">
      <h1>After the scene</h1>
      <div className="reports">
        {reports.map((r) => (
          <section key={r.id} className="report">
            <header>
              <h2>{name(r.id)}</h2>
              <span className={`level ${r.level}`}>{r.level}</span>
            </header>
            <p className="memory">{r.memory}</p>
            {r.reason && <p className="reason">{r.reason}</p>}
            <div className="meters">
              <div className="meters-title">Toward you</div>
              {METER_LABEL.map(([key, label]) => (
                <Meter key={key} label={label} before={r.before[key]} after={r.after[key]} />
              ))}
            </div>
            {r.others.length > 0 && (
              <div className="others">
                {r.others.map((o) => (
                  <div key={o.with} className="other" title={o.reason || undefined}>
                    <span>
                      Toward {name(o.with)} <em>({o.label})</em>
                    </span>
                    {METER_LABEL.map(([key, label]) => (
                      <span key={key} className="other-meter">
                        {label} {o.after[key]} <Delta before={o.before[key]} after={o.after[key]} />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {r.learned.length > 0 && (
              <div className="learned">
                <div className="meters-title">You learned</div>
                {r.learned.map((fact) => (
                  <p key={fact}>{fact}</p>
                ))}
              </div>
            )}
            {r.error && <p className="report-error">No summary ({r.error}); a plain memory was kept.</p>}
          </section>
        ))}
      </div>
      <div className="row">
        <Button variant="primary" onClick={onAgain}>
          Back to the Sump Lantern
        </Button>
        <Button variant="ghost" onClick={onTitle}>
          Title
        </Button>
      </div>
    </div>
  )
}
