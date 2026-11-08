# platform/roles

Connects the engine's LLM roles to the configured profiles: `turnLlm(settings, nsfw)` gives `runTurn` its director (JSON) and streamed writer; `summaryLlm` gives `endScene` its summary call.

**Depends on:** llm, engine/scene, engine/relationships.

JSON calls get at least a floor of reply tokens whatever the profile says (`DIRECTOR_MIN_TOKENS` 4000, `SUMMARY_MIN_TOKENS` 2000, `SCORER_MIN_TOKENS` 3000), so a long plan, or a thinking model's reasoning plus its answer, isn't cut off mid-JSON.
