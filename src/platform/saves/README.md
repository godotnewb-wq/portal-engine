# platform/saves

Save slots on disk: one JSON file per slot, one folder per pack (`saves/<pack-id>/`), written through a temporary file. Saves record the pack id and version; a save from another pack is refused, and one from another version of this pack is returned for the caller to check with `stateProblems`.

**Public API** (`@platform/saves`): `SaveStore`. **Depends on:** engine/state. Adapted from Breedhaven.
