# Making a pack

A pack is a folder. The engine reads it, checks every file, and refuses to start it (listing the problems in the pack picker) if anything doesn't fit. Packs contain data only: no scripts or formulas.

```
my-pack/
  pack.json              manifest
  cover.png              optional, shown in the picker
  ruleset/ruleset.json   the rules as data
  setting/setting.json   the world: tiers, species, factions, currency
  setting/primer.md      the always-on world primer every scene prompt opens with
  setting/tone.md        tone and style notes for the writer
  setting/phrases.json   optional: phrases this world's prose over-uses (checked like the engine's own list)
  characters/*.json      one file per character
  locations/*.json       one file per place
  player.json            the player character (until character creation exists)
  bench/*.json           optional: scenarios for the scene test bench
```

`packs/test-fixture` is the smallest complete example; `packs/neonpunk-nights` is a real one.

## pack.json

| Field | |
|---|---|
| `id` | lower-case words joined by hyphens; saves are kept per id |
| `name`, `version`, `description`, `author`, `license` | `version` is `major.minor.patch` |
| `engine` | the Portal Engine versions it works with, e.g. `"^0.2.0"` |
| `start` | where a new game opens: `{ "location": "<location id>", "cast": ["<character id>", …] }` |
| `ui` | `title`, `tagline`, `cover` (a file in the pack) |
| `content` | `rating`, `notes`, shown in the picker |

## ruleset.json

The engine supplies the mechanics; the ruleset their parameters and words. See `src/engine/rules/ruleset.ts` for every field.

- `resolution`: `"d20-vs-dc"` (the only strategy so far).
- `attributes`: the list (`id`, `name`), range, the average score, and the modifier formula `floor((score − base) / divisor)`.
- `skills`: `id`, `name`, the `attribute` it rolls with, a one-line `description` for the director.
- `ranks` (max and cap by level), `levels`.
- `difficulties`: the words the director may use, and each one's target number.
- `degrees` (`strongMargin`, `costMargin`), `criticals` (`hit`, `miss`).
- `assists`: which relationship meter decides how much a helper adds, and the thresholds.
- `meters`: the relationship meters every character keeps toward the player and each other (`id`, `name`, `description` used in summary prompts), and their range.
- `wordScale`: the words summaries judge a change in, worst to best, each with its value; one must be worth 0.
- `relations`: where a new relation starts, and labels by meter bands.

## setting.json, primer.md, tone.md

- `name` (and optional `world`), `tiers` (`id`, `name`, `feel`, `danger`), `species` (`id`, `name`, `drawable`, a placeholder `color`), `factions` (`id`, `name`, `summary`), `currency`.
- `primer.md`: a short paragraph of the world's essentials, in prompt-ready prose. Keep it under ~200 words.
- `tone.md`: a few lines on tone. The engine adds its general style guide and its adults-only rule; a pack can't turn the latter off.

## Characters, locations, player

Same files as in milestone 1, checked against the ruleset and setting: a character's `species` and `faction` must be the setting's, its `meters` exactly the ruleset's meters, its `stats` the ruleset's attributes and skills within their ranges and rank caps; a location's `tier` must be a setting tier. Describe every character as an adult.

## Bench scenarios

`bench/*.json`, run with `npm run bench -- --pack <id or path>`. Fields: `tools/bench/README.md`.

## Installing

Drop the folder into the user packs folder (**Open packs folder** in the picker), or add its parent folder under **Settings → Pack folders** while you work on it. **Look again** in the picker re-reads packs.
