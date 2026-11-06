# engine/core

Small things every system uses: content ids, seeded dice, name matching, and the `Prompt` shape.

**Public API** (`@engine/core`): `IdSchema`; `dice(state)` (resumable seeded dice), `seedFrom`, `draws`, `seedOf`; `plainName`, `namesCharacter`, `resolveName`, `firstName`; `Prompt`; `LlmReply` (a reply's text, optionally with `CallMeta`: profile, model, tokens, a JSON-mode retry, a refusal switch), `replyText`, `replyMeta`; `CallTrace` and `traced` (runs one LLM call and records it, failed or not), `TracedError` (an error carrying the calls made before it).

**Depends on:** nothing.
