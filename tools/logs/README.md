# Log tools

`npm run logs` reads play sessions (the app's `userData/logs/<pack-id>/`, opened from Settings → **Open logs folder**) and bench runs (`bench-output/<run>/`) the same way: both are session folders in the layout of `@platform/logs`. Every command takes a session folder, or a folder of them, and joins each session's files by id.

```
npm run logs -- transcript <session> [--out t.md]     readable transcript: input, plan, checks, findings, beats,
                                                      with flags, notes and AI scores inline
npm run logs -- flags <paths…> [--rating bad] [--reason voice] [--speaker vex] [--ai]
                                                      every flagged beat and turn with its context: the input, the
                                                      brief the beat carried out, the beats around it; --ai adds
                                                      the beats the scorer marked, labeled as such
npm run logs -- stats <paths…>                        the metrics (milestone 2, B2), per session and in total
npm run logs -- blind <session> [--count 10] [--seed 1] [--key key.md]
                                                      the blind voice test on stdout; the answer key in a file
npm run logs -- to-scenario <session> --turn N --out turn.json
                                                      a logged turn as a bench scenario; replay it with
                                                      npm run bench -- --scenario turn.json
npm run logs -- show <session> --turn N               one turn in full: trace, every prompt, every raw reply
npm run logs -- score <paths…> [--config bench.config.json]
                                                      AI-score turns not yet scored by the current scorer version
npm run logs -- flag <session> --turn N [--beat n] --rating bad [--reason voice,generic] [--note "…"] [--clear]
                                                      flag a bench run (play is flagged in the app)
```

Output goes to stdout unless `--out` names a file; nothing is written into the logs except by `score` and `flag`. `--pack <id or folder>` when a session's pack isn't in `packs/`.

**Flags made later.** A turn read back after loading a save is flagged in the session where it was read; the tools look for flags on a session's turns in every session beside it.

**The scorer** (`score`, and `npm run bench -- --score`) uses the `scorer` profile of `bench.config.json` (or `BENCH_SCORER_MODEL`), borrowing `summary`, then `writer`, when unset. It reads what a person reviewing the turn would (the input, the character cards, the plan and rolls, the beats) and never human flags. Its scores go into the session's `scores.jsonl`, its calls into `calls.jsonl` with the role `scorer`; rescoring with a new `SCORER_VERSION` adds records and keeps the old. It never runs during a turn. `stats` reports how often it agrees with human flags, which says how far to trust it.

**to-scenario** carries the scene as it stood: cast, moods, comfort, meters toward the player, the dice, and the scene's earlier turns. Memories from earlier scenes and relations between characters aren't in the logs, so the replay uses the pack's.

**Metrics** (`metrics.ts`) are shared with the bench's report and `--compare`. Since redesign step 2 they include relevance: speakers per turn, live secret rate, slang and aim line rates (with per-speaker shares), and gestures repeated within a scene (from each turn's `usage`; older logs show a dash).
