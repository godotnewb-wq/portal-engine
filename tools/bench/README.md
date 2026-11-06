# Scene test bench

A pack's fixed scenarios played through the real turn pipeline (director → rolls → writer → code checks → rewrite → end-of-scene summaries), so a change to a prompt, the style guide, a character file or a model can be judged against the same scenes. Tuning character quality without this is guesswork.

## Running it

```
npm run bench                                   every scenario of the default pack (neonpunk-nights)
npm run bench -- --pack test-fixture            another pack: an id in packs/, or a path to a pack folder
npm run bench -- deception-caught three-way-argument   only these
npm run bench -- --label tighter-style-guide    name the run
npm run bench -- --no-summaries                 skip end-of-scene summaries (cheaper)
npm run bench -- --mock                         no LLM: checks the harness, not the prose
npm run bench -- --compare bench-output/<run A> bench-output/<run B>
```

Each run writes `bench-output/<time>-<label>/`:
- `report.md`: numbers per scenario (calls, rewrites, salvaged turns, fallback plans, corrections, latency), then every turn's plan, rolls, beats and rewrite fixes, and each character's memory and meter changes.
- `run.json`: everything, including every prompt and raw reply, for digging into why a turn went the way it did.

Runs record the pack's id and version. `--compare` writes `bench-output/compare-<time>.md`: both runs' numbers, then each shared scenario turn by turn with the beats in two columns.

## Models

The app's settings can't be reused (their keys are encrypted for the app only). Either:
- create `bench.config.json` in the repository root (git-ignored), the same shape as the app's settings:
  ```json
  {
    "director": { "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-…", "model": "…fast model…", "temperature": 0.3 },
    "writer":   { "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-…", "model": "…strong model…", "temperature": 0.9 },
    "summary":  { "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-…", "model": "…", "temperature": 0.2 },
    "nsfw":     { "baseUrl": "", "model": "" }
  }
  ```
  (roles left without a model borrow the writer's), or
- set `BENCH_BASE_URL`, `BENCH_API_KEY`, `BENCH_MODEL` (writer), and optionally `BENCH_DIRECTOR_MODEL`, `BENCH_SUMMARY_MODEL`, `BENCH_NSFW_MODEL`.

`--config <path>` points at another file.

## Scenarios

Each pack keeps its own in `bench/*.json`:

| Field | |
|---|---|
| `id`, `title` | |
| `watchFor` | What the scenario tests and what a good run looks like; printed at the top of its section. |
| `location`, `cast` | Where, and who is present (ids from the pack). |
| `seed` | Dice seed. |
| `forceNatural` | Every check's die shows this number (e.g. 18 to make a check succeed, 3 to make it fail). |
| `meters`, `moods` | Starting feelings toward the player (in the ruleset's meters) and moods, overriding the character files. |
| `turns` | The player's lines, in order. |
| `summaries` | Run end-of-scene summaries (default true). |

Neonpunk Nights ships `deception-caught` and `deception-uncaught` (same opening, rolls forced high and low; compare them), `tense-negotiation`, `three-way-argument` and `flirtation-gone-wrong`. The test fixture ships `who-was-here`.
