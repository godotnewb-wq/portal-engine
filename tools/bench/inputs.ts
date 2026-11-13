import { execFileSync } from 'node:child_process'
import type { Pack } from '@engine/pack'
import { isConfigured, profileFor, type LlmProfile, type LlmProfileId, type Settings } from '@llm'
import { promptVersion } from '@platform/logs'
import type { ScenarioRun } from './run'
import type { Scenario } from './scenario'
import { nameIn } from './names'

/**
 * What a bench run was given (milestone 3.6, task 7; code review P2), so two runs can be compared only where their
 * inputs match. Runs from before this have none, and are compared on scenario, repeat and seed alone.
 */
export interface RunInputs {
  /** The code: its git commit, and whether the checkout had uncommitted changes. Absent outside a git checkout. */
  source?: { commit: string; dirty: boolean }
  /** A fingerprint of the pack's content as loaded: everything the engine reads from it. */
  pack: string
  /** A fingerprint of each scenario as played, by id. */
  scenarios: Record<string, string>
  /** Each role's model settings, with no key and only the endpoint's host. */
  roles: Record<string, RoleSettings>
  /** The display names of the cast and walk-ons, as the pack had them, so a report reads the same after the pack changes. */
  names: Record<string, string>
}

export type RoleSettings = Omit<LlmProfile, 'apiKey' | 'baseUrl'> & { profile: LlmProfileId; host: string }

/** A short, stable fingerprint of anything JSON can hold. Line ends are evened out, so a pack read on Windows matches. */
export const fingerprint = (value: unknown): string => promptVersion([JSON.stringify(value).replaceAll('\\r\\n', '\\n')])

/** The commit checked out at `root`, and whether tracked or untracked files differ from it; undefined without git. */
export function sourceRevision(root: string): RunInputs['source'] {
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 }
  } catch {
    return undefined
  }
}

/** The settings each role really ran with (an unset role borrows the writer's profile), minus the key. */
export function roleSettings(settings: Settings, roles: readonly ('director' | 'writer' | 'summary' | 'scorer')[]): Record<string, RoleSettings> {
  const out: Record<string, RoleSettings> = {}
  for (const role of roles) {
    const profile = profileFor(settings, role, false)
    const { apiKey: _key, baseUrl, ...rest } = settings[profile]
    if (!isConfigured(settings[profile])) continue
    let host = ''
    try {
      host = new URL(baseUrl).host
    } catch {
      host = '(unreadable address)'
    }
    out[role] = { profile, host, ...rest }
  }
  return out
}

/** The inputs the run itself can see: the pack, the scenarios as played and the names in them. */
export function runInputs(content: Pack, scenarios: Scenario[], extra: Pick<RunInputs, 'source' | 'roles'>): RunInputs {
  const names: Record<string, string> = {}
  for (const s of scenarios) {
    for (const id of s.cast) names[id] = nameIn(content, s.location, id)
    for (const w of content.locations.find((l) => l.id === s.location)?.walkOns ?? []) names[w.id] = nameIn(content, s.location, w.id)
  }
  return {
    ...(extra.source && { source: extra.source }),
    pack: fingerprint(content),
    scenarios: Object.fromEntries(scenarios.map((s) => [s.id, fingerprint(s)])),
    roles: extra.roles,
    names
  }
}

/** Two runs' inputs set side by side: what differs, and which scenario plays can be compared. */
export interface Comparability {
  /** Inputs that differ between the runs, in words. */
  differences: string[]
  /** Pairs of plays with the same scenario, repeat and seed, and, when both runs recorded them, the same scenario content. */
  matched: [ScenarioRun, ScenarioRun][]
  /** Plays left out of the shared numbers, and why. */
  left: string[]
  /** A run recorded no inputs (it predates them), so matches rest on scenario, repeat and seed alone. */
  unknown: ('A' | 'B')[]
}

interface Side {
  pack: string
  packVersion: string
  prompts: string
  engine: string
  models: Record<string, string>
  options: { repeat: number; summaries: boolean }
  loreBudgets?: { sceneTokens: number; triggeredTokens: number; loreLines: number }
  inputs?: RunInputs
  scenarios: ScenarioRun[]
}

export function comparability(a: Side, b: Side): Comparability {
  const differences: string[] = []
  const differ = (what: string, x: unknown, y: unknown) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) differences.push(`${what}: A ${show(x)}, B ${show(y)}`)
  }
  differ('pack', `${a.pack} ${a.packVersion}`, `${b.pack} ${b.packVersion}`)
  differ('prompt version', a.prompts, b.prompts)
  differ('engine', a.engine, b.engine)
  differ('models', a.models, b.models)
  differ('repeats', a.options.repeat, b.options.repeat)
  differ('summaries', a.options.summaries, b.options.summaries)
  const budgets = (s: Side) => (s.loreBudgets ? { scene: s.loreBudgets.sceneTokens, triggered: s.loreBudgets.triggeredTokens, lines: s.loreBudgets.loreLines } : 'not recorded')
  differ('lore budgets', budgets(a), budgets(b))
  const unknown: Comparability['unknown'] = [...(a.inputs ? [] : (['A'] as const)), ...(b.inputs ? [] : (['B'] as const))]
  if (a.inputs && b.inputs) {
    const source = (s?: RunInputs['source']) => (s ? `${s.commit.slice(0, 7)}${s.dirty ? ' with uncommitted changes' : ''}` : 'unknown')
    differ('source', source(a.inputs.source), source(b.inputs.source))
    differ('pack content', a.inputs.pack, b.inputs.pack)
    for (const role of new Set([...Object.keys(a.inputs.roles), ...Object.keys(b.inputs.roles)])) differ(`${role} settings`, a.inputs.roles[role] ?? 'not set', b.inputs.roles[role] ?? 'not set')
  }

  const matched: Comparability['matched'] = []
  const left: string[] = []
  const play = (r: ScenarioRun) => `${r.id} #${r.repeat} (seed ${r.seed})`
  for (const ra of a.scenarios) {
    const rb = b.scenarios.find((r) => r.id === ra.id && r.repeat === ra.repeat && r.seed === ra.seed)
    if (!rb) {
      left.push(`${play(ra)}: only in A`)
      continue
    }
    const fa = a.inputs?.scenarios[ra.id]
    const fb = b.inputs?.scenarios[rb.id]
    if (fa && fb && fa !== fb) left.push(`${play(ra)}: the scenario changed between the runs`)
    else matched.push([ra, rb])
  }
  for (const rb of b.scenarios) if (!a.scenarios.some((r) => r.id === rb.id && r.repeat === rb.repeat && r.seed === rb.seed)) left.push(`${play(rb)}: only in B`)
  const changed = new Set(left.filter((l) => l.endsWith('changed between the runs')).map((l) => l.split(' #')[0]!))
  for (const id of changed) differences.push(`scenario ${id}: its content differs`)
  return { differences, matched, left, unknown }
}

const show = (x: unknown): string => (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' ? `\`${x}\`` : `\`${JSON.stringify(x)}\``)
