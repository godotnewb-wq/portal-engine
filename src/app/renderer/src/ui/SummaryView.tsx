import { characterById, type Pack } from '@engine/pack'
import { firstName } from '@engine/core'
import type { WitnessReport } from '@engine/relationships'
import { bandWord, type Ruleset } from '@engine/rules'
import { Button } from './Button'

/** Which way a meter moved, without the number (relationships §1: the player sees bands, not values). */
function Delta({ before, after }: { before: number; after: number }) {
  if (after === before) return <span className="delta">·</span>
  return <span className={after > before ? 'delta up' : 'delta down'}>{after > before ? '▲' : '▼'}</span>
}

/**
 * One meter as a bar from neutral to where it is now, with a mark where it stood at the start of the scene, and the
 * band it now falls in, in words. No numbers: the game keeps those.
 */
function Meter({ ruleset, id, label, before, after }: { ruleset: Ruleset; id: string; label: string; before: number; after: number }) {
  const { min, max, neutral } = ruleset.meters
  const at = (v: number) => ((v - min) / (max - min || 1)) * 100
  const from = Math.min(at(neutral), at(after))
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <div className="meter-track">
        <div className="meter-neutral" style={{ left: `${at(neutral)}%` }} />
        <div className={after < neutral ? 'meter-fill below' : 'meter-fill'} style={{ left: `${from}%`, width: `${Math.abs(at(after) - at(neutral))}%` }} />
        <div className="meter-was" style={{ left: `${at(before)}%` }} title={`Was: ${bandWord(ruleset, id, before)}`} />
      </div>
      <span className="meter-value">{bandWord(ruleset, id, after)}</span>
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
                <Meter key={m.id} ruleset={content.ruleset} id={m.id} label={m.name} before={r.before[m.id] ?? content.ruleset.meters.neutral} after={r.after[m.id] ?? content.ruleset.meters.neutral} />
              ))}
            </div>
            {r.others.length > 0 && (
              <div className="others">
                {r.others.map((o) => (
                  <div key={o.with} className="other" title={o.reason || undefined}>
                    <span>
                      Toward {name(o.with)}
                    </span>
                    {meters.map((m) => (
                      <span key={m.id} className="other-meter">
                        {m.name}: {bandWord(content.ruleset, m.id, o.after[m.id] ?? content.ruleset.meters.neutral)} <Delta before={o.before[m.id] ?? content.ruleset.meters.neutral} after={o.after[m.id] ?? content.ruleset.meters.neutral} />
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
