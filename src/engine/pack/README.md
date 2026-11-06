# engine/pack

A game pack, loaded and checked. `buildPack(files)` is the one step that turns a pack's files into a `Pack`: each file against its schema, the ruleset and setting against themselves, then the content against both (unknown species, factions, tiers, skills, attributes, meters; ranks above the cap; duplicate ids; an opening scene that can't start). It works on data, not disk; `platform/packs` reads the folder. Pack overlays (later) will slot in between reading and building.

**Public API** (`@engine/pack`): `Pack`, `PackFiles`, `buildPack`, `packProblems`, `characterById`, `locationById`; `PackManifestSchema`, `ENGINE_VERSION`, `satisfies` (engine version ranges such as `^0.2.0`).

**Depends on:** core, rules, characters, world.
**Design:** `claude/architecture.md` §5, §12.
