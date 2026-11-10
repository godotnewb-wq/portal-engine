# platform/settings

Settings on disk: the four LLM profiles (API keys encrypted with Electron's safeStorage when available) the extra folders to look for packs in, whether play is logged, and the **lore budgets** the player set over every pack's defaults (`getLoreBudgets`, `setLoreBudgets`: cleaned by `@engine/rules`' `cleanLoreBudgets`, so only numbers within the bounds are kept).

**Public API** (`@platform/settings`): `SettingsStore`, `KeyCipher`. **Depends on:** llm, engine/rules. Adapted from Breedhaven.
