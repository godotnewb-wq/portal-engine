# Neonpunk Nights

Adult LLM-driven visual novel RPG: Electron, React 19, TypeScript, zod, Vitest. Design docs live in the claude.ai project "RPG Game" (`design-notes.md`, `core-rules.md`, `narrator-scene-engine.md`, `milestone-1-plan.md`, …).

## Commands
- `npm run typecheck` and `npm test` after every change; report what they said.
- After changing a prompt, the style guide, output checks or a character file, run `npm run bench` (needs a model; see `bench/README.md`) and compare against the previous run with `--compare`.
- `npm run preview:scene` shows the renderer in a browser with a mock API, for looking at screens without Electron.

## Rules
- Game rules are pure functions in `src/shared/game`, tests beside each file. Renderer and main only call them.
- **What the LLM writes is not trusted.** It proposes; code validates against state before anything changes.
- **The LLM makes verbal judgments only** (difficulty words, meter words); config maps them to numbers.
- Code copied from Breedhaven keeps a header naming its source file, and is listed in `NOTICE.md`.
- No backwards compatibility for saves or content until the game is public.
- Comments say why, in plain prose. Prompts are terse.
- Content is US English and always describes characters as adults.
