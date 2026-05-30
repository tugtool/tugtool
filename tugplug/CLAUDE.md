# Tugplug Plugin Guidelines

## Skills

The plugin ships **agentless, main-loop-driven** skills — there are no sub-agents:

- **`recipe`** — author an implementation recipe (a plan) in-thread against the
  tugplan skeleton (`tuglaws/tugplan-skeleton.md`); validate with `tugutil validate`.
- **`bake`** — drive a recipe to a tested debug build on an isolated `tugutil dash`
  worktree, committing per step, stopping for review before merge.
- **`dash`** — quick, recipe-less worktree-isolated task, same agentless model as
  `bake` but without a plan.

All three run in the main conversation and ride the `tugutil dash` CLI lifecycle
(`create` → `commit` per step/round → `join`). The flow is
`/tugplug:recipe` → `/tugplug:bake` (or just `/tugplug:dash`) → review → `tugutil dash join`.

The old multi-agent orchestration — a swarm of clarifier/author/critic/conformance/
overviewer/architect/coder/committer/reviewer/auditor/dash agents driven by `plan`,
`implement`, and a `merge` wrapper — has been fully retired: no sub-agents, no
per-step tugstate database, no inter-agent JSON contracts. The `plan`, `implement`,
and `merge` skills and every agent are gone.

## Plan Mode Policy

**DO NOT automatically enter Plan mode.** Never use `EnterPlanMode` unless the user
explicitly asks for it. Just do the work directly.
