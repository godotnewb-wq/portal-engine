# llm

Talks to any OpenAI-compatible chat completions endpoint. Knows nothing about games: no engine, pack or world.

**Public API** (`@llm`)
- `chatCompletion(profile, input)`: one reply, with optional tools and JSON mode (retried without `response_format` when an endpoint rejects it).
- `streamCompletion(profile, input, onDelta)`: a streamed reply (server-sent events).
- `complete(settings, role, input)` / `stream(...)`: the router. Sends a role (`director`, `writer`, `bookkeeper`, `summary`, `scorer`) to its profile, falls back to the NSFW profile when the first declines, and borrows for a role left unset: the bookkeeper and the scorer the summary's profile first, every role the writer's. The bookkeeper's own profile starts with a 30-second timeout (milestone 4c); a borrowed profile keeps its own.
- `listModels`, refusal detection (`RefusalError`, `isRefusalResponse`, `looksLikeRefusal`), the per-address request queue (`inTurn`).
- `SettingsSchema` and friends: the four LLM profiles and their view without keys.

**Depends on:** nothing in this repository.
**Design:** `director writer.md` §3 (model roles). Adapted from Breedhaven (see `NOTICE.md`).
