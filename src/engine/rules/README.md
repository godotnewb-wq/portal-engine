# engine/rules

Story checks, read entirely from the pack's ruleset: attributes and their modifier formula, skills, rank caps by level, difficulty words and their targets, degree margins, criticals, advantage (never stacked; advantage and disadvantage cancel) and assists. The ruleset also holds the pressure words the scene director uses for how hard a character's aim presses (`pressures`, weakest first), and the codex's tuning (`codex`: the entry word cap, the scene and triggered layers' token budgets, lore lines a turn). **Lore budgets** (`loreBudgets.ts`): the player may override the scene and triggered budgets and lore lines a turn in Settings, one set for every pack; `cleanLoreBudgets` keeps only numbers within `LORE_BUDGET_BOUNDS` (rounded and clamped, with warnings) and `loreBudgets(ruleset, overrides)` gives the budgets in effect and which were set.

**Public API** (`@engine/rules`)
- `RulesetSchema`, `Ruleset`, `rulesetProblems`, `skillById`, `difficultyDc`, `meterIds`, `neutralWord`.
- `rollCheck(ruleset, stats, request, dice)`, `describeCheck`, `degreeOf`, `modifier`, `rankCap`, `assistFrom`, `combineEdges`, `averageStats`.
- `StatBlockSchema`: attributes and skill ranks by the ruleset's ids.
- `LORE_BUDGET_FIELDS`, `LORE_BUDGET_BOUNDS`, `LoreBudgetOverridesSchema`, `cleanLoreBudgets`, `loreBudgets`, `LoreBudgets`.

**Resolution strategies** are named in code and chosen by the ruleset. There is one, `d20-vs-dc`. A pack wanting another core mechanic needs a new strategy here; packs never contain formulas.

**Depends on:** core.
**Design:** `claude/core-rules.md` (the first pack's ruleset), `claude/architecture.md` §5.
**Tuning:** in each pack's `ruleset/ruleset.json`.
