import { existsSync, readFileSync } from 'node:fs'
import { SettingsSchema, isConfigured, profileFor, type Settings } from '@llm'

/**
 * Model settings for the bench. The app's own settings can't be used: their keys are encrypted with Electron's
 * safeStorage, which only the app can read. So the bench reads a `bench.config.json` (the same shape as the app's
 * settings, keys in plain text; git-ignored), or environment variables for a single endpoint:
 *   BENCH_BASE_URL, BENCH_API_KEY, BENCH_MODEL (the writer), and optionally BENCH_DIRECTOR_MODEL, BENCH_SUMMARY_MODEL,
 *   BENCH_SCORER_MODEL, BENCH_NSFW_MODEL on the same endpoint.
 * The file wins where both are given.
 */
export function benchSettings(configPath: string | undefined, env: Record<string, string | undefined>): Settings {
  if (configPath && existsSync(configPath)) return SettingsSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')))
  const endpoint = { baseUrl: env['BENCH_BASE_URL'] ?? '', apiKey: env['BENCH_API_KEY'] ?? '' }
  const model = (name: string | undefined) => (name ? { ...endpoint, model: name } : {})
  return SettingsSchema.parse({
    writer: model(env['BENCH_MODEL']),
    director: model(env['BENCH_DIRECTOR_MODEL']),
    summary: model(env['BENCH_SUMMARY_MODEL']),
    scorer: model(env['BENCH_SCORER_MODEL']),
    nsfw: model(env['BENCH_NSFW_MODEL'])
  })
}

/** Which model each role will really use, for the report: unset roles borrow the writer's. */
export function modelsOf(settings: Settings): Record<string, string> {
  const roles = ['director', 'writer', 'summary'] as const
  const models: Record<string, string> = Object.fromEntries(roles.map((role) => [role, settings[profileFor(settings, role, false)].model || '(none)']))
  if (isConfigured(settings.nsfw)) models['nsfw fallback'] = settings.nsfw.model
  return models
}
