# app

The Electron app. It shows state and forwards input; it holds no game logic.

- `main/`: creates the window; owns the chosen pack, its save store and its play logs (`PlayLogs`); IPC handlers for packs, settings, turns, scene ends, saves, log sessions, flags and turn details.
- `preload/`: exposes the IPC as `window.api` (the contract is `ipc.ts`).
- `renderer/`: React screens. The pack picker comes first, then the pack's title screen, the scene, the summary, saves and settings. Reading logic is in `ui/reading.ts`.

Logs (milestone 2): a log session begins when a game is started or loaded (`beginLog`) and ends at the title screen or on quitting. On the scene screen, **Details** opens the Turn details panel for the turn on screen (plan, check breakdowns, code findings, rewrite, timings, beats with flags, AI scores); the text box shows "turn N · beat n of m". **F** (or the ⚑ button) opens the flag panel on the beat being read, **Shift+F** on the whole turn: `1`/`2`/`3` rate, reasons are tags, typing fills the note, `Enter` saves, `Esc` cancels. F does nothing while focus is in a text field, so it never types into the player's line. Only logged turns can be flagged; flags go to the current session's `flags.jsonl` and name the session that recorded the turn. Settings has the logging switch and **Open logs folder**.

The renderer runs in a browser context, so it imports platform code only as types (checked in `tests/architecture.test.ts`).
