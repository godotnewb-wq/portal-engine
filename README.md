# Neonpunk Nights

An LLM-integrated adult visual novel RPG set in Spire City, on the planet Faeworld. The game owns the state; LLMs write the prose and propose changes that code validates.

Status: **Milestone 1** — one scene playable end to end (a Low Turns bar, with Vex, Brask and Oria Senn): director → rolls → streamed writer → code checks → rewrite, end-of-scene memories and meters, saves, and a scene test bench.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Run the app with hot reload |
| `npm run typecheck` | `tsc --noEmit` over everything |
| `npm test` | `vitest run` |
| `npm run build` | Production build into `out/` |
| `npm run bench` | The scene test bench: fixed scenarios through the real pipeline, reports in `bench-output/` (see `bench/README.md`; `--mock` needs no model) |
| `npm run preview:scene` | The scene screen in a browser with a mock API and a scripted turn (no Electron, no LLM) |

## Layout

```
content/default/      The game's content as JSON (characters, locations, the test player)
bench/scenarios/      Scene test bench scenarios
src/shared/model/     zod schemas: the shape of content, settings and saves
src/shared/game/      Pure game logic (dice, checks, rules). No Electron, React or I/O. Tests beside each file.
src/main/             Electron main: content loading, settings, LLM calls, IPC
src/preload/          The IPC bridge
src/renderer/src/     React UI
```

## License

GPL-3.0-only. Includes code adapted from Breedhaven University; see `NOTICE.md`.
