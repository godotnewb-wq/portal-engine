# Notices

Portal Engine is free software under the GNU General Public License, version 3 only (see `LICENSE`).

## Code adapted from Breedhaven University

Parts of this program are copied from, or adapted from, **Breedhaven University**
(https://github.com/godotnewb-wq/rpg-game), which is licensed under the GPL-3.0-only.
Those parts remain under that license. Files that carry adapted code say so in a header comment
naming the Breedhaven file they came from.

Adapted so far:

| This project | From Breedhaven |
|---|---|
| `src/llm/openai.ts` | `src/main/ai/openai.ts` (chat completions, model listing, refusal detection; streaming added) |
| `src/llm/queue.ts` | `src/main/ai/queue.ts` |
| `src/llm/router.ts` | `src/main/ai/router.ts` (generalised from main/nsfw to per-role profiles) |
| `src/llm/refusal.ts` | `src/shared/game/refusal.ts` |
| `src/llm/settings.ts` | `src/shared/settings.ts` (profiles per role) |
| `src/engine/core/seed.ts` | `src/shared/game/seed.ts` |
| `src/engine/core/names.ts` | `src/shared/game/scene.ts` (`plainName`, `namesHer`) |
| `src/engine/memory/memory.ts` | `src/shared/game/memory.ts` (`selectMemories`) |
| `src/engine/relationships/summary.ts` | `src/shared/game/memory.ts` (scene-change word scale and values, summary parsing approach) |
| `src/engine/state/saves.ts` | `src/shared/saves.ts` |
| `src/platform/saves/store.ts` | `src/main/saves/store.ts` |
| `src/platform/settings/store.ts` | `src/main/settings/store.ts` |

## Packs

Game packs in `packs/` are data loaded by the engine; each states its own license in its `pack.json`.
The Neonpunk Nights pack's writing and art may be licensed separately from the engine.
