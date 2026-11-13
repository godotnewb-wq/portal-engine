# engine/pack

A game pack, loaded and checked. `buildPack(files)` is the one step that turns a pack's files into a `Pack`: each file against its schema, the ruleset and setting against themselves, then the content against both (unknown species, factions, tiers, skills, attributes, meters; ranks above the cap; duplicate ids; an opening scene that can't start; faction levels without a faction and rank titles without a level; stances in words the pack doesn't define; the codex content check; character secrets pointing to a missing or non-secret entry, held by someone outside its `known-by`, or by more characters than its `cap`). `setting/phrases.json` gives `phrases` (overused phrases) and `vocabulary` (the five stance words, stance-word warnings, generic words for the name check); `codex/` gives `codex`. It works on data, not disk; `platform/packs` reads the folder. Pack overlays (later) will slot in between reading and building.

**Public API** (`@engine/pack`): `Pack`, `PackFiles`, `buildPack`, `packProblems`, `packWarnings` (authoring warnings: stance words in codex text, a character starting with more secrets than `codex.startingSecrets`), `characterById`, `locationById`, `withSecretTexts` (a linked secret's text from the codex), `knowerOf`, `PhrasesSchema`, `Vocabulary`; `PackManifestSchema`, `ENGINE_VERSION`, `satisfies` (engine version ranges such as `^0.2.0`).

**Depends on:** core, rules, characters, world, codex.
**Design:** `claude/architecture.md` §5, §12.
