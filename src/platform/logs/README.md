# platform/logs

Play and bench logs (milestone 2, A2): a folder per session, a file per concern, each file with one writer, joined by id.

```
<root>/<session>/            e.g. userData/logs/<pack-id>/2026-11-05_2003_a1b2/, or bench-output/<run>/<scenario>-1/
  session.json   who, what, when; the only file rewritten (at start and end)
  turns.jsonl    the readable part of each turn trace; calls by id
  calls.jsonl    every LLM call: role, model, raw reply, timing, tokens, prompt section ids
  prompts.jsonl  each distinct prompt section once, by hash; nothing cut or summarized
  scenes.jsonl   scene starts, openings (Milestone 5 task 8), cut-ins (task 8c) and ends, and memory consolidation runs between scenes
  flags.jsonl    the player's flags (newer replaces older on the same beat)
  scores.jsonl   AI scores, each with its scorer version
  errors.jsonl   failed calls, unreadable replies, caught errors
  bookkeeping.jsonl  each turn's bookkeeper (milestone 4c): the records the game kept, its call by id, why it fell back, `late` when the turn stopped waiting
```

**Public API** (`@platform/logs`): `LogSession` (`open`, `resume`, `turn`, `sceneStart`, `sceneEnd`, `error`, `flag`, `score`, `close`), `readSession`, `readFlags`, `findSessions`, `PlayLogs` (the app's session lifecycle, flags and turn details: `details()` joins the turn's bookkeeping record as `records` once it is logged, and its call to the turn's calls, `call()` gives one call's prompt and reply as `CallText`), `summarized` (a scene-end trace for `SceneEndDetails`), `TurnDetails`, `CallText`, `SceneEndDetails`, `promptOf`, `callTrace`, `promptVersion`, the record types, `sections` / `joinSections`.

**Cutting in** (Milestone 5 task 8c). When the player cuts in on a turn, `turns.jsonl` keeps the turn as written, every beat, and a `cut` record in `scenes.jsonl` says how many beats were shown. `readSession` applies it (`cutTrace`): the turn's `beats` and `usage` are the beats shown, the rest are kept as `cut`, and `interrupted` says where. Everything that reads a session (transcripts, metrics, the scorer, replays, Turn details) so reads what happened; `npm run logs -- show` and the bench report list the cut beats struck through.

Rules: lines are appended as they happen (crash-safe); nothing is ever deleted; API keys, headers and endpoint addresses never reach a file (`RoleModel` holds a profile, model and temperature only). Logs never go inside a pack folder.

**Depends on:** engine core, scene, relationships, review; `node:fs`, `node:crypto`.
