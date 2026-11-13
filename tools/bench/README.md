# Scene test bench

A pack's fixed scenarios played through the real turn pipeline (director → rolls → writer → code checks → rewrite → end-of-scene summaries), so a change to a prompt, the style guide, a character file or a model can be judged against the same scenes. Tuning character quality without this is guesswork.

## Running it

```
npm run bench                                   every scenario of the default pack (neonpunk-nights)
npm run bench -- --pack test-fixture            another pack: an id in packs/, or a path to a pack folder
npm run bench -- deception-caught three-way-argument   only these
npm run bench -- --label tighter-style-guide    name the run
npm run bench -- --no-summaries                 skip end-of-scene summaries (cheaper)
npm run bench -- --repeat 10                    play each scenario 10 times, seeds counting up from its own
npm run bench -- --score                        run the AI scorer on the run when it finishes (see tools/logs)
npm run bench -- --scenario turn.json           a scenario file from elsewhere, e.g. made by npm run logs -- to-scenario
npm run bench -- --mock                         no LLM: checks the harness, not the prose
npm run bench -- --compare bench-output/<run A> bench-output/<run B>
```

Each run writes `bench-output/<time>-<label>/`:
- `report.md`: numbers per scenario (calls, rewrites, salvaged turns, fallback plans, corrections, latency), the run's metrics (milestone 2, B2: rewrite and salvage rates, speaking share, check variety, repetition, timings, flags and AI scores), then every turn's plan, rolls, beats and rewrite fixes, and each character's memory and meter changes.
- `run.json`: the run's label, pack and version, prompt version, models and options, where each scenario's session is, and its `inputs` (milestone 3.6): the git commit and whether the checkout had uncommitted changes, a fingerprint of the loaded pack and of each scenario as played, each role's model settings without the key and with only the endpoint's host, and the cast's and walk-ons' display names.
- one session folder per scenario run (`<scenario>-<repeat>/`) in the play-log layout (`@platform/logs`): `session.json`, `turns.jsonl` (the turn traces), `calls.jsonl` and `prompts.jsonl` (every prompt in full and every raw reply), `scenes.jsonl`, `errors.jsonl`. `npm run logs` reads these the same way it reads play sessions.

Runs record the pack's id and version, the prompt version and their inputs. `--compare` writes `bench-output/compare-<time>.md`: what differs between the two runs' inputs, both runs' numbers, each metric's change over the scenario plays whose inputs match (same scenario, repeat and seed, and the same scenario content when both runs recorded it; ✓ better, ✗ worse), the plays left out and why, then each shared scenario turn by turn with the beats in two columns. Each run is named as it recorded, not from the pack loaded now. A run from before milestone 3.6 has no inputs: the comparison says so and matches it on scenario, repeat and seed alone. The prompt version hashes only fixed prompt text, so a change to how prompts are assembled per turn doesn't move it; compare the source commits too.

Bench runs are logs like any other: `npm run logs -- transcript bench-output/<run>/<scenario>-1`, `npm run logs -- stats bench-output/<run>`, and `npm run logs -- flag …` to flag them.

## Models

The app's settings can't be reused (their keys are encrypted for the app only). Either:
- create `bench.config.json` in the repository root (git-ignored), the same shape as the app's settings:
  ```json
  {
    "director": { "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-…", "model": "…fast model…", "temperature": 0.3 },
    "writer":   { "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-…", "model": "…strong model…", "temperature": 0.9 },
    "summary":  { "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-…", "model": "…", "temperature": 0.2 },
    "scorer":   { "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-…", "model": "…", "temperature": 0.2 },
    "nsfw":     { "baseUrl": "", "model": "" }
  }
  ```
  (roles left without a model borrow the writer's), or
- set `BENCH_BASE_URL`, `BENCH_API_KEY`, `BENCH_MODEL` (writer), and optionally `BENCH_DIRECTOR_MODEL`, `BENCH_SUMMARY_MODEL`, `BENCH_SCORER_MODEL`, `BENCH_NSFW_MODEL`.

`--config <path>` points at another file.

**Lore budgets:** `bench.config.json` may also carry `"loreBudgets": { "sceneTokens": 1500, "triggeredTokens": 600, "loreLines": 2 }`, the same field the app's Settings keep. A field left out uses the pack's ruleset; a value out of bounds is clamped with a warning. They apply with `--mock` too. The report's first line and `--compare`'s headers say which budgets each run used, marking those the config set.

## Scenarios

Each pack keeps its own in `bench/*.json`:

| Field | |
|---|---|
| `id`, `title` | |
| `watchFor` | What the scenario tests and what a good run looks like; printed at the top of its section. |
| `location`, `cast` | Where, and who is present (ids from the pack). |
| `seed` | Dice seed. |
| `forceNatural` | Every check's die shows this number (e.g. 18 to make a check succeed, 3 to make it fail). |
| `meters`, `moods`, `comfort` | Starting feelings toward the player (in the ruleset's meters), moods and comfort, overriding the character files. |
| `history` | Turns already played in the scene, verbatim (scenarios made from logs carry these). |
| `turns` | The player's lines, in order. |
| `expectedCheck` | Optional `turn` (1-based), `who`, and `skill`. Reports flag the scenario if that roll does not happen. |
| `summaries` | Run end-of-scene summaries (default true). |

Neonpunk Nights ships `repair-with-brask` (a repair with Brask, a rank-3 mechanic, in the party: the check line should name him), `siblings-on-the-car` (a sister and brother who see each other differently), `deception-caught` and `deception-uncaught` (same opening, rolls forced high and low; compare them), `tense-negotiation`, `three-way-argument`, `warmth-gone-wrong`, and three tram scenes (`tram-stay-or-go`, `tram-small-talk`, `tram-attempt`). Neonpunk Nights also ships 13 lore scenarios (the eleven `lore-*` scenarios plus `secret-dormant` and `secret-touched`). Read each scenario’s `watchFor` notes when reviewing a real-model run. The report and comparison show each turn’s estimated lore tokens, budget reductions, validated lore lines, and lore corrections. The test fixture ships `who-was-here`.
