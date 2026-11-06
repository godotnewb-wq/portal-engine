import { characterById, type Pack } from '@engine/pack'
import { firstName } from '@engine/core'
import type { WitnessReport } from '@engine/relationships'
import { Button } from './Button'

function Delta({ before, after }: { before: number; after: number }) {
  const d = after - before
  if (d === 0) return <span className="delta">±0</span>
  return <span className={d > 0 ? 'delta up' : 'delta down'}>{d > 0 ? `+${d}` : d}</span>
}

/** One meter as a bar: where it stood at the start of the scene, and where it is now, across the ruleset's range. */
function Meter({ label, before, after, min, max }: { label: string; before: number; after: number; min: number; max: number }) {
  const at = (v: number) => `${((v - min) / (max - min || 1)) * 100}%`
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: at(after) }} />
        <div className="meter-was" style={{ left: at(before) }} title={`Was ${before}`} />
      </div>
      <span className="meter-value">{after}</span>
      <Delta before={before} after={after} />
    </div>
  )
}

/** After a scene: what each witness remembers, and how their feelings moved (milestone-1 acceptance 7). */
export function SummaryView({ content, reports, againLabel, onAgain, onTitle }: { content: Pack; reports: WitnessReport[]; againLabel: string; onAgain: () => void; onTitle: () => void }) {
  const name = (id: string) => firstName(characterById(content, id)?.name ?? id)
  // The pack's relationship meters, in its order.
  const meters = content.ruleset.meters.list
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
              {meters.map((m) => (
                <Meter key={m.id} label={m.name} before={r.before[m.id] ?? 0} after={r.after[m.id] ?? 0} min={content.ruleset.meters.min} max={content.ruleset.meters.max} />
              ))}
            </div>
            {r.others.length > 0 && (
              <div className="others">
                {r.others.map((o) => (
                  <div key={o.with} className="other" title={o.reason || undefined}>
                    <span>
                      Toward {name(o.with)} <em>({o.label})</em>
                    </span>
                    {meters.map((m) => (
                      <span key={m.id} className="other-meter">
                        {m.name} {o.after[m.id]} <Delta before={o.before[m.id] ?? 0} after={o.after[m.id] ?? 0} />
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
          {againLabel}
        </Button>
        <Button variant="ghost" onClick={onTitle}>
          Title
        </Button>
      </div>
    </div>
  )
}
