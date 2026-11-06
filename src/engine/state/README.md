# engine/state

The game state and what is saved: the player, time, the dice's state, each character's meters toward the player, relations between characters, memories, learned facts, and a scene in progress (its turns, beats, checks, moods, comfort, expressions, departures). Also the save file format and slots.

**Public API** (`@engine/state`): `GameStateSchema`, `SceneSchema`, `TurnSchema`, `BeatSchema`, `MemorySchema`, `RelationSchema`; `createInitialState`, `startScene`, `stateProblems` (does a saved game still fit this pack?); `SaveFileSchema` (records the pack id and version), `SAVE_VERSION`, slot ids, `latestSave`.

Scene *data* lives here, below the scene pipeline, so the two don't import each other.

**Depends on:** core, characters, pack.
