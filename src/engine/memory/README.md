# engine/memory

The Memory Bank's rules (memory §6, milestone 4b): which memories a character brings to a scene, and how memories fade. **Recall** (`recall`, `selectMemories`): of the memories still in recall, Core ones take at most about `memory.coreShare` of the tier's slots (`memory.recall`: recurring, major), ranked by relevance (people in the scene, the player included, and the place), then the most recent and most revisited; the rest go to Normal and Fleeting by relevance, then recency; slots one side can't fill go to the other. A Major Character's budget is the same in the party or out of it. **Fading** (`fadeMemories`): a Normal memory steps down to Fleeting after `memory.fade.normal` in-game days since its clock last started, a Fleeting one leaves recall after `memory.fade.fleeting`; Core never fades and nothing leaves the save. Memories are made at scene end (`@engine/relationships`).

**Public API** (`@engine/memory`): `recall(ruleset, state, character, context?)`, `recallContext`, `relevance`, `selectMemories`, `memoryId`, `fadeMemories`, `RecallContext`.

**Depends on:** characters, rules, state. **Design:** `memory.md`. Adapted from Breedhaven.
