# engine/rules

Story checks, read entirely from the pack's ruleset: attributes and their modifier formula, skills, rank caps by level, difficulty words and their targets, degree margins, criticals, advantage (never stacked; advantage and disadvantage cancel) and assists.

**Public API** (`@engine/rules`)
- `RulesetSchema`, `Ruleset`, `rulesetProblems`, `skillById`, `difficultyDc`, `meterIds`, `neutralWord`.
- `rollCheck(ruleset, stats, request, dice)`, `describeCheck`, `degreeOf`, `modifier`, `rankCap`, `assistFrom`, `combineEdges`, `averageStats`.
- `StatBlockSchema`: attributes and skill ranks by the ruleset's ids.

**Resolution strategies** are named in code and chosen by the ruleset. There is one, `d20-vs-dc`. A pack wanting another core mechanic needs a new strategy here; packs never contain formulas.

**Depends on:** core.
**Design:** `claude/core-rules.md` (the first pack's ruleset), `claude/architecture.md` §5.
**Tuning:** in each pack's `ruleset/ruleset.json`.
