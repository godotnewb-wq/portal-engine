# engine/memory

Which memories a character brings to a scene: core first, then the most recent, up to the ruleset's budget for their tier (`memory.recall`: recurring, major). A Major Character's budget is the same in the party or out of it.

**Public API** (`@engine/memory`): `recall(ruleset, state, character)`, `selectMemories`.

**Depends on:** characters, rules, state. **Design:** `memory.md`. Adapted from Breedhaven.
