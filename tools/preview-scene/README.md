# Scene preview

`npm run preview:scene`: the renderer in a browser with a mock `window.api`. It lists the bundled packs (plus a deliberately broken one) and plays them through the real turn pipeline on a scripted model: the Sump Lantern scene gets a scripted turn, any other pack the bench's generic mock. Saves are kept in memory. For looking at screens without Electron or an LLM.
