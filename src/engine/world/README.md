# engine/world

Places and the setting they belong to. A location has a tier, a description, a texture card (sights, sounds, smells, slang, lately) the director picks details from, walk-on scene cards and extras. The setting names the world and lists its tiers, species (with drawable traits and a placeholder color), factions and currency. Factions can be sub-groups of another (`parent`; membership rolls up one level lower, capped at trusted: `parentLevel`), and the setting holds the official **stances** between factions: one way, sparse, in the pack's stance words, on five engine levels. Standing in a faction is one of four engine levels (`FACTION_LEVELS`: affiliated, member, trusted, leadership). A location's optional `parent` names its codex region, so it knows its whole map chain.

**Public API** (`@engine/world`): `LocationSchema`, `SceneCardSchema`, `TextureCardSchema`, `SettingSchema`, `settingProblems`, `tierById`, `speciesById`, `factionById`, `factionChain`, `FACTION_LEVELS`, `FactionLevelSchema`, `levelRank`, `parentLevel`, `STANCE_LEVEL_COUNT`.

**Depends on:** core.
**Design:** `architecture.md` §5 (setting), `director writer.md` §8 (texture cards).
