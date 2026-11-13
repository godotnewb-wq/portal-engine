# engine/relationships

The end of a scene: one summary call per witness (present or departed), all at once and outside the turn budget. Each witness judges, as themselves, how each relationship meter changed toward the player and toward the other witnesses, in the ruleset's scale words; the ruleset maps the words to numbers. Memories are stored, meters move (kept within the ruleset's range), secrets that truly came out become facts the player knows, and relations are created or relabelled by the ruleset's bands. A failed call costs only that witness.

**Public API** (`@engine/relationships`): `endScene(pack, state, summarize, now?)` (returns the new state, the reports and a `SceneEndTrace` for the logs), `buildSummaryPrompt`, `parseSummary`, `applySummaries`, `plainSummary`, `addMeters`, `bandOf`, `witnesses`, `transcript`, `WitnessReport`.

**Depends on:** core, rules, characters, pack, state, memory.
**Design:** `relationships.md` §1. **Tuning:** the ruleset's `meters`, `wordScale` and `relations`.
