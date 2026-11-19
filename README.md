# Portal Engine

A game-agnostic engine for single-player LLM visual novel RPGs. The engine runs the gameplay: a director plans each turn, the game rolls the dice, a writer streams the prose as visual-novel beats, code checks catch what the LLM gets wrong, characters remember scenes and change how they feel, and games are saved. **Game packs** supply everything specific to one game: its ruleset, world, lore, characters, places, tone and art.

The first pack is **Neonpunk Nights**, a mature (M-rated) visual novel RPG set in Spire City (`packs/neonpunk-nights`). `packs/test-fixture` is a tiny pack with a deliberately different ruleset that the engine's tests run against.

Status: **Milestone 4c complete** (2026-11-19, closed at `22e5668` on `milestone-4c`); 4d (Turn details by category) is next. Milestones 1–3.6, 4a, 4b and 4c are complete: the scene turn, the lore codex, full character cards, signed meters, relationship tags and director briefs (4a); felt vs. shown emotion, mood and aftermath across in-game days, relationship tags that change in play, and the Memory Bank (several memories per scene, fading, relevance recall, learned and dormant secrets, consolidation) (4b, closed at `06c0e96`); a bookkeeper call after each turn that records what the prose did (secrets that came out, guesses, leaks as claims, new details), who-knows-what notes for the writer, and each witness's end-of-scene relationship and memory calls (4c). Saves are version 9; earlier saves are refused. Status and next steps are in `Developer Handoff.md` in the design docs folder.

## Running it

Node.js 22.12 or newer.

```
npm install        # also downloads Electron's app (postinstall)
npm run dev        # the app, with hot reload
```

The app opens on the **pack picker**. Choose a pack; set up your models under **Settings** (any OpenAI-compatible endpoint; only the scene writer is required).

On Windows, if PowerShell refuses to run `npm` ("running scripts is disabled on this system"), run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use Command Prompt.

| Command | What it does |
|---|---|
| `npm run dev` | The app with hot reload |
| `npm run typecheck` | `tsc --noEmit` over everything |
| `npm test` | Vitest: engine tests (on the test fixture), pack tests, architecture checks |
| `npm run build` | Production build into `out/` |
| `npm run bench` | The scene test bench: a pack's scenarios through the real pipeline (`tools/bench/README.md`) |
| `npm run preview:scene` | The screens in a browser with a mock API and scripted turns, no Electron or LLM |
| `npm run logs` | Play logs and bench runs: transcripts, flags, stats, blind voice tests, scenarios from logged turns, AI scoring (`tools/logs/README.md`) |

## How it's organized

```
src/
  llm/         OpenAI-compatible client, router, streaming, refusal detection. Knows nothing about games.
  engine/      Pure TypeScript game systems, one folder each. No Electron, React or disk.
    core/  rules/  characters/  world/  pack/  state/  memory/  relationships/  scene/
  platform/    The only code touching disk: packs, saves, settings; roles wires LLM profiles to the engine.
  app/         Electron main, preload, React renderer. Shows state, forwards input.
packs/         Game packs (data only)
tools/         bench/, logs/, preview-scene/
tests/         Pack tests (tests/<pack>/), the shared fixture, architecture checks
```

Layers import downward only (llm → engine → platform → app), systems import each other only through their `index.ts`, and `src/` contains no pack's names. `tests/architecture.test.ts` checks all of this on every test run. Each system's folder has a README: what it does, its API, what it depends on and which design doc describes it.

## Packs

A pack is a folder of JSON and Markdown: no code. The engine validates it on load, and the picker shows what's wrong with a broken pack instead of hiding it. How to make one: `packs/README.md`.

Packs are found in three places: bundled with the app (`packs/` here), the user packs folder in app data (**Open packs folder** in the picker), and any extra folders listed in Settings. Each pack has its own saves.

## Data locations

Settings, saves and user packs live in the app-data folder, `Portal Engine` (Windows: `%APPDATA%\Portal Engine`; macOS: `~/Library/Application Support/Portal Engine`; Linux: `~/.config/Portal Engine`). Saves are under `saves/<pack-id>/`.

## License

GPL-3.0-only (includes code adapted from Breedhaven University; see `NOTICE.md`). Pack content may carry its own license, stated in its `pack.json`.
