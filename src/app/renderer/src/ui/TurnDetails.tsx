import { useState, type ReactNode } from 'react'
import type { FlagRecord } from '@engine/review'
import { RUBRIC } from '@engine/review'
import { feelingLabel, type Feeling } from '@engine/characters'
import { lineText, moodOf, planLines, type BriefTrace, type CheckTrace } from '@engine/scene'
import type { Bookkeeping } from '@engine/state'
import type { BookkeepingRecord, TurnDetails as Details } from '@platform/logs'
import { Button } from './Button'
import { CallList, DetailsOverlay, NotRecorded, type DetailsTab } from './DetailsOverlay'

interface Props {
  /** Names an id in this scene: a character's first name, a walk-on's name, or the id. */
  nameOf: (id: string) => string
  details: Details | null
  /** Still being read from the logs. */
  loading: boolean
  /** The turn's records as the save keeps them, for a turn not logged (logging off). */
  stateRecords?: Bookkeeping
  /** Flags standing on this turn: its beats', and the turn's own (no beat). */
  flags: FlagRecord[]
  /** Whether the turn was logged, so it can be flagged. */
  flaggable: boolean
  onFlagTurn: () => void
  /** Jumps reading to a beat of this turn (1-based). */
  onBeat: (n: number) => void
  /** Reads the turn back from the log again: the bookkeeper may have answered since. */
  onRefresh?: () => void
  onClose: () => void
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

/** A check as arithmetic: dice, then each modifier, then the total against the DC. */
function checkSum(c: CheckTrace, nameOf: (id: string) => string): string {
  const dice = c.rolls.length > 1 ? `d20 ${c.rolls.join('/')} (${c.edge}) → ${c.natural}` : `d20 ${c.natural}`
  const parts = [dice, `${c.attribute} ${signed(c.modifier)}`, `rank ${signed(c.rank)}`, ...(c.bonus ? [`bonus ${signed(c.bonus)}`] : [])]
  const assist = c.helpers?.length ? ` · helped by ${c.helpers.map(nameOf).join(', ')} (+${c.bonus})` : ''
  return `${parts.join(' ')} = ${c.total} vs DC ${c.dc} (${c.difficulty}) → ${c.degree}${c.critical ? `, critical ${c.critical}` : ''}${assist}`
}

const mark = (r?: FlagRecord) => (r ? <span className={`flag-mark ${r.flag!.rating}`}>⚑ {r.flag!.rating}</span> : null)
const feeling = (f?: Feeling) => (f ? `${feelingLabel(f)} (${f.family})` : '—')

/** Why a secret was first in line to be shown in full (milestone 3.5). */
const SECRET_PRIORITY = { kept: 'kept last turn', keyword: 'its words came up', context: 'its subject is in play' } as const

/**
 * Turn details (milestone 2, A3; milestone 4d: a full overlay with tabs by meaning). What happened, each person, the
 * secrets and knowledge in play, the lore, the checks, what was fixed, the calls, and the bookkeeper's records. A field
 * an older log didn't record says so.
 */
export function TurnDetails({ nameOf, details, loading, stateRecords, flags, flaggable, onFlagTurn, onBeat, onRefresh, onClose }: Props) {
  const [tab, setTab] = useState('turn')
  const turnFlag = flags.find((f) => f.beat === undefined)
  const title = (
    <>
      {details ? `Turn ${details.turn.turn}` : 'Turn details'} {mark(turnFlag)}
    </>
  )
  const actions = (
    <Button size="sm" variant="ghost" onClick={onFlagTurn} disabled={!flaggable} title={flaggable ? 'Flag the whole turn (Shift+F)' : 'This turn was not logged'}>
      Flag turn
    </Button>
  )
  if (!details) {
    const status = loading ? 'Reading the log…' : "No details: this turn wasn't logged, or its log is gone."
    return <DetailsOverlay title={title} actions={actions} tab="none" onTab={() => {}} onClose={onClose} tabs={[{ id: 'none', label: 'Turn', render: () => <p className="status">{status}</p> }]} />
  }
  const record: Pick<BookkeepingRecord, 'records' | 'late' | 'error'> | undefined = details.records ?? (stateRecords && { records: stateRecords })
  return <DetailsOverlay title={title} actions={actions} tab={tab} onTab={setTab} onClose={onClose} tabs={turnTabs(details, record, nameOf, flags, (n) => (onClose(), onBeat(n)), onRefresh)} />
}

/** The overlay's tabs for one turn; exported so each tab can be tested on its own (milestone 4d task 3). */
export function turnTabs(details: Details, record: Pick<BookkeepingRecord, 'records' | 'late' | 'error'> | undefined, nameOf: (id: string) => string, flags: FlagRecord[], onBeat: (n: number) => void, onRefresh?: () => void): DetailsTab[] {
  const t = details.turn
  const plan = t.director.plan
  const r = record?.records
  const people = [...new Set([...t.cast.before, ...t.cast.after].map((c) => c.id))]
  const fixes = t.director.corrections.length + t.findings.length + t.tags.dropped.length + (t.rewrite ? 1 : 0)
  const missing = (
    <div className="not-recorded">
      <p className="muted">The bookkeeper's records aren't here: it may still be reading this turn, or the log is from before milestone 4c.</p>
      {onRefresh && (
        <Button size="sm" variant="ghost" onClick={onRefresh}>
          Read the log again
        </Button>
      )}
    </div>
  )
  return [
    { id: 'turn', label: 'Turn', count: flags.length, render: () => <TurnTab details={details} nameOf={nameOf} flags={flags} onBeat={onBeat} /> },
    { id: 'people', label: 'People', count: people.length, render: () => <PeopleTab details={details} people={people} nameOf={nameOf} /> },
    { id: 'secrets', label: 'Secrets and knowledge', count: r ? r.out.length + r.leaks.length : 0, warn: !!r && r.leaks.length > 0, render: () => <SecretsTab details={details} records={r} missing={missing} nameOf={nameOf} /> },
    { id: 'lore', label: 'Lore', count: t.lore?.triggered.length ?? 0, render: () => (t.lore ? <Lore lore={t.lore} plan={plan} nameOf={nameOf} /> : <NotRecorded what="This log is from before the codex (milestone 3)." />) },
    { id: 'checks', label: 'Checks', count: t.checks.length, warn: !!r && r.checks.some((c) => c.honored === false), render: () => <ChecksTab checks={t.checks} records={r} nameOf={nameOf} /> },
    { id: 'fixes', label: 'Fixes', count: fixes, warn: fixes > 0, render: () => <FixesTab details={details} /> },
    { id: 'calls', label: 'Calls', count: details.calls.length, render: () => <CallsTab details={details} /> },
    { id: 'records', label: 'Records', count: r ? r.refused.length : 0, warn: !!r && (r.refused.length > 0 || !!r.unaudited), render: () => (record ? <RecordsTab record={record} plan={plan} nameOf={nameOf} /> : missing) }
  ]
}

/** What happened: the player's words, what the director meant to change, the outline, and the beats as read. */
function TurnTab({ details, nameOf, flags, onBeat }: { details: Details; nameOf: (id: string) => string; flags: FlagRecord[]; onBeat: (n: number) => void }) {
  const t = details.turn
  const plan = t.director.plan
  const scores = details.scores.at(-1)
  const lines = planLines(plan)
  return (
    <>
      <section>
        <h3>The player</h3>
        <p>{t.input}</p>
        {plan.player_action?.doing && <p className="muted">Read as: {plan.player_action.doing}{plan.player_action.uncertain ? ' (uncertain, so it needed a check)' : ''}</p>}
      </section>
      {plan.scene ? (
        <section>
          <h3>What's at stake</h3>
          <p>{plan.scene.stakes || <span className="muted">None given.</span>}</p>
        </section>
      ) : (
        <section>
          <h3>The change the director meant</h3>
          <p>{plan.change || <span className="muted">None given.</span>}</p>
        </section>
      )}
      {plan.scene && (
        // The scene plan (Milestone 5 task 4): the moment for each person in focus and what pressed live, in place of moves.
        <section>
          <h3>The moment {t.director.read !== 'json' && <small>({t.director.read === 'unreadable' ? 'reply unreadable; the game planned it' : 'retried without JSON mode'})</small>}</h3>
          <ul>
            {plan.scene.moments.map((m) => (
              <li key={m.who}>
                <b>{nameOf(m.who)}</b>: {m.lands} <span className="muted">· wants {m.wants}</span>
              </li>
            ))}
          </ul>
          {plan.scene.pressures.length > 0 && (
            <>
              <h4>Pressing live</h4>
              <ul>
                {plan.scene.pressures.map((x, i) => (
                  <li key={i}>
                    {nameOf(x.who)}: {x.kind === 'secret' ? <><code>{x.ref}</code>{x.approach && ` (${x.approach})`}{x.touched && <span className="muted"> · touched by “{x.touched}”</span>}</> : x.kind === 'tie' ? `the tie with ${x.ref === 'player' ? 'the player' : nameOf(x.ref)}` : `the aim${x.strength ? ` (${x.strength})` : ''}: ${x.text}`}
                  </li>
                ))}
              </ul>
            </>
          )}
          {plan.walk_ons.length > 0 && <p className="muted">Walk-ons: {plan.walk_ons.map((w) => `${nameOf(w.id)}: ${w.line}`).join('; ')}</p>}
          {plan.leaves.length > 0 && <p className="muted">Leaves: {plan.leaves.map(nameOf).join(', ')}</p>}
          {plan.scene.end_scene && <p className="muted">Ends the scene.</p>}
        </section>
      )}
      {!plan.scene && <section>
        <h3>Outline {t.director.read !== 'json' && <small>({t.director.read === 'unreadable' ? 'reply unreadable; the game planned it' : 'retried without JSON mode'})</small>}</h3>
        {plan.moves && plan.moves.length > 0 ? (
          <ol>
            {plan.moves.map((m, i) => (
              <li key={i}>
                <b>{nameOf(m.who)}</b> → {m.answers === 'player' ? 'the player' : `move ${m.answers}`}: {m.move}
                {m.says.length > 0 && <span className="muted"> · draws on {m.says.map((s) => (s.id ? s.id : `new: “${s.text}”`)).join('; ')}</span>}
                {m.needs && <span className="muted"> · needs {m.needs}</span>}
              </li>
            ))}
          </ol>
        ) : lines.length > 0 ? (
          <ol>
            {lines.map((_, i) => (
              <li key={i}>{lineText(lines, i, nameOf).replace(/^\d+\. /, '')}</li>
            ))}
          </ol>
        ) : (
          <p className="muted">No lines planned.</p>
        )}
        {plan.walk_ons.length > 0 && <p className="muted">Walk-ons: {plan.walk_ons.map((w) => `${nameOf(w.id)}: ${w.line}`).join('; ')}</p>}
        {plan.leaves.length > 0 && <p className="muted">Leaves: {plan.leaves.map(nameOf).join(', ')}</p>}
      </section>}
      <section>
        <h3>Beats <small>(click one to read from it)</small></h3>
        <ol className="detail-beats">
          {t.beats.map((b) => {
            const flag = flags.find((f) => f.beat === b.index)
            const ai = scores?.beats.find((m) => m.beat === b.index)
            return (
              <li key={b.index} onClick={() => onBeat(b.index)} title={`${b.source}, line ${b.line} · ${b.plan.join(', ')}`}>
                <span className="who">{b.beat.kind === 'narration' ? '—' : nameOf(b.beat.speaker)}</span> {b.beat.text}
                {mark(flag)}
                {ai && <span className={`flag-mark ai ${ai.rating}`}>AI {ai.rating}</span>}
              </li>
            )
          })}
        </ol>
      </section>
    </>
  )
}

/**
 * A person's director brief (decided 2026-11-20, Milestone 5 task 4): what it always costs, the optional detail chosen
 * and why, what didn't fit, and what a change of topic let go, from the trace's `brief`.
 */
function BriefLine({ brief, id }: { brief: BriefTrace; id: string }) {
  const chosen = brief.selected.filter((d) => d.owner === id)
  const cut = brief.cut.filter((d) => d.owner === id)
  const dropped = brief.dropped.filter((d) => d.startsWith(`${id}.`) || d.startsWith(`${id}:`))
  return (
    <li>
      Brief: ≈{brief.recurring[id] ?? 0} tokens always{brief.memories?.[id] ? `, ≈${brief.memories[id]} of memories` : ''}
      {chosen.length > 0 && <div className="muted">Detail chosen: {chosen.map((d) => `${d.id} (${d.rank}: ${d.trigger}, ≈${d.tokens})`).join('; ')}</div>}
      {cut.length > 0 && <div className="warn">Cut: {cut.map((d) => `${d.id} (${d.why === 'budget' ? 'over the budget' : 'over the cap for people not here'})`).join('; ')}</div>}
      {dropped.length > 0 && <div className="muted">Let go on a change of topic: {dropped.join(', ')}</div>}
    </li>
  )
}

/** One card per person: what they felt and how much showed, what they kept, who read them, what they remembered. */
function PeopleTab({ details, people, nameOf }: { details: Details; people: string[]; nameOf: (id: string) => string }) {
  const t = details.turn
  const plan = t.director.plan
  return (
    <div className="people-cards">
      {people.map((id) => {
        const speaker = plan.speakers.find((s) => s.id === id)
        const reaction = plan.reactions.find((x) => x.id === id)
        const shown = t.shown?.find((s) => s.id === id)
        const before = t.cast.before.find((c) => c.id === id)
        const after = t.cast.after.find((c) => c.id === id)
        const reads = (plan.reads ?? []).filter((x) => x.target === id)
        const recalled = t.brief?.recalled?.[id] ?? []
        const brought = (t.brief?.selected ?? []).filter((d) => d.owner === id && d.kind === 'memory')
        const moment = plan.scene?.moments.find((m) => m.who === id)
        const pressing = plan.scene?.pressures.find((x) => x.who === id)
        const pool = plan.scene?.pools[id] ?? []
        return (
          <section key={id} className="person-card">
            <h3>
              {nameOf(id)} {after?.departed && <small>(left)</small>}
            </h3>
            <ul>
              {moment ? (
                <li>
                  In the moment: {moment.lands} <span className="muted">· wants {moment.wants}{plan.scene!.strengths[id] && ` · aim ${plan.scene!.strengths[id]}`}</span>
                </li>
              ) : plan.scene ? (
                <li className="muted">Here, not in focus: may react or say a little.</li>
              ) : (
                <>
                  {speaker && <li>Speaks: {speaker.intent || <span className="muted">no aim given</span>}{speaker.pressure && <span className="muted"> · pressure {speaker.pressure}</span>}</li>}
                  {reaction && <li>Reacts: {reaction.beat}</li>}
                  {!speaker && !reaction && <li className="muted">Silent this turn.</li>}
                </>
              )}
              {pressing && <li>Underneath: {pressing.kind === 'secret' ? `secret ${pressing.ref}` : pressing.kind === 'tie' ? `the tie with ${pressing.ref === 'player' ? 'the player' : nameOf(pressing.ref)}` : 'the aim'}{pressing.approach && ` (${pressing.approach})`}</li>}
              {pool.length > 0 && <li>May draw on: {pool.map((f) => (f.source === 'plan' ? `“${f.text}”` : f.id)).join(', ')}</li>}
              <li>
                Felt: {feeling(speaker?.feels ?? reaction?.feels ?? after?.feeling)}
                {speaker && !speaker.feels && moodOf(speaker) && <span className="muted"> · mood words: {moodOf(speaker)}</span>}
              </li>
              {t.shown ? (
                shown ? (
                  <li>
                    Showed: <b>{shown.band}</b> <span className="muted">(visibility {shown.visibility}: intensity {shown.feeling.intensity}, masking {shown.masking}, audience {signed(shown.audience.value)}{shown.audience.why && `: ${shown.audience.why}`})</span>
                    {shown.display && <div className="muted">Looks like: {shown.display}</div>}
                  </li>
                ) : (
                  <li className="muted">No feeling to show.</li>
                )
              ) : (
                <li className="muted">How much showed: not recorded (a log from before milestone 4d).</li>
              )}
              {speaker?.hiding && (
                <li>
                  Kept: {speaker.hiding} <span className="muted">({speaker.approach ?? 'deflect'}{speaker.kept?.length ? `; ${speaker.kept.join(', ')}` : ''})</span>
                  {speaker.tell && <div className="muted">Tell: {speaker.tell}</div>}
                </li>
              )}
              {reads.map((x, i) => (
                <li key={i}>
                  Read by {x.by === 'player' ? 'the player' : nameOf(x.by)}: saw {feelingLabel(x.feeling)}
                  {x.hiding && ', and that something was hidden'}
                </li>
              ))}
              {t.brief?.recalled === undefined && t.brief ? (
                <li className="muted">Memories recalled: not recorded (a log from before milestone 4d).</li>
              ) : (
                recalled.length + brought.length > 0 && (
                  <li>
                    Memories brought in: {[...recalled, ...brought.map((d) => `${d.id} (${d.trigger})`)].join(', ')}
                  </li>
                )
              )}
              {t.brief && <BriefLine brief={t.brief} id={id} />}
              {before && after && (
                <li className="muted">
                  Comfort {before.comfort === after.comfort ? after.comfort : `${before.comfort} → ${after.comfort}`} · expression {after.expression}
                  {after.meters && ` · toward the player ${Object.keys(after.meters).map((k) => `${k} ${after.meters![k]}`).join(', ')}`}
                </li>
              )}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** Secrets and knowledge: what came out and to whom, what was only guessed or claimed, facts used, and the secret budget. */
function SecretsTab({ details, records, missing, nameOf }: { details: Details; records?: Bookkeeping; missing: ReactNode; nameOf: (id: string) => string }) {
  const t = details.turn
  const who = (id: string) => (id === 'player' ? 'the player' : id === 'narration' ? 'the narration' : nameOf(id))
  const at = (x: { at: 'player' | number }) => (x.at === 'player' ? "the player's words" : `beat ${x.at}`)
  // The situation plan's facts are its moves' `says`; the scene plan's, the pools the writer was offered (task 4).
  const scenePools = t.director.plan.scene?.pools
  const facts = scenePools
    ? Object.entries(scenePools).flatMap(([who, pool]) => pool.map((f) => ({ who, id: f.source === 'plan' ? undefined : f.id, text: f.text, unheard: f.unheard })))
    : (t.director.plan.moves ?? []).flatMap((m) => m.says.map((s) => ({ who: m.who, ...s })))
  return (
    <>
      <section>
        <h3>On screen <small>(the bookkeeper's reading)</small></h3>
        {!records ? (
          missing
        ) : records.out.length + records.guesses.length + (records.around ?? []).length + (records.partial ?? []).length + records.leaks.length + records.unresolved.length === 0 ? (
          <p className="muted">No secret came up.</p>
        ) : (
          <ul>
            {records.out.map((o, i) => (
              <li key={`o${i}`}>
                <b>Came out</b> ({o.how}): <code>{o.secret}</code> by {who(o.by)}, {at(o)}: “{o.words}” <span className="muted">→ {o.to.map(nameOf).join(', ') || 'no one else'}, and the player</span>
              </li>
            ))}
            {records.leaks.map((l, i) => (
              <li key={`l${i}`} className="warn">
                Leak, a claim that teaches no one: <code>{l.secret}</code> by {who(l.by)}, {at(l)}: “{l.words}”{l.why && <span className="muted"> ({l.why})</span>}
              </li>
            ))}
            {(records.partial ?? []).map((p, i) => (
              <li key={`p${i}`}>
                Partly out, teaching no one: <code>{p.secret}</code> by {who(p.by)}, {at(p)}: “{p.words}”
              </li>
            ))}
            {records.guesses.map((g, i) => (
              <li key={`g${i}`}>
                Guessed: <code>{g.secret}</code> by {who(g.by)}, {at(g)}: “{g.words}”
              </li>
            ))}
            {/* Records logged before "around" existed (2026-11-19) have none. */}
            {(records.around ?? []).map((a, i) => (
              <li key={`a${i}`} className="muted">
                Talked around: <code>{a.secret}</code> by {who(a.by)}, {at(a)}: “{a.words}”
              </li>
            ))}
            {records.unresolved.map((u, i) => (
              <li key={`u${i}`} className="warn">
                Left for review: <code>{u.secret}</code> by {who(u.by)}, {at(u)}: “{u.words}”{u.why && <span className="muted"> ({u.why})</span>}
              </li>
            ))}
          </ul>
        )}
        {records && (records.said ?? []).length > 0 && <p>Facts the player heard: {records.said.map((f) => `${f.text} (${who(f.by)})`).join('; ')}</p>}
        {records && records.new.length > 0 && <p>New details said: {records.new.map((n) => `${n.text} (${who(n.by)})`).join('; ')}</p>}
      </section>
      <section>
        <h3>Facts the plan drew on</h3>
        {facts.length > 0 ? (
          <ul>
            {facts.map((f, i) => (
              <li key={i}>
                {nameOf(f.who)}: {f.id ? <code>{f.id}</code> : 'new'} — {f.text}
                {f.unheard && <span className="muted"> (new to the player)</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None.</p>
        )}
      </section>
      <section>
        <h3>Secrets on the director's sheet</h3>
        {t.lore?.secrets ? (
          t.lore.secrets.length > 0 ? (
            <ul>
              {t.lore.secrets.map((s) => (
                <li key={s.id} title={s.id}>
                  <code>{s.id}</code> <span className="muted">· {s.kind}</span>
                  <span className="muted">
                    {' '}
                    · {s.form === 'full' ? `in full${s.priority ? ` (${SECRET_PRIORITY[s.priority]})` : ''}: cue ≈${s.cueTokens} + ≈${s.expansionTokens} tok` : `cue only${s.priority ? ` (${SECRET_PRIORITY[s.priority]}, didn't fit the budget)` : ''}: ≈${s.cueTokens} tok`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None held here.</p>
          )
        ) : (
          <NotRecorded what="Not recorded (a log from before milestone 3.5)." />
        )}
      </section>
    </>
  )
}

/** Which codex entries reached the director this turn, layer by layer (milestone 3), and the lore lines planned. */
function Lore({ lore, plan, nameOf }: { lore: NonNullable<Details['turn']['lore']>; plan: Details['turn']['director']['plan']; nameOf: (id: string) => string }) {
  const total = lore.tokens.stage + lore.tokens.scene + lore.tokens.triggered
  const b = lore.budgets
  // Older logs carry no budgets; then only the tokens used are shown.
  const used = (field: 'sceneTokens' | 'triggeredTokens', tokens: number) =>
    b ? `≈${tokens} / ${b[field].toLocaleString()} tok${b.set.includes(field) ? ', your setting' : ''}` : `≈${tokens} tok`
  const list = (entries: typeof lore.scene, none: string) =>
    entries.length > 0 ? (
      <ul>
        {entries.map((e) => (
          <li key={e.id} title={e.id}>
            {e.title}
            {e.form === 'summary' && <span className="muted"> · summary only</span>}
          </li>
        ))}
      </ul>
    ) : (
      <p className="muted">{none}</p>
    )
  return (
    <>
      <section>
        <h3>
          Codex <small>(≈{total} tokens to the director)</small>
        </h3>
        <div className="muted layer">Triggered this turn ({used('triggeredTokens', lore.tokens.triggered)})</div>
        {list(lore.triggered, 'Nothing came up.')}
        <div className="muted layer">Active in the scene ({used('sceneTokens', lore.tokens.scene)})</div>
        {list(lore.scene, 'None: no codex lore for this place or these people.')}
        <div className="muted layer">
          Stage: {lore.stage.length} lines, always on (≈{lore.tokens.stage} tok) · writer's stage ≈{lore.tokens.writerStage} tok
          {b && ` · lore lines: up to ${b.loreLines}${b.set.includes('loreLines') ? ', your setting' : ''}`}
        </div>
      </section>
      <section>
        <h3>Lore lines planned</h3>
        {plan.lore && plan.lore.length > 0 ? (
          <ul>
            {plan.lore.map((l) => (
              <li key={l.entry + l.line} title={l.entry}>
                {l.title}
                {l.who && <> for <b>{nameOf(l.who)}</b></>}: {l.line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None.</p>
        )}
      </section>
      <section>
        <h3>Faction stances given</h3>
        {lore.stances && lore.stances.length > 0 ? (
          <ul>
            {lore.stances.map((s) => (
              <li key={s}>{s.replace(/^- /, '')}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">None.</p>
        )}
      </section>
    </>
  )
}

/** Each check with its roll, assists and result, and whether the prose kept the result (the bookkeeper's reading, logged only). */
function ChecksTab({ checks, records, nameOf }: { checks: CheckTrace[]; records?: Bookkeeping; nameOf: (id: string) => string }) {
  if (checks.length === 0) return <p className="muted">No checks this turn.</p>
  return (
    <ul className="spaced">
      {checks.map((c) => {
        const honored = records?.checks.find((x) => x.id === c.id)
        return (
          <li key={c.id}>
            <b>{c.line}</b>
            <div className="muted mono">{checkSum(c, nameOf)}</div>
            <div className="muted">Stakes: {c.stakes}</div>
            <div className={honored?.honored === false ? 'warn' : 'muted'}>
              {!honored || honored.honored === undefined
                ? honored ? 'The prose doesn\'t show whether it worked.' : 'Whether the prose kept it: not recorded.'
                : honored.honored ? `The prose kept the result${honored.words ? `: “${honored.words}”` : '.'}` : `The prose didn't keep the result${honored.note ? `: ${honored.note}` : ''}${honored.words ? ` (“${honored.words}”)` : '.'}`}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** What was fixed or dropped along the way, by kind. */
function FixesTab({ details }: { details: Details }) {
  const t = details.turn
  const none = t.director.corrections.length + t.findings.length + t.tags.dropped.length === 0 && !t.rewrite && !t.writer.reshaped?.length
  if (none) return <p className="muted">Nothing needed fixing.</p>
  return (
    <>
      {(t.director.corrections.length > 0 || t.director.read !== 'json') && (
        <section>
          <h3>The director's plan</h3>
          <ul>
            {t.director.read === 'unreadable' && <li className="warn">The reply couldn't be read; the game planned the turn.</li>}
            {t.director.read === 'json-retried' && <li className="muted">Retried without JSON mode.</li>}
            {t.director.corrections.map((c) => (
              <li key={c} className="warn">
                ⚙ {c}
              </li>
            ))}
          </ul>
        </section>
      )}
      {(t.findings.length > 0 || t.rewrite) && (
        <section>
          <h3>The writer's draft</h3>
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
      {t.writer.reshaped && t.writer.reshaped.length > 0 && (
        <section>
          <h3>Lines reshaped</h3>
          <p className="muted">Speech split from action on line{t.writer.reshaped.length === 1 ? '' : 's'} {t.writer.reshaped.join(', ')} of the reply.</p>
        </section>
      )}
      {t.tags.dropped.length > 0 && (
        <section>
          <h3>Tags dropped</h3>
          <ul>
            {t.tags.dropped.map((d, i) => (
              <li key={i} className="muted">
                {d}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function CallsTab({ details }: { details: Details }) {
  const scores = details.scores.at(-1)
  return (
    <>
      <section>
        <h3>
          Calls <small>(turn {details.turn.cost.ms} ms; click a call for its prompt and reply)</small>
        </h3>
        <CallList calls={details.calls} {...(details.session && { session: details.session })} />
      </section>
      <section>
        <h3>AI scores {scores && <small>(scorer v{scores.scorer.version}{scores.scorer.model ? `, ${scores.scorer.model}` : ''})</small>}</h3>
        {scores ? (
          <ul>
            {scores.items.map((s) => (
              <li key={s.id}>
                <b>{s.score}</b> {RUBRIC.find((x) => x.id === s.id)?.name ?? s.id}: <span className="muted">{s.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Not scored.</p>
        )}
      </section>
    </>
  )
}

/** The bookkeeper's records whole (milestone 4c): where they came from, what it read, and what the game turned down. */
function RecordsTab({ record, plan, nameOf }: { record: Pick<BookkeepingRecord, 'records' | 'late' | 'error'>; plan: Details['turn']['director']['plan']; nameOf: (id: string) => string }) {
  const r = record.records
  const felt = (id: string) => plan.speakers.find((s) => s.id === id)?.feels ?? plan.reactions.find((x) => x.id === id)?.feels
  return (
    <>
      <section>
        <h3>Source</h3>
        <p className={r.unaudited ? 'warn' : ''}>
          {r.source === 'bookkeeper' ? 'The bookkeeper read the turn.' : `The plan's records: ${record.late ? 'the turn stopped waiting for the bookkeeper' : 'its call failed or couldn\'t be read'}; secrets weren't audited.`}
          {record.error && <span className="muted"> ({record.error})</span>}
        </p>
      </section>
      <section>
        <h3>What changed</h3>
        <p>{r.changed || <span className="muted">Nothing, it says.</span>}</p>
        <p className="muted">{plan.scene ? `The stakes: ${plan.scene.stakes || 'none given'}` : `The director meant: ${plan.change || 'none given'}`}</p>
      </section>
      <section>
        <h3>Moods read <small>(logged against the director's feels, never applied)</small></h3>
        {r.moods.length > 0 ? (
          <ul>
            {r.moods.map((m) => (
              <li key={m.id}>
                {nameOf(m.id)}: read as {feeling(m.feeling)} <span className="muted">· the director: {feeling(felt(m.id))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None.</p>
        )}
      </section>
      <section>
        <h3>Turned down</h3>
        {r.refused.length > 0 ? (
          <ul>
            {r.refused.map((x, i) => (
              <li key={i} className="warn">
                {x}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing.</p>
        )}
      </section>
      <p className="muted">Secrets, guesses, leaks and new details are under Secrets and knowledge; checks under Checks.</p>
    </>
  )
}
