# Notices

Neonpunk Nights is free software under the GNU General Public License, version 3 only (see `LICENSE`).

## Code adapted from Breedhaven University

Parts of this program are copied from, or adapted from, **Breedhaven University**
(https://github.com/godotnewb-wq/rpg-game), which is licensed under the GPL-3.0-only.
Those parts remain under that license. Files that carry adapted code say so in a header comment
naming the Breedhaven file they came from.

Adapted so far:

| This project | From Breedhaven |
|---|---|
| `src/main/ai/openai.ts` | `src/main/ai/openai.ts` (chat completions, model listing, refusal detection; streaming added) |
| `src/main/ai/queue.ts` | `src/main/ai/queue.ts` |
| `src/main/ai/router.ts` | `src/main/ai/router.ts` (generalised from main/nsfw to per-role profiles) |
| `src/shared/game/refusal.ts` | `src/shared/game/refusal.ts` |
| `src/shared/game/seed.ts` | `src/shared/game/seed.ts` |
| `src/shared/settings.ts` | `src/shared/settings.ts` (profiles per role) |
| `src/main/settings/store.ts` | `src/main/settings/store.ts` |
| `src/main/saves/store.ts` | `src/main/saves/store.ts` |
| `src/shared/saves.ts` | `src/shared/saves.ts` |
| `src/shared/game/names.ts` | `src/shared/game/scene.ts` (`plainName`, `namesHer`) |
| `src/shared/game/memory.ts` | `src/shared/game/memory.ts` (`selectMemories`) |
| `src/shared/game/summary.ts` | `src/shared/game/memory.ts` (scene-change word scale and values, summary parsing approach) |

Original art, writing and content of Neonpunk Nights may be licensed separately.
