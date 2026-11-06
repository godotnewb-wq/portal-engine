# app

The Electron app. It shows state and forwards input; it holds no game logic.

- `main/`: creates the window; owns the chosen pack and its save store; IPC handlers for packs, settings, turns, scene ends and saves.
- `preload/`: exposes the IPC as `window.api` (the contract is `ipc.ts`).
- `renderer/`: React screens. The pack picker comes first, then the pack's title screen, the scene, the summary, saves and settings. Reading logic is in `ui/reading.ts`.

The renderer runs in a browser context, so it imports platform code only as types (checked in `tests/architecture.test.ts`).
