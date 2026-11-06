# engine/review

Judging the writing after the fact (milestone 2): the flag a person puts on a beat or turn, the quality rubric, and the AI scorer's prompt and reading. Nothing here runs during a turn.

**Public API** (`@engine/review`): `RATINGS`, `FLAG_REASONS` (the fixed reason list; packs don't add to it), `FlagSchema`, `FlagRecordSchema`, `flagKey`, `currentFlags`; `RUBRIC`, `itemsFor`, `ScorableTurn`; `buildScorerPrompt`, `parseScore`, `SCORER_VERSION`, `ScoreRecord`.

The rubric and the scorer's prompt name no world: a pack's tone, location and character cards come in through the same slots the director and writer use. Items that can't be judged on a turn (checks with no check, secrets with no secret, repetition on a first turn) aren't asked.

**Depends on:** core, pack, scene.
**Design:** `claude/milestone-2-plan.md` A3, A5, B1; `claude/writing-quality.md`.
