import { useEffect, useState } from 'react'
import { LLM_PROFILE_IDS, REASONING_LEVELS, type LlmProfileId, type LlmProfileView, type SettingsUpdate, type SettingsView } from '../../../shared/settings'
import { Button } from './Button'

const LABEL: Record<LlmProfileId, { name: string; hint: string }> = {
  director: { name: 'Director', hint: 'Plans each turn as JSON. A fast, cheap model. Falls back to the Writer if unset.' },
  writer: { name: 'Scene writer', hint: 'Writes the beats, streamed. Your strongest creative model.' },
  summary: { name: 'Summaries', hint: 'Writes memories after a scene. Falls back to the Writer if unset.' },
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

export function Settings({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<Record<LlmProfileId, Draft> | null>(null)
  const [saved, setSaved] = useState('')

  useEffect(() => {
    window.api.getSettings().then(setDraft)
  }, [])
  if (!draft) return <div className="screen">Loading…</div>

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
      <div className="row">
        <Button variant="primary" onClick={save}>
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
