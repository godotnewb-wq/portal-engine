# engine/characters

What a character file holds: tier (recurring or companion), species, look, role, faction (with an optional `level` on the engine's four levels, a free-text `rank` title and an `occupation`; any may be blank), personality, portrait (how they are with strangers and people they know, what they notice, habits: the writer's picture of them), agenda, contradictions, voice card (rhythm, vocabulary, slang, what they avoid, sample lines, and how they sound angry, warm and lying), mood, knowledge, values, secrets with tells, starting meters toward the player, relations, and a stat block for companions. Also the player.

**Public API** (`@engine/characters`): `CharacterSchema`, `PlayerSchema`, `VoiceCardSchema`, `SecretSchema`, `MetersSchema` (meters by the ruleset's ids), and their types.

Species, factions, skills and meters are the pack's; `engine/pack` checks a character against them.

**Depends on:** core, rules.
**Design:** `claude/narrator-scene-engine.md` §7, `claude/quests-relationships-npcs.md` §5.
