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
  setting/phrases.json   optional: the pack's own words (overused phrases, stance words, generic words)
  characters/*.json      one file per character
  locations/*.json       one file per place
  codex/**/*.md          optional: lore, one Markdown file per entry (below)
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
| `start` | where a new game opens: `{ "location": "<location id>", "cast": ["<character id>", …], "party": ["<character id>", …] }`; `party` lists Major Characters already with the player, each in the cast and with a stat block |
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
- `assists`: `minRank`, the skill rank a companion needs to help, and `bonus`, what helpers add by how many help (`[0, 2, 3]`: none, one, two or more). Whether a companion is willing is their assist gate (`people.gates.assist`, shifted by their layers and motives).
- `meters`: the relationship meters every character keeps toward the player and each other (`id`, `name`, `description` used in the director and summary prompts, and `bands`: word bands lowest first, the first starting at `min`), their signed range (`min`, `max`) and `neutral` point. Prompts and the summary screen show bands, never numbers.
- `wordScale`: the words summaries judge a change in, worst to best, each with its value; one must be worth 0.
- `relations`: where a new relation starts (`start`: a stranger, normally neutral).
- `people`: how the pack describes people (npc design §3–8): `ages` (stages, and which the child guard covers), `axes` and `attachment` (each a scale of stages), `values` (list with groups, strength words), `foundations` (list, sensitivity words), `emotions` (families, one or more mood-only, and shades with their families and typical 1–5 intensity), `masking` (levels, the axis that sets the default, its default per stage), `ladder` (requirement words, loosest first, from no requirement to blocked), `gates` (default words per action), `links` (default shifts from layer entries), `motives` (types with floors, strengths with steps, the limit), `malleability`, `fieldLocks`, and `forms` (what a card holds by tier: ranges for haunts, axes, values and tells).
- `ties`: relationship tags (relationships §3): `max` per direction, `groups`, and `tags` with their counterpart, display words, and `oneSided` and `family` flags.
- `party`: `max`, how many companions the player can have at once (default 3).
- `memory`: `recall`, how many memories a character brings to a scene by tier (`recurring`, `major`; defaults 4 and 8).
- `codex`: `fullWords`, the most words a codex entry's text may have (default 120); `sceneTokens` and `triggeredTokens`, rough budgets for the scene-scoped and triggered lore layers (defaults 800 and 400).
- `briefs`: the director's briefs (director writer §7): `detailTokens`, the rough token budget the scene's optional detail shares (knowledge, goals, contradictions, history notes, ties to people not here; default 500), `absentPerCharacter` and `absentPerScene`, how many people not here one character and the scene may bring in (defaults 3 and 6), and `closeTies`, how many names a Major Character's close-ties line holds (default 3).
- `pressures`: words for how hard a character's aim for the scene presses on them, weakest first (at least two). The weakest keeps the aim out of the writer's brief; the strongest makes it what drives them.

## setting.json, primer.md, tone.md, phrases.json

- `name` (and optional `world`), `tiers` (`id`, `name`, `feel`, `danger`), `species` (`id`, `name`, `drawable`, a placeholder `color`), `factions` (`id`, `name`, `summary`, and `parent` for a sub-group with an identity of its own), `stances`, `currency`.
- `stances`: official stances between factions, one way: `{ "from", "toward", "stance" }`, `stance` being one of the pack's stance words. Write only the ones that matter; a faction with none toward another has none, and nothing is mirrored.
- `phrases.json`: `overused` (phrases this world's prose over-uses), `stanceWords` (exactly five, warmest first, if there are stances), `stanceWarnings` (words that suggest codex prose is stating a stance; flagged as warnings) and `genericWords` (words the name check ignores when comparing names, like "the" or "council").
- `primer.md`: a short paragraph of the world's essentials, in prompt-ready prose. Keep it under ~200 words. With a codex, it opens the stage before every entry's `stage` line, so keep to what no stage line says.
- `tone.md`: a few lines on tone. The engine adds its general style guide.

## Characters, locations, player

Same files as in milestone 1, checked against the ruleset and setting: every character carries a full card for its tier (the ruleset's `people.forms`: age stage, haunts, tells, layers, expression and so on; `src/engine/pack/cards.ts`), relationship tags mirrored across the cast, a character's `species` and `faction` must be the setting's, its `meters` exactly the ruleset's meters, its `stats` the ruleset's attributes and skills within their ranges and rank caps; a location's `tier` must be a setting tier.

- Characters may also have a `level` in their faction (`affiliated`, `member`, `trusted` or `leadership`; needs a `faction`), a `rank` title they go by (flavor; needs a `level`) and an `occupation` (lower case). Any may be left out.
- A secret is personal (`text`) or linked to a codex secret: `{ "id", "codex": "<secret entry id>", "role": "their part in it", "angle": "how they feel about it", "tell" }`. The holder must fit the entry's `known-by`, and no more characters than its `cap` may hold it.
- A location may have a `parent`: its codex region, `location.<tier>.<region>`, which must exist and be under the location's tier.

## The codex

Lore the prompts draw on, one Markdown file per entry. The path gives the id: the top folder names the kind (`locations`, `factions`, `species`, `philosophies`, `concepts`, `events`, `world`), each folder below adds a part, and `main.md` takes its folder's id (`factions/guild/main.md` → `faction.guild`).

```markdown
---
name: The Guild
kind: faction
aliases: [the hall]
keywords: [guild hall]
summary: Runs the yard and counts every crate.
stage: The Guild runs the yard and counts every crate that passes.
---
The Guild owns the yard, sets the cart fees and keeps the tallies.
```

- **Header:** `key: value` lines, quoted strings and one-line lists only. Fields: `name`, `kind`, `summary` (required); `keywords`, `aliases`, `stage`, `knowledge` (`common`, `circles`, `secret`), `circle`, `also`, `known-by`, `cap`, `audience`, `belief`, `related`, `source`, `expires`. The body is the entry's text (at most the ruleset's `codex.fullWords`).
- **Locations are the map tree:** `locations/<tier>/main.md`, `locations/<tier>/<region>/main.md`, `locations/<tier>/<region>/<place>.md`. The first folder must be a setting tier, and every layer needs its own entry.
- **A place's entry** is its region's folder plus the location file's id (`locations/<tier>/<region>/<location id>.md`), so the location file's `parent` finds it.
- **Factions:** a folder per faction with `main.md` and any deeper entries beside it; a sub-group's folder sits inside its parent's. Only a top-level faction's `main.md` has a `stage` line.
- **Who knows what:** `circles` entries say who's inside with `circle` (default: the entry's faction, member and above) and `also`; `secret` entries say who may hold them with `known-by` and an optional `cap`. Selectors: `<faction> [affiliated+|member+|trusted+|leadership+]`, `occupation <words>`, `tier <id>`, `species <id>`, `character <id>`.
- Never state a stance in codex text: stances are setting data.

## Bench scenarios

`bench/*.json`, run with `npm run bench -- --pack <id or path>`. Fields: `tools/bench/README.md`.

## Installing

Drop the folder into the user packs folder (**Open packs folder** in the picker), or add its parent folder under **Settings → Pack folders** while you work on it. **Look again** in the picker re-reads packs.
