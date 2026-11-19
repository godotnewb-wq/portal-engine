# platform/roles

Connects the engine's LLM roles to the configured profiles: `turnLlm(settings)` gives `runTurn` its director (JSON) and streamed writer; `summaryLlm` gives `judgeScene` and `endScene` their end-of-scene calls (each witness's relationship call and memory call), and consolidation its call. `bookkeeperLlm` gives the bookkeeper its call after each turn (milestone 4c), and `bookkeeperWaitMs` says how long a turn may wait for it: the timeout of the profile that answers, the bookkeeper's own (30 seconds by default) or a borrowed one's.

**Depends on:** llm, engine/scene, engine/relationships.

JSON calls get at least a floor of reply tokens whatever the profile says (`DIRECTOR_MIN_TOKENS` 4000, `SUMMARY_MIN_TOKENS` 2000, `SCORER_MIN_TOKENS` 3000, `BOOKKEEPER_MIN_TOKENS` 1500), so a long plan, or a thinking model's reasoning plus its answer, isn't cut off mid-JSON.
