# platform/packs

Finds and reads packs on disk.

- `discoverPacks(sources)`: scans the bundled packs, the user packs folder in app data and any extra folders from Settings. Every pack is listed, including broken ones with their problems and packs sharing an id (marked), and covers are read as data URLs.
- `readPack(dir)` / `readPackFiles(dir)` / `loadPack(dir)`: read one pack folder (including every `.md` file under `codex/`) and pass its files to `engine/pack`'s `buildPack`.

**Depends on:** engine/pack. **Design:** `claude/architecture.md` §9.
