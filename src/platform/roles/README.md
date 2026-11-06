# platform/roles

Connects the engine's LLM roles to the configured profiles: `turnLlm(settings, nsfw)` gives `runTurn` its director (JSON) and streamed writer; `summaryLlm` gives `endScene` its summary call.

**Depends on:** llm, engine/scene, engine/relationships.
