# platform/logs

Play and bench logs (milestone 2, A2): a folder per session, a file per concern, each file with one writer, joined by id.

```
<root>/<session>/            e.g. userData/logs/<pack-id>/2026-11-05_2003_a1b2/, or bench-output/<run>/<scenario>-1/
  session.json   who, what, when; the only file rewritten (at start and end)
  turns.jsonl    the readable part of each turn trace; calls by id
  calls.jsonl    every LLM call: role, model, raw reply, timing, tokens, prompt section ids
  prompts.jsonl  each distinct prompt section once, by hash; nothing cut or summarized
  scenes.jsonl   scene starts and ends
  flags.jsonl    the player's flags (newer replaces older on the same beat)
  scores.jsonl   AI scores, each with its scorer version
  errors.jsonl   failed calls, unreadable replies, caught errors
```

**Public API** (`@platform/logs`): `LogSession` (`open`, `resume`, `turn`, `sceneStart`, `sceneEnd`, `error`, `flag`, `score`, `close`), `readSession`, `findSessions`, `promptOf`, `callTrace`, `promptVersion`, the record types, `sections` / `joinSections`.

Rules: lines are appended as they happen (crash-safe); nothing is ever deleted; API keys, headers and endpoint addresses never reach a file (`RoleModel` holds a profile, model and temperature only). Logs never go inside a pack folder.

**Depends on:** engine core, scene, relationships, review; `node:fs`, `node:crypto`.
