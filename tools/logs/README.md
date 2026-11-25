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
npm run logs -- rewrite <paths…> [--turn N] [--samples 3] [--as-logged] [--label x] [--out r.md]
                                                      a logged scene turn's writer again, on the current prompts
                                                      and the plan as played; without --turn, every flagged scene
                                                      turn under the paths (written to bench-output/rewrite-….md)
npm run logs -- score <paths…> [--config bench.config.json]
                                                      AI-score turns not yet scored by the current scorer version
npm run logs -- flag <session> --turn N [--beat n] --rating bad [--reason voice,generic] [--note "…"] [--clear]
                                                      flag a bench run (play is flagged in the app)
```

Output goes to stdout unless `--out` names a file; nothing is written into the logs except by `score` and `flag`. `--pack <id or folder>` when a session's pack isn't in `packs/`.

**Flags made later.** A turn read back after loading a save is flagged in the session where it was read; the tools look for flags on a session's turns in every session beside it.

**The scorer** (`score`, and `npm run bench -- --score`) uses the `scorer` profile of `bench.config.json` (or `BENCH_SCORER_MODEL`), borrowing `summary`, then `writer`, when unset. It reads what a person reviewing the turn would (the input, the character cards, the plan and rolls, the beats) and never human flags. Its scores go into the session's `scores.jsonl`, its calls into `calls.jsonl` with the role `scorer`; rescoring with a new `SCORER_VERSION` adds records and keeps the old. It never runs during a turn. `stats` reports how often it agrees with human flags, which says how far to trust it.

**Metrics on both pipelines** (Milestone 5 task 6). A `scene` turn has no exchange or planned points, so: *copied from plan* compares a line with its speaker's moment and pressure, the director's own wording, not the facts offered, which a line is meant to state (decided in task 8); *same speaker twice* and the new conversation metrics read the writer's paragraphs (`paragraphs`: beats cut from one line of the reply); *longest silence* counts who spoke, on both pipelines. New: *replies between characters / turn* (a character's paragraph right after another character's), *reply opener rate* (of those, the share whose first sentence names the speaker it answers or picks up a word of theirs), *longest run by one speaker / turn*, *fact repeats / scene* (a fact the plan offered said again in a later turn, by the bookkeeper stand-in's word-run test) and *gesture repeats / scene*. The live secret rate already reads a scene turn through `sceneView` (its focus as speakers, a secret pressure as `hiding`).

**rewrite** (Milestone 5 task 8, decided 2026-11-24, user) is the loop for tuning the writing: a writing change is read on turns from play, a few writer calls each, and a scored bench run waits for a checkpoint. Each replayed turn rebuilds the writer's prompt from the current code and pack over the director's plan as logged (the scene as `to-scenario` carries it), calls the writer `--samples` times through the `writer` profile of `bench.config.json`, and reads each draft with the turn's own code checks (`writerChecks`). The report shows the turn as played with its flags, then each sample: its beats, what would have been sent back for a rewrite (no rewrite is made), and *echoes*, beats that share three or more content words with one line of the prompt (a card habit, a sample line or a note carried into the prose; a reading aid, since a fact used as asked shares words too). Its first line for a turn says which prompt sections the current code and pack changed: none means the replay is the logged prompt itself, and on an unchanged checkout anything else is a gap in what the logs carry. `--as-logged` sends the logged prompt as it was instead, the "before" of a change on any checkout, and says what the current code and pack would change. Only `scene` turns can be replayed; others are listed and left out. A writing set is a folder of play sessions whose turns are flagged.

**to-scenario** carries the scene as it stood: cast, moods (from turns logged since milestone 4b; older turns' mood words can't be carried, so the card's default mood stands in), comfort, meters toward the player, the dice, and the scene's earlier turns. Memories from earlier scenes and relations between characters aren't in the logs, so the replay uses the pack's.

**Metrics** (`metrics.ts`) are shared with the bench's report and `--compare`. Since redesign step 2 they include relevance: speakers per turn, live secret rate, slang and aim line rates (with per-speaker shares), and gestures repeated within a scene (from each turn's `usage`; older logs show a dash).
