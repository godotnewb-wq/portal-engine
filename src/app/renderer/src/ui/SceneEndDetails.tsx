import { useState } from 'react'
import { feelingLabel } from '@engine/characters'
import type { Pack } from '@engine/pack'
import type { SceneEndDetails as Details } from '@platform/logs'
import { CallList, DetailsOverlay, NotRecorded, type DetailsTab } from './DetailsOverlay'

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

/**
 * The scene's end in detail (milestone 4d, decided 2026-11-19, user): what each witness's relationship call said and
 * why, the ties stated and how they settled, the player's answers, what each witness took into memory, and the calls.
 * A developer view like Turn details, so feelings the summary screen keeps hidden show here.
 */
export function SceneEndDetails({ content, details, onClose }: { content: Pack; details: Details; onClose: () => void }) {
  const [tab, setTab] = useState('people')
  return <DetailsOverlay title="The scene's end" tab={tab} onTab={setTab} onClose={onClose} tabs={sceneEndTabs(content, details)} />
}

/** The overlay's tabs for a scene's end; exported so each tab can be tested on its own (milestone 4d task 3). */
export function sceneEndTabs(content: Pack, details: Details): DetailsTab[] {
  const name = (id: string) => (id === 'player' ? content.player.name : (content.characters.find((c) => c.id === id)?.name.split(' ')[0] ?? id))
  const meter = (id: string) => content.ruleset.meters.list.find((m) => m.id === id)?.name ?? id
  const ties = details.ties
  const end = details.end
  // Each witness's two calls, named for the Calls tab: the traces pair every witness with their call's id.
  const about = new Map([...(ties?.witnesses ?? []), ...(end?.witnesses ?? [])].map((w) => [w.callId, name(w.id)]))
  const failed = [...(ties?.witnesses ?? []), ...(end?.witnesses ?? [])].filter((w) => w.error).length
  const tabs: DetailsTab[] = [
    {
      id: 'people',
      label: 'People',
      count: ties?.witnesses.length ?? end?.witnesses.length ?? 0,
      render: () =>
        !ties ? (
          <NotRecorded what="The relationship calls didn't run (nothing was said), or this is a scene from before milestone 4c." />
        ) : (
          <div className="people-cards">
            {ties.witnesses.map((w) => {
              const r = w.relationship
              const report = end?.witnesses.find((x) => x.id === w.id)?.report
              return (
                <section key={w.id} className="person-card">
                  <h3>{name(w.id)}</h3>
                  {!r ? (
                    <p className="warn">The call failed{w.error ? `: ${w.error}` : ''}; nothing changed for them.</p>
                  ) : (
                    <ul>
                      <li>
                        Toward {content.player.name}: {Object.entries(r.delta).map(([k, v]) => `${meter(k)} ${signed(v)}`).join(', ') || 'unchanged'}
                        {report && <span className="muted"> ({Object.keys(report.after).map((k) => `${meter(k)} ${report.before[k]} → ${report.after[k]}`).join(', ')})</span>}
                        <div className="muted">{r.reason}</div>
                      </li>
                      {r.others.map((o) => (
                        <li key={o.with}>
                          Toward {name(o.with)}: {Object.entries(o.delta).map(([k, v]) => `${meter(k)} ${signed(v)}`).join(', ') || 'unchanged'}
                          <div className="muted">{o.reason}</div>
                        </li>
                      ))}
                      {r.feels && (
                        <li>
                          Mood: {String(r.feels.shade ?? '?')} {r.feels.intensity !== undefined && `(${String(r.feels.intensity)})`}
                          {typeof r.feels.reason === 'string' && <span className="muted"> — {r.feels.reason}</span>}
                        </li>
                      )}
                      {r.toward.map((f, i) => (
                        <li key={i}>
                          Carries toward {name(String(f.who ?? '?'))}: {String(f.shade ?? '?')} {f.intensity !== undefined && `(${String(f.intensity)})`}
                          {typeof f.reason === 'string' && <span className="muted"> — {f.reason}</span>}
                        </li>
                      ))}
                      {r.resolved.length > 0 && <li>Settled a feeling toward {r.resolved.map(name).join(', ')}</li>}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        )
    },
    {
      id: 'ties',
      label: 'Ties',
      count: (ties?.applied.length ?? 0) + (end?.answered?.length ?? 0),
      warn: (ties?.refused.length ?? 0) > 0,
      render: () =>
        !ties ? (
          <NotRecorded what="No relationship calls ran for this scene." />
        ) : (
          <>
            <section>
              <h3>Stated <small>(each witness, first-person)</small></h3>
              {ties.stated.length > 0 ? (
                <ul>
                  {ties.stated.map((t, i) => (
                    <li key={i}>
                      {name(t.by)}: {name(t.with)} {t.now ? `is now my ${t.now}` : `is no longer my ${t.no_longer}`} <span className="muted">— “{t.line}”</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">None.</p>
              )}
            </section>
            <section>
              <h3>Applied</h3>
              {ties.applied.length > 0 ? (
                <ul>
                  {ties.applied.map((e, i) => (
                    <li key={i}>
                      {name(e.from)} → {name(e.to)}: {[...e.added.map((x) => `+${x}`), ...e.ended.map((x) => `−${x}`)].join(' ')}
                      {e.word && ` (“${e.word}”)`}
                      {e.line && <span className="muted"> — “{e.line}”</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">None.</p>
              )}
            </section>
            <section>
              <h3>Asked of {content.player.name}</h3>
              {end?.answered && end.answered.length > 0 ? (
                <ul>
                  {end.answered.map((a, i) => (
                    <li key={i}>
                      {name(a.change.from)} → {name(a.change.to)}: {a.change.add ? `+${a.change.add}` : ''} {a.change.end ? `−${a.change.end}` : ''} · <b>{a.accepted ? 'yes' : 'no'}</b>
                    </li>
                  ))}
                </ul>
              ) : ties.pending.length > 0 ? (
                <p className="muted">Asked, not yet answered.</p>
              ) : (
                <p className="muted">Nothing.</p>
              )}
            </section>
            {(ties.alone ?? []).length > 0 && (
              <section>
                <h3>One side only, no change</h3>
                <ul>
                  {ties.alone!.map((x, i) => (
                    <li key={i} className="muted">
                      {x}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {ties.refused.length > 0 && (
              <section>
                <h3>Refused</h3>
                <ul>
                  {ties.refused.map((x, i) => (
                    <li key={i} className="warn">
                      {x}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )
    },
    {
      id: 'memory',
      label: 'Memory',
      count: end?.witnesses.reduce((n, w) => n + (w.report?.memories.length ?? 0), 0) ?? 0,
      render: () =>
        !end ? (
          <NotRecorded what="The memory calls haven't run yet." />
        ) : (
          <div className="people-cards">
            {end.witnesses.map((w) => {
              const r = w.report
              return (
                <section key={w.id} className="person-card">
                  <h3>{name(w.id)}</h3>
                  {!r ? (
                    <p className="warn">No report{w.error ? `: ${w.error}` : ''}.</p>
                  ) : (
                    <ul>
                      {r.memories.map((m) => (
                        <li key={m.id}>
                          <span className="muted">({m.level})</span> {m.text}
                        </li>
                      ))}
                      {r.revisited.map((m) => (
                        <li key={m.id} className="muted">
                          Came back to {m.id}, now {m.level}
                        </li>
                      ))}
                      {r.memoryNotes.map((n, i) => (
                        <li key={i} className="muted">
                          Note: {n}
                        </li>
                      ))}
                      {r.heard.map((id) => (
                        <li key={id}>
                          Learned a secret: <code>{id}</code>
                        </li>
                      ))}
                      {r.learned.map((f, i) => (
                        <li key={i}>{content.player.name} learned: {f}</li>
                      ))}
                      {r.carried?.aftermath && <li>Carries: {feelingLabel(r.carried.aftermath)}</li>}
                      {r.carried?.toward.map((t) => (
                        <li key={t.toward}>
                          Carries toward {name(t.toward)}: {feelingLabel(t.feeling)}
                          {t.renewed && ' (renewed)'}
                          {t.repeat && <span className="muted"> — repeat {t.repeat.count}: {t.repeat.meter} {signed(t.repeat.change)}</span>}
                        </li>
                      ))}
                      {r.carried?.resolved.map((who) => (
                        <li key={who} className="muted">
                          Resolved toward {name(who)}
                        </li>
                      ))}
                      {r.error && <li className="warn">The memory call failed ({r.error}); a plain memory was kept.</li>}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        )
    },
    {
      id: 'calls',
      label: 'Calls',
      count: (ties?.calls.length ?? 0) + (end?.calls.length ?? 0),
      warn: failed > 0,
      render: () => (
        <section>
          <h3>
            Calls <small>(click a call for its prompt and reply)</small>
          </h3>
          <CallList calls={[...(ties?.calls ?? []), ...(end?.calls ?? [])]} about={about} {...(details.session && { session: details.session })} />
        </section>
      )
    }
  ]
  return tabs
}
