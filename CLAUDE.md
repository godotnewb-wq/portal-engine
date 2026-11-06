# Portal Engine

A game-agnostic engine for single-player LLM visual novel RPGs (Electron, React 19, TypeScript, zod, Vitest), run with game packs. The first pack is Neonpunk Nights. Design docs live in the claude.ai project "RPG Game": `architecture.md` (this layout), `project-outline.md` (milestones), `narrator-scene-engine.md`, `core-rules.md`, `lore.md`, and the rest.

## Commands
- `npm run typecheck` and `npm test` after every change; report what they said.
- After changing a prompt, the style guide, output checks or pack content, run `npm run bench` (needs a model; see `tools/bench/README.md`) and compare against the previous run with `--compare`. `npm run bench -- --mock` checks the harness without a model.
- `npm run preview:scene` shows the screens in a browser with a mock API, without Electron.
- `npm run logs -- <command>` reads play logs and bench runs: transcripts, flags, stats, blind tests, scenarios from logged turns, AI scoring (see `tools/logs/README.md`).

## Layout
- `src/llm` → `src/engine/<system>` → `src/platform/<system>` → `src/app`: layers import downward only.
- Systems import each other only through `index.ts` (`@engine/scene`, `@platform/saves`, `@llm`); relative imports stay inside a system. No cycles.
- `engine` and `llm` import only zod: no Electron, React or Node. The renderer imports platform code only as types.
- `tests/architecture.test.ts` enforces all of the above, and that `src/` names nothing from any pack.
- Each system folder has a README; update it when its API changes.

## Rules
- **The engine never names a world.** Places, peoples, factions, characters, tone, skills, difficulty words and meters come from the pack. Example names in comments are made up (e.g. "Ada").
- **Rules are data.** Numbers and vocabularies go in the pack's ruleset, not in code. A new core mechanic is a new resolution strategy in `engine/rules`, never code in a pack.
- Game rules are pure functions in `src/engine`, tests beside each file. Engine tests run against `packs/test-fixture` (`@tests/fixture`); tests that need a real pack's content live in `tests/<pack-id>/`.
- **What the LLM writes is not trusted.** It proposes; code validates against state, ruleset and setting before anything changes.
- **The LLM makes verbal judgments only** (difficulty words, scale words); the ruleset maps them to numbers.
- Packs are read-only data: JSON and Markdown, no scripts. Nothing the game generates is written into a pack folder.
- Code copied from Breedhaven keeps a header naming its source file, and is listed in `NOTICE.md`.
- No backwards compatibility for saves or packs until the game is public.
- Comments say why, in plain prose. Prompts are terse.
- Content is US English and always describes characters as adults.
