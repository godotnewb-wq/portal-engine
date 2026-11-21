# platform/settings

Settings on disk: the four LLM profiles (API keys encrypted with Electron's safeStorage when available) the extra folders to look for packs in, whether play is logged, and the **lore budgets** the player set over every pack's defaults (`getLoreBudgets`, `setLoreBudgets`: cleaned by `@engine/rules`' `cleanLoreBudgets`, so only numbers within the bounds are kept), and the **turn pipeline** (`getPipeline`, `setPipeline`: `situation` or `scene` while Milestone 5 tests the redesign; anything else reads as the default).

**Public API** (`@platform/settings`): `SettingsStore`, `KeyCipher`. **Depends on:** llm, engine/rules, engine/scene. Adapted from Breedhaven.
