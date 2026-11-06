# llm

Talks to any OpenAI-compatible chat completions endpoint. Knows nothing about games: no engine, pack or world.

**Public API** (`@llm`)
- `chatCompletion(profile, input)`: one reply, with optional tools and JSON mode (retried without `response_format` when an endpoint rejects it).
- `streamCompletion(profile, input, onDelta)`: a streamed reply (server-sent events).
- `complete(settings, role, nsfw, input)` / `stream(...)`: the router. Sends a role (`director`, `writer`, `summary`) to its profile, falls back to the NSFW profile when the first declines, and borrows the writer's profile for a role left unset.
- `listModels`, refusal detection (`RefusalError`, `isRefusalResponse`, `looksLikeRefusal`), the per-address request queue (`inTurn`).
- `SettingsSchema` and friends: the four LLM profiles and their view without keys.

**Depends on:** nothing in this repository.
**Design:** `claude/narrator-scene-engine.md` §3 (model roles). Adapted from Breedhaven (see `NOTICE.md`).
