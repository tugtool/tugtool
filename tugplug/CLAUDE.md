# Tugplug Plugin Guidelines

## Skills

The plugin ships **agentless, main-loop-driven** skills — there are no sub-agents.

**Plan lifecycle:**

- **`devise`** — author an implementation plan in-thread against the devise skeleton (`tuglaws/devise-skeleton.md`). Writes to an explicit path (no assumed directory).
- **`implement`** — drive a plan to a tested debug build on an isolated `tugutil dash` worktree, committing per step, stopping for review before merge. Walks a single step, a step range, or the whole plan, tracked via the plan's Step Status Ledger. *(was `bake`; before that the old multi-agent `implement`.)*
- **`dash`** — quick, plan-less worktree-isolated task, same agentless model as `implement` but without a plan.
- **`join`** — land a worked dash into its base: preview via `tugutil dash join --preview`, then squash with the dash's join draft as the message, clear the draft, report the receipt. Backs the Session card's `/join` verb. Never releases.

**Assessment & drafting:**

- **`review-plan`** — pre-implementation: lint the plan (`tugutil plan lint`), judge it against [`tuglaws/plan-review-rubric.md`](../tuglaws/plan-review-rubric.md) and the real code, **apply the fixups in the plan**, and append a Review Record. `devise` asks for this automatically through `tugutil plan review-request`, and the card runs it as a turn on a borrowed review model; it is also the by-hand entrance for any plan. *(replaced `vet`, which was read-only by construction and so could only hand its findings back — `vet` is a stub awaiting deletion.)*
- **`audit`** — post-implementation: audit the built code (or step range) against the tuglaws and the real diff, then rule "fixups needed" or "good shape". Read-only.
- **`draft`** — analyze the working changes, decide per-file dispositions, and author the session's landing draft via `tugutil draft set`. **Never commits** — the user lands the draft with `/commit` in the Session card. *(was `commit`, which committed fire-and-forget; skills draft, humans land.)*

The lifecycle skills run in the main conversation and ride the `tugutil dash` CLI (`create` → `commit` per step/round). The flow is `/tugplug:devise` (which asks for its own review turn) → `/tugplug:implement` (or just `/tugplug:dash`) → `/tugplug:audit` → review → the user's `/join <name>` in the Session card (the implement run leaves the dash's join draft behind for it).

**Location discipline (critical):** no skill assumes a plan directory — `roadmap/`, `.tugtool/`, and any other home are never hardcoded. A plan is always an explicit path; the working root is derived from that path and from `tugutil dash create`'s worktree response. Once a worktree exists it is the **only** working root — every operation uses an absolute path into it, and nothing (code, plan, ledger) is written to the base checkout until `tugutil dash join`.

The old multi-agent orchestration — a swarm of clarifier/author/critic/conformance/overviewer/architect/coder/committer/reviewer/auditor/dash agents — has been fully retired: no sub-agents, no per-step tugstate database, no inter-agent JSON contracts. Every agent is gone.

## Plan Mode Policy

**DO NOT automatically enter Plan mode.** Never use `EnterPlanMode` unless the user explicitly asks for it. Just do the work directly.
