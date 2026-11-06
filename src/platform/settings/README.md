# platform/settings

Settings on disk: the four LLM profiles (API keys encrypted with Electron's safeStorage when available) and the extra folders to look for packs in.

**Public API** (`@platform/settings`): `SettingsStore`, `KeyCipher`. **Depends on:** llm. Adapted from Breedhaven.
