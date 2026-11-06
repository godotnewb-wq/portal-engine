import type { FlagRecord } from '@engine/review'
import { RUBRIC } from '@engine/review'
import type { CheckTrace } from '@engine/scene'
import type { TurnDetails as Details } from '@platform/logs'
import { Button } from './Button'

interface Props {
  /** Names an id in this scene: a character's first name, a walk-on's name, or the id. */
  nameOf: (id: string) => string
  details: Details | null
  /** Still being read from the logs. */
  loading: boolean
  /** Flags standing on this turn: its beats', and the turn's own (no beat). */
  flags: FlagRecord[]
  /** Whether the turn was logged, so it can be flagged. */
  flaggable: boolean
  onFlagTurn: () => void
  /** Jumps reading to a beat of this turn (1-based). */
  onBeat: (n: number) => void
  onClose: () => void
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

/** A check as arithmetic: dice, then each modifier, then the total against the DC. */
function checkSum(c: CheckTrace, nameOf: (id: string) => string): string {
  const dice = c.rolls.length > 1 ? `d20 ${c.rolls.join('/')} (${c.edge}) → ${c.natural}` : `d20 ${c.natural}`
  const parts = [dice, `${c.attribute} ${signed(c.modifier)}`, `rank ${signed(c.rank)}`, ...(c.bonus ? [`bonus ${signed(c.bonus)}`] : [])]
  const assist = c.assist ? ` · assist ${nameOf(c.assist.by)} (meter ${c.assist.meter}): ${c.assist.bonus ? `+${c.assist.bonus}` : c.assist.edge !== 'none' ? c.assist.edge : 'no help'}` : ''
  return `${parts.join(' ')} = ${c.total} vs DC ${c.dc} (${c.difficulty}) → ${c.degree}${c.critical ? `, critical ${c.critical}` : ''}${assist}`
}

const mark = (r?: FlagRecord) => (r ? <span className={`flag-mark ${r.flag!.rating}`}>⚑ {r.flag!.rating}</span> : null)

/**
 * The Turn details panel (milestone 2, A3): the turn's plan, check breakdowns, code findings, rewrite and timings,
 * from its trace; its beats with their flags; and AI scores when the turn has been scored.
 */
export function TurnDetails({ nameOf, details, loading, flags, flaggable, onFlagTurn, onBeat, onClose }: Props) {
  const turnFlag = flags.find((f) => f.beat === undefined)
  return (
    <aside className="turn-details" onClick={(e) => e.stopPropagation()}>
      <header>
        <strong>{details ? `Turn ${details.turn.turn}` : 'Turn details'}</strong>
        {mark(turnFlag)}
        <span className="spacer" />
        <Button size="sm" variant="ghost" onClick={onFlagTurn} disabled={!flaggable} title={flaggable ? 'Flag the whole turn (Shift+F)' : 'This turn was not logged'}>
          Flag turn
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </header>
      {loading && <p className="status">Reading the log…</p>}
      {!loading && !details && <p className="status">No details: this turn wasn't logged, or its log is gone.</p>}
      {details && <Body details={details} nameOf={nameOf} flags={flags} onBeat={onBeat} />}
    </aside>
  )
}

function Body({ details, nameOf, flags, onBeat }: { details: Details; nameOf: (id: string) => string; flags: FlagRecord[]; onBeat: (n: number) => void }) {
  const t = details.turn
  const plan = t.director.plan
  const scores = details.scores.at(-1)
  return (
    <div className="details-body">
      <section>
        <h3>Plan {t.director.read !== 'json' && <small>({t.director.read === 'unreadable' ? 'reply unreadable; the game planned it' : 'retried without JSON mode'})</small>}</h3>
        <ul>
          {plan.speakers.map((s) => (
            <li key={s.id}>
              <b>{nameOf(s.id)}</b> speaks: {s.intent}
              {s.mood && <i> — {s.mood}</i>}
              {s.hiding && <span className="muted"> · hiding {s.hiding} ({s.approach ?? 'deflect'})</span>}
            </li>
          ))}
          {plan.reactions.map((r) => (
            <li key={r.id} className="muted">
              {nameOf(r.id)} reacts: {r.beat}
            </li>
          ))}
          {plan.walk_ons.map((w) => (
            <li key={w.id} className="muted">
              {nameOf(w.id)}: {w.line}
            </li>
          ))}
          {plan.texture.length > 0 && <li className="muted">Texture: {plan.texture.join('; ')}</li>}
          {plan.avoid.length > 0 && <li className="muted">Avoid: {plan.avoid.join('; ')}</li>}
          {t.director.corrections.map((c) => (
            <li key={c} className="warn">
              ⚙ {c}
            </li>
          ))}
        </ul>
      </section>
      {t.checks.length > 0 && (
        <section>
          <h3>Checks</h3>
          <ul>
            {t.checks.map((c) => (
              <li key={c.id}>
                <b>{c.line}</b>
                <div className="muted mono">{checkSum(c, nameOf)}</div>
                <div className="muted">Stakes: {c.stakes}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(t.findings.length > 0 || t.rewrite) && (
        <section>
          <h3>Code checks</h3>
          <ul>
            {t.findings.map((p, i) => (
              <li key={i} className="warn">
                {p.kind}
                {p.text && <span className="muted"> “{p.text}”</span>}
              </li>
            ))}
            {t.rewrite && <li>↻ rewritten{t.rewrite.remaining.length > 0 ? `; still wrong: ${t.rewrite.remaining.map((p) => p.kind).join(', ')}` : '; clean'}</li>}
            {t.rewrite?.salvage && (
              <li className="warn">
                Salvaged: dropped beat{t.rewrite.salvage.dropped.length === 1 ? '' : 's'} {t.rewrite.salvage.dropped.join(', ') || 'none'}, cut {t.rewrite.salvage.cut}
              </li>
            )}
          </ul>
        </section>
      )}
      <section>
        <h3>Beats</h3>
        <ol className="detail-beats">
          {t.beats.map((b) => {
            const flag = flags.find((f) => f.beat === b.index)
            const ai = scores?.beats.find((m) => m.beat === b.index)
            return (
              <li key={b.index} onClick={() => onBeat(b.index)} title={`${b.source}, line ${b.line} · ${b.plan.join(', ')}`}>
                <span className="who">{b.beat.kind === 'narration' ? '—' : nameOf(b.beat.speaker)}</span> {b.beat.text.length > 90 ? `${b.beat.text.slice(0, 90)}…` : b.beat.text}
                {mark(flag)}
                {ai && <span className={`flag-mark ai ${ai.rating}`}>AI {ai.rating}</span>}
              </li>
            )
          })}
        </ol>
      </section>
      <section>
        <h3>Calls</h3>
        <ul className="mono">
          {details.calls.map((c) => (
            <li key={c.id}>
              {c.role}: {c.model ?? '?'} · {c.ms} ms{c.firstTextMs !== undefined && ` (first text ${c.firstTextMs} ms)`}
              {c.tokens && ` · ${c.tokens.input ?? '?'}→${c.tokens.output ?? '?'} tok`}
              {c.restarted && ' · restarted on fallback profile'}
              {c.error && <span className="warn"> · {c.error}</span>}
            </li>
          ))}
          <li className="muted">Turn: {t.cost.ms} ms</li>
        </ul>
      </section>
      {scores && (
        <section>
          <h3>AI scores <small>(scorer v{scores.scorer.version}{scores.scorer.model ? `, ${scores.scorer.model}` : ''})</small></h3>
          <ul>
            {scores.items.map((s) => (
              <li key={s.id}>
                <b>{s.score}</b> {RUBRIC.find((r) => r.id === s.id)?.name ?? s.id}: <span className="muted">{s.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
