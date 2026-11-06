# engine/scene

One player turn, in at most three LLM calls (`runTurn`):

1. **Director** (`director.ts`): reads everything about the scene and returns a JSON beat plan (`plan.ts`). The game checks it against the scene and the ruleset (`validatePlan`); an unreadable reply means the game plans the turn itself (`fallbackPlan`), at no extra call.
2. **Game resolution** (`resolve.ts`): rolls the plan's checks with the seeded dice.
3. **Writer** (`writer.ts`): sees only the plan, this beat's speakers' voice cards, the style guide and the pack's tone; streams one beat per line with hidden tags (`beats.ts`).
4. **Code checks** (`checks.ts`): speaking or acting for the player, unplanned or unknown speakers, over-used phrases (the engine's and the pack's), beat length and count. Any hit means one rewrite; a rewrite that still fails is salvaged by code, never a fourth call.
5. **Apply** (`turn.ts`): the turn goes into the state with moods, comfort, expressions and departures.

Every turn also returns a **turn trace** (`trace.ts`, milestone 2 A1): identity, the cast before and after, the director's full prompt and raw reply and how it was read, the plan after corrections, a breakdown of every check, the writer's and rewrite's prompts and replies with timings, the code findings and what salvage did, each beat with its source line and the plan item it carries out, the tags, and the cost. The engine builds it; the platform writes it (`@platform/logs`). A failed call throws a `TracedError` with the calls made so far.

**Public API** (`@engine/scene`): `runTurn`, `TurnLlm`, `TurnEvent`, `TurnOutcome`, `TurnOptions` (turn id, log session, clock); `TurnTrace`, `BeatTrace`, `CheckTrace`, `CastSnapshot`, `planItems`; `promptSources` (the fixed texts the prompt version hashes); the prompt builders, `parsePlan`, `validatePlan`, `resolvePlan`, `parseReply`, `checkReply`, `applyTurn`, `STYLE_GUIDE`, `OVERUSED_PHRASES`, `BEATS`.

The templates are engine code; every world word in them comes from the pack (primer, tone, setting name, skills, difficulty words, meters, phrases).

**Depends on:** core, rules, characters, world, pack, state, memory.
**Design:** `claude/narrator-scene-engine.md`. **Tuning:** `BEATS`, `MAX_SPEAKERS`, `MAX_CHECKS` (code); the pack's tone, primer and phrases.
