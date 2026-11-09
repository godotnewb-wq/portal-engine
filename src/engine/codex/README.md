# engine/codex

The codex: a pack's lore as one Markdown file per entry under `codex/`, read into entries the prompt layers will draw on (milestone 3). Each file has a small header in a YAML subset (`header.ts`, parsed by hand so the engine imports only zod) and a body that is the entry's full text. The id comes from the path: the top folder names the kind (`locations`, `factions`, `species`, `philosophies`, `concepts`, `events`, `world`), each folder below adds a part, and `main.md` takes its folder's id.

- **Locations are the map tree:** `locations/<tier>/<region>/<place>.md`, so a place's id carries its region and tier (`locationChain`). Layer 1 must be a setting tier; nothing goes deeper than layer 3; every layer above an entry must have its own entry.
- **Factions** live in a folder per faction; sub-groups are subfolders following the setting's `parent` links. `main.md` is the faction's own entry; other files beside it are deeper entries belonging to it.
- **Knowledge:** `common`, `circles` (who's inside: `circle`, defaulting to the entry's faction at member and above, plus `also`) or `secret` (`known-by`, optional `cap`). Selectors: `<faction> [level+]`, `occupation <words>`, `tier <id>`, `species <id>`, `character <id>`, on the engine's four faction levels (`@engine/world`).
- **Checks:** `buildCodex` reports unreadable files and headers (file and line); `codexProblems` reports what spans the pack (duplicate ids and keywords, alias clashes, text over the ruleset's `codex.fullWords`, secrets open to the writer, misplaced stage lines and selectors, unknown factions, tiers, species, characters and related ids, the map tree, location files' `parent`); `codexWarnings` flags the pack's stance words in codex text.

**Public API** (`@engine/codex`): `parseEntryFile`, `buildCodex`, `idFromPath`, `entryById`, `locationChain`, `codexProblems`, `codexWarnings`, `parseSelector`, `selectorText`, `CodexEntry`, `CodexFile`, `Selector`, `CODEX_KINDS`, `CODEX_FOLDERS`, `KNOWLEDGE`, `AUDIENCES`.

**Depends on:** core, world.
**Design:** `claude/lore-injection.md` §3–4, §7; `claude/architecture.md` §5.
