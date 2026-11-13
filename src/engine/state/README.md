# engine/state

The game state and what is saved: the player, time, the dice's state, each character's meters toward the player, relations between characters, the party (Major Characters with the player; separate from tier), memories, learned facts, and a scene in progress (its turns, beats, checks, moods, comfort, expressions, departures). Also the save file format and slots.

**Public API** (`@engine/state`): `GameStateSchema`, `SceneSchema`, `TurnSchema`, `BeatSchema`, `MemorySchema`, `RelationSchema`; `createInitialState`, `startScene` (takes the scene's id; turns are numbered from it, and each turn keeps its id and the log session that recorded it), `stateProblems` (does a saved game still fit this pack?); `SaveFileSchema` (records the pack id and version), `SAVE_VERSION` (a save in an earlier format is refused with its own message and listed as `outdated`), slot ids, `latestSave`.

Scene *data* lives here, below the scene pipeline, so the two don't import each other.

**Depends on:** core, characters, pack.
