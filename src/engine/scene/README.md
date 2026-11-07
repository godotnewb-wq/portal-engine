# engine/scene

One player turn, in at most three LLM calls (`runTurn`):

1. **Director** (`director.ts`): reads everything about the scene and returns a JSON beat plan (`plan.ts`). The game checks it against the scene and the ruleset (`validatePlan`); an unreadable reply means the game plans the turn itself (`fallbackPlan`), at no extra call. The plan's `exchange` is the turn's conversation in order, at most `MAX_LINES` lines by the (at most two) speakers: each line says who, what it `answers` (the player or an earlier line's number) and its `point`, what it gets across with its content (an answer, offer, refusal, the specific lie). The writer writes the lines in that order, each responding to the line it answers. Validation drops lines by non-speakers, turns a reply to a dropped or later line into one to the player, gives a speaker left without a line one, and counts lines without a point; a plan in the older form (a `point` per speaker) reads as one line each. `planLines` reads both forms for read-outs, and a dialogue beat's trace links to its `line:<n>`. Points are notes, not lines: the director is told never to write dialogue or prose into the plan, and a point with quoted words counts as a correction; the writer writes each line fresh in the character's voice. Reactions are silent: quoted speech of three or more words in a narration beat is a `speech-in-narration` problem, and if the rewrite still has it, salvage cuts the words and keeps the action (`withoutSpeech`). A speaker's beats in a row, with only narration between, are one planned line written in parts. Anyone silent for `QUIET_TURNS` turns is listed in the director's turn prompt with their trade, aims and knowledge, so the director can see whether the conversation touches them; whether they speak stays its call (no quotas).
2. **Game resolution** (`resolve.ts`): rolls the plan's checks with the seeded dice.
3. **Writer** (`writer.ts`): sees only the plan, this beat's speakers' voice cards, the style guide and the pack's tone; streams one beat per line with hidden tags (`beats.ts`). A beat is speech or narration, never both: a dialogue beat holds only the quoted words, and a character's actions are narration beats that name them. A line that still mixes the two is split by code into beats in order (`ParsedReply.reshaped`, `TurnTrace.writer.reshaped`), with no rewrite.
4. **Code checks** (`checks.ts`): speaking or acting for the player, unplanned or unknown speakers, over-used phrases (the engine's and the pack's), beat length and count. Any hit means one rewrite; a rewrite that still fails is salvaged by code, never a fourth call.
5. **Apply** (`turn.ts`): the turn goes into the state with moods, comfort, expressions and departures.

Every turn also returns a **turn trace** (`trace.ts`, milestone 2 A1): identity, the cast before and after, the director's full prompt and raw reply and how it was read, the plan after corrections, a breakdown of every check, the writer's and rewrite's prompts and replies with timings, the code findings and what salvage did, each beat with its source line and the plan item it carries out, the tags, and the cost. The engine builds it; the platform writes it (`@platform/logs`). A failed call throws a `TracedError` with the calls made so far.

**Public API** (`@engine/scene`): `runTurn`, `TurnLlm`, `TurnEvent`, `TurnOutcome`, `TurnOptions` (turn id, log session, clock); `TurnTrace`, `BeatTrace`, `CheckTrace`, `CastSnapshot`, `planItems`; `promptSources` (the fixed texts the prompt version hashes); the prompt builders, `parsePlan`, `validatePlan`, `resolvePlan`, `parseReply`, `checkReply`, `applyTurn`, `STYLE_GUIDE`, `OVERUSED_PHRASES`, `BEATS`.

The templates are engine code; every world word in them comes from the pack (primer, tone, setting name, skills, difficulty words, meters, phrases).

**Depends on:** core, rules, characters, world, pack, state, memory.
**Design:** `claude/narrator-scene-engine.md`. **Tuning:** `BEATS`, `MAX_SPEAKERS`, `MAX_CHECKS` (code); the pack's tone, primer and phrases.

## Two pipelines (since 2026-11-07)
`runTurn` takes `pipeline`: **`situation`** (the default) or **`lines`** (the older one, kept so the bench can compare: `npm run bench -- --pipeline lines`). The turn trace records which ran (`director.pipeline`).

**Situation** (`director2.ts`, `plan2.ts`, `facts.ts`, `writer2.ts`; `claude/director-writer-review.md`, option B): the director plans what is true, wanted and at stake, and writes no prose or dialogue.
- `player_action` says what the player is doing and whether it is an uncertain attempt; a player check without one is dropped.
- Each speaker has a `goal`, and `keeps` lists the ids of secrets they're holding back.
- `moves` is the conversation in order: who, what it `answers`, a kind of move (answer, ask, push back, dodge, …), the ids of the facts it `uses`, and anything `new` it brings in (a price, a time).
- `change` says what is different by the end of the turn. Texture is at most one detail.

`facts.ts` gives every knowledge line and secret an id (`<character>.k<n>`, `<character>.<secret>`), the place's news `place.<n>`, and what has been said on screen `said.<n>`. A move may use only its speaker's facts, the place's, or what has been said (`canSay`); anything else is dropped from the move and counted. `applyTurn` adds what was said to the scene's `told` and `newFacts`, so the next turn marks a fact new to the player only the first time, and anyone present can repeat it after.

The writer's prompt (`writer2.ts`) is a few principles and one example. It gets what the player has been told, the moves with their facts (each marked when new to the player), each speaker's goal, a secret's tell, the change and the check results. `exchange` is filled from the moves, so traces, read-outs and metrics work for both pipelines.
