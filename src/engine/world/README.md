# engine/world

Places and the setting they belong to. A location has a tier, a description, a texture card (sights, sounds, smells, slang, lately) the director picks details from, walk-on scene cards and extras. The setting names the world and lists its tiers, species (with drawable traits and a placeholder color), factions and currency.

**Public API** (`@engine/world`): `LocationSchema`, `SceneCardSchema`, `TextureCardSchema`, `SettingSchema`, `settingProblems`, `tierById`, `speciesById`, `factionById`.

**Depends on:** core.
**Design:** `claude/architecture.md` §5 (setting), `claude/narrator-scene-engine.md` §8 (texture cards).
