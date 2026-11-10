import { useEffect, useState } from 'react'
import { LLM_PROFILE_IDS, REASONING_LEVELS, type LlmProfileId, type LlmProfileView, type SettingsUpdate, type SettingsView } from '@llm'
import { LORE_BUDGET_BOUNDS, LORE_BUDGET_FIELDS, RulesetSchema, type LoreBudgetField, type LoreBudgetOverrides } from '@engine/rules'
import type { Pack } from '@engine/pack'
import { Button } from './Button'

const LABEL: Record<LlmProfileId, { name: string; hint: string }> = {
  director: { name: 'Director', hint: 'Plans each turn as JSON. A fast, cheap model. Falls back to the Writer if unset.' },
  writer: { name: 'Scene writer', hint: 'Writes the beats, streamed. Your strongest creative model.' },
  summary: { name: 'Summaries', hint: 'Writes memories after a scene. Falls back to the Writer if unset.' },
  scorer: { name: 'Scorer', hint: 'Rates logged turns after play, never during a turn. Falls back to Summaries, then the Writer, if unset.' },
  nsfw: { name: 'NSFW fallback', hint: 'Takes over any role whose model declines.' }
}

type Draft = LlmProfileView & { apiKey?: string }

function ProfileForm({ id, value, onChange }: { id: LlmProfileId; value: Draft; onChange: (next: Draft) => void }) {
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const set = <K extends keyof Draft>(key: K, v: Draft[K]) => onChange({ ...value, [key]: v })

  const fetchModels = async () => {
    setStatus('Loading models…')
    const result = await window.api.listModels({ profileId: id, baseUrl: value.baseUrl, ...(value.apiKey !== undefined && { apiKey: value.apiKey }) })
    setModels(result.models)
    setStatus(result.error ?? `${result.models.length} models`)
  }
  const test = async () => {
    setStatus('Testing… (save first to test new values)')
    const result = await window.api.testConnection(id)
    setStatus(result.ok ? `OK: ${result.detail}` : `Failed: ${result.detail}`)
  }

  return (
    <fieldset className="profile">
      <legend title={LABEL[id].hint}>{LABEL[id].name}</legend>
      <label>
        Endpoint
        <input value={value.baseUrl} placeholder="https://api.openai.com/v1" onChange={(e) => set('baseUrl', e.target.value)} />
      </label>
      <label>
        API key
        <input
          type="password"
          value={value.apiKey ?? ''}
          placeholder={value.hasApiKey ? 'saved' : 'none'}
          onChange={(e) => set('apiKey', e.target.value)}
        />
      </label>
      <label>
        Model
        <input list={`models-${id}`} value={value.model} onChange={(e) => set('model', e.target.value)} />
        <datalist id={`models-${id}`}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <div className="row">
        <label>
          Temperature
          <input type="number" step={0.05} min={0} max={2} value={value.temperature} onChange={(e) => set('temperature', Number(e.target.value))} />
        </label>
        <label>
          Max tokens
          <input type="number" min={1} value={value.maxTokens} onChange={(e) => set('maxTokens', Math.max(1, Math.round(Number(e.target.value))))} />
        </label>
        <label>
          Reasoning
          <select value={value.reasoning} onChange={(e) => set('reasoning', e.target.value as Draft['reasoning'])}>
            {REASONING_LEVELS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <Button size="sm" onClick={fetchModels} disabled={!value.baseUrl}>
          List models
        </Button>
        <Button size="sm" onClick={test}>
          Test
        </Button>
        <span className="status">{status}</span>
      </div>
    </fieldset>
  )
}

/**
 * Extra folders to look for packs in, for pack authors working outside the app-data folder (architecture §9). Each
 * can be a folder of packs or one pack's own folder.
 */
function PackFolders() {
  const [folders, setFolders] = useState<string[]>([])
  useEffect(() => {
    window.api.getPackFolders().then(setFolders)
  }, [])
  const save = async (next: string[]) => setFolders(await window.api.setPackFolders(next))
  const add = async () => {
    const folder = await window.api.chooseFolder()
    if (folder) await save([...folders, folder])
  }
  return (
    <fieldset className="profile pack-folders">
      <legend title="Packs are also found in the app's own packs folder; add more places here.">Pack folders</legend>
      {folders.length === 0 && <span className="status">None. Packs are found in the app's own packs folder.</span>}
      {folders.map((f) => (
        <div key={f} className="row">
          <code className="folder">{f}</code>
          <Button size="sm" variant="ghost" onClick={() => save(folders.filter((x) => x !== f))}>
            Remove
          </Button>
        </div>
      ))}
      <div className="row">
        <Button size="sm" onClick={add}>
          Add folder…
        </Button>
        <span className="status">Changes show the next time packs are looked for.</span>
      </div>
    </fieldset>
  )
}

const BUDGET_LABEL: Record<LoreBudgetField, { name: string; hint: string }> = {
  sceneTokens: { name: 'Scene lore (tokens)', hint: 'Lore about the place and the people present, rebuilt each turn. 0 turns it off.' },
  triggeredTokens: { name: 'Lore that comes up (tokens)', hint: 'Lore brought in by what was just said. 0 turns it off.' },
  loreLines: { name: 'Lore lines a turn', hint: 'Facts about the world the director may hand the writer each turn. 0 gives none.' }
}

/** The engine's own defaults, shown before a game is chosen. */
const ENGINE_CODEX = RulesetSchema.shape.codex.parse(undefined)

/** A field as typed: blank means the pack's value. */
type BudgetDraft = Record<LoreBudgetField, string>

const draftOf = (budgets: LoreBudgetOverrides): BudgetDraft =>
  Object.fromEntries(LORE_BUDGET_FIELDS.map((f) => [f, budgets[f] === undefined ? '' : String(budgets[f])])) as BudgetDraft

/** What's wrong with a typed value, if anything: whole numbers within the bounds only. */
function budgetProblem(field: LoreBudgetField, typed: string): string | null {
  if (typed.trim() === '') return null
  const n = Number(typed)
  const { min, max } = LORE_BUDGET_BOUNDS[field]
  return Number.isInteger(n) && n >= min && n <= max ? null : `${min}–${max}`
}

/**
 * Lore budgets (milestone 3, task 10): the player's values over every pack's own, applied from the next turn. A blank
 * field uses the pack's, shown beside it; with no pack chosen, the engine's defaults are shown.
 */
function LoreBudgets({ pack, draft, onChange, onReset }: { pack: Pack | null; draft: BudgetDraft; onChange: (next: BudgetDraft) => void; onReset: () => void }) {
  const defaults = pack?.ruleset.codex ?? ENGINE_CODEX
  return (
    <fieldset className="profile lore-budgets">
      <legend title="How much world lore each turn's prompts may carry. Blank uses the game's own values.">Lore budgets</legend>
      <div className="row">
        {LORE_BUDGET_FIELDS.map((f) => {
          const problem = budgetProblem(f, draft[f])
          return (
            <label key={f} title={BUDGET_LABEL[f].hint}>
              {BUDGET_LABEL[f].name}
              <input
                type="number"
                min={LORE_BUDGET_BOUNDS[f].min}
                max={LORE_BUDGET_BOUNDS[f].max}
                value={draft[f]}
                placeholder={String(defaults[f])}
                className={problem ? 'invalid' : undefined}
                onChange={(e) => onChange({ ...draft, [f]: e.target.value })}
              />
              <span className="status">{problem ? `Use ${problem}` : `${pack ? 'Game' : 'Default'}: ${defaults[f]}`}</span>
            </label>
          )
        })}
      </div>
      <div className="row">
        <Button size="sm" variant="ghost" onClick={onReset} disabled={LORE_BUDGET_FIELDS.every((f) => draft[f] === '')}>
          Reset to game defaults
        </Button>
        <span className="status">Apply from the next turn, in every game.</span>
      </div>
    </fieldset>
  )
}

/** Play logs (milestone 2): on or off, and where they are. Nothing deletes them but the player. */
function Logging() {
  const [on, setOn] = useState<boolean | null>(null)
  const [where, setWhere] = useState('')
  useEffect(() => {
    window.api.getLogging().then(setOn)
  }, [])
  if (on === null) return null
  return (
    <fieldset className="profile logging">
      <legend title="Every turn's prompts, replies, rolls and checks, and your flags, written to a folder per session.">Logs</legend>
      <label className="check">
        <input type="checkbox" checked={on} onChange={async (e) => setOn(await window.api.setLogging(e.target.checked))} />
        Log play sessions (needed for flagging beats)
      </label>
      <div className="row">
        <Button size="sm" onClick={async () => setWhere(await window.api.openLogsFolder())}>
          Open logs folder
        </Button>
        <span className="status">{where || 'Logs are never deleted automatically; remove old ones from the folder.'}</span>
      </div>
    </fieldset>
  )
}

export function Settings({ onClose, pack = null }: { onClose: () => void; pack?: Pack | null }) {
  const [draft, setDraft] = useState<Record<LlmProfileId, Draft> | null>(null)
  const [budgets, setBudgets] = useState<BudgetDraft | null>(null)
  const [saved, setSaved] = useState('')

  useEffect(() => {
    window.api.getSettings().then(setDraft)
    window.api.getLoreBudgets().then((b) => setBudgets(draftOf(b)))
  }, [])
  if (!draft || !budgets) return <div className="screen">Loading…</div>
  const budgetsValid = LORE_BUDGET_FIELDS.every((f) => budgetProblem(f, budgets[f]) === null)
  const typedBudgets = (b: BudgetDraft): LoreBudgetOverrides =>
    Object.fromEntries(LORE_BUDGET_FIELDS.flatMap((f) => (b[f].trim() === '' ? [] : [[f, Number(b[f])]])))

  const save = async () => {
    const update = Object.fromEntries(
      LLM_PROFILE_IDS.map((id) => {
        const { hasApiKey: _has, apiKey, ...rest } = draft[id]
        // An untouched key field keeps the saved key.
        return [id, apiKey === undefined ? rest : { ...rest, apiKey }]
      })
    ) as SettingsUpdate
    const view: SettingsView = await window.api.saveSettings(update)
    setDraft(view)
    setBudgets(draftOf(await window.api.setLoreBudgets(typedBudgets(budgets))))
    setSaved('Saved')
  }

  return (
    <div className="screen settings">
      <h1>Settings</h1>
      <div className="profiles">
        {LLM_PROFILE_IDS.map((id) => (
          <ProfileForm key={id} id={id} value={draft[id]} onChange={(next) => (setSaved(''), setDraft({ ...draft, [id]: next }))} />
        ))}
      </div>
      <PackFolders />
      <LoreBudgets
        pack={pack}
        draft={budgets}
        onChange={(next) => (setSaved(''), setBudgets(next))}
        onReset={async () => (setBudgets(draftOf(await window.api.setLoreBudgets({}))), setSaved('Lore budgets reset'))}
      />
      <Logging />
      <div className="row">
        <Button variant="primary" onClick={save} disabled={!budgetsValid}>
          Save
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Back
        </Button>
        <span className="status">{saved}</span>
      </div>
    </div>
  )
}
