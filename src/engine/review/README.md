# engine/review

Judging the writing after the fact (milestone 2): the flag a person puts on a beat or turn, the quality rubric, and the AI scorer's prompt and reading. Nothing here runs during a turn.

**Public API** (`@engine/review`): `RATINGS`, `FLAG_REASONS` (the fixed reason list; packs don't add to it), `FlagSchema`, `FlagRecordSchema`, `flagKey`, `currentFlags`; `RUBRIC`, `itemsFor`, `itemText`, `ScorableTurn`; `buildScorerPrompt`, `parseScore`, `SCORER_VERSION`, `ScoreRecord`.

The rubric and the scorer's prompt name no world: a pack's tone, location and character cards come in through the same slots the director and writer use. Items that can't be judged on a turn (checks with no check, secrets with no secret, repetition on a first turn) aren't asked.

**Scorer version 2** (Milestone 5 task 6; writing quality): items 16 *in the moment*, 17 *responds to meaning* and 18 *undercurrent* join the 15. The items that read the director's plan have a second wording for a `scene`-pipeline turn (`RubricItem.scene`, chosen by `itemText`): 1 *speaker choice* judges focus, 4 *own agendas* what each person in focus wants, 6 (renamed *usable plan* from *texture & avoid*) the moments, pressures and stakes, 8 (renamed *who speaks* from *planned speakers*) the focus carrying the scene, 14 *pacing* the writer's paragraphs. The scorer sees a scene plan as itself (`scenePlanLines`, the secret in full under its pressure, the pools) and a situation plan with its exchange as well as its speakers; a scene turn's beats are marked ¶ where the writer's paragraphs begin. Scores from version 1 aren't comparable and older runs aren't re-scored (Q13). **Version 3** (task 8): item 6 judges the plan, not the prose, on both shapes; item 8 on a scene turn allows anyone present to say a little and counts only someone not present, or an unlisted walk-on. Re-score a run with `npm run logs -- score <run>`; the metrics read each turn's newest version.

**Depends on:** core, pack, scene.
**Design:** `milestone-2-plan.md` A3, A5, B1; `writing quality.md`.
