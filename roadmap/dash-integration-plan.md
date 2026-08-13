# Dash Integration — program plan {#dash-integration-plan}

**Purpose:** Make dashes a first-class concept in Tug's UI — a session card can bind to a dash, the Changes/Commit surface shows dash progress and lands joins, the Lens shows inflight dashes, and the workflow the skills currently improvise in prose is codified into `tugutil dash` verbs — so the dash lane reaches parity with the main-lane Changes/Commit flow.

This is a **program plan**: five phases, each of which gets its own devise-skeleton recipe (`/tugplug:devise`) before implementation. This document fixes the decisions, the state model, the phase boundaries, and the contracts between phases; it deliberately does not enumerate per-file tasks.

---

## Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main (phases run as dashes) |
| Brief | [dash-integration-brief.md](dash-integration-brief.md) |
| Last updated | 2026-08-13 |

---

## Ratified Decisions {#ratified-decisions}

These were decided in conversation on 2026-08-13 and are not open for relitigating inside phase recipes.

### [P01] Binding is an overlay, not a relocation {#p01-overlay}

A session card binds **secondarily** to a dash while staying spawned in the base checkout. The binding redirects *surfaces*, not the process: the Changes lane fronts the dash's range and worktree dirt, diffs and pop-outs read range descriptors, card chrome wears a dash chip, and bare `/join` operates on the bound dash. The shell route, claude's cwd, and the primary `workspace_key` binding are untouched. Rationale: `join_in` refuses from inside the worktree and off the base branch — the card must never be put somewhere it cannot land from; and this matches how the skills already work (in-thread from base, worktree addressed by absolute path). Relocation ("this card's shell lives in the worktree") remains severable future work on the dash-instance machinery, not a mutation of this binding.

### [P02] Many cards, one dash; a dash outlives its sessions {#p02-cardinality}

The binding is many-to-one: several session cards may bind to the same dash; a dash with zero bound sessions is **parked**, not broken. Binding state lives with the session (sessions ledger), never with the dash — the dash remains pure git plus its state-dir artifacts.

### [P03] Dashes get a creation identity; drafts and bindings key by it {#p03-dash-id}

`tugutil dash create` mints a **dash id** (creation timestamp + nonce) stored in git config beside `tugbase`. Drafts (`owner_kind='dash'`) and session bindings key by the dash id, not the reusable name. This retires the draft-haunting class of bug (a reused name inheriting a dead dash's clobber-protected join draft) as mechanism instead of the `draft clear` prose rule the join skill carries today. The name stays the human handle everywhere in UI and CLI arguments; the id is resolution plumbing.

### [P04] `tugutil dash step` edits the plan's Step Status Ledger {#p04-step-verbs}

The markdown ledger table in the plan document stays the single durable record of step state. `tugutil dash step start <n>` / `dash step done <n> --commit <sha>` edit that table **and** append structured dash-log lines, so ledger, log, and rounds cannot drift — "task, ledger, and commit move together" becomes a verb, not a rule the model must remember. The triple bookkeeping (markdown table + Task items + rounds) collapses to one gesture per transition.

### [P05] Naming: `dash-*` skills, `dash-run`, `/dash` gesture {#p05-naming}

Dash-lane-only skills take the prefix: `implement`→`dash-implement`, `dash`→`dash-run`, `join`→`dash-join`, `audit`→`dash-audit`, with the old names kept as aliases for one release. `devise` and `vet` stay unprefixed — they are plan skills, lane-agnostic. `/dash <name>` becomes a card gesture: create (if needed) + bind *this card* to the dash. `/join` remains the landing gesture.

### [P06] Derive, don't record {#p06-derive}

A dash is git. Lifecycle stage is **derived** wherever git can answer (branch existence, rounds, journal phase, draft row, worktree dirt) and **declared** only for transitions git cannot see (step start, built, audited), recorded as structured dash-log lines by the verbs that cause them. No dash database is introduced by any phase.

---

## The dash lifecycle state model {#state-model}

This is the shared vocabulary for `dash status`, the feed, the Lens section, and the join-mode presentation. States marked ⊕ are derived; ⊙ are declared via dash-log lines.

**Shaping** (no worktree yet): idea → brief → devised ⊕(plan file exists) → vetted ⊙.

**Working:** created ⊕(branch + worktree) → implementing ⊙(step *i* of *N*; rounds accrete ⊕) → built ⊙(`just app-debug` reported) → audited ⊙ → draft-ready ⊕(non-empty `dash:<id>` draft).

**Landing** — the join preflight fans into the four outcomes `join_in` already distinguishes, each with its own presentation:

| Outcome | Meaning | Surface |
|---|---|---|
| clean | preview merges without conflict | "sign here" — message + land |
| conflicted | conflicted path list from `merge-tree` | resolve lane (existing ladder + overlay store), then candidate-awaiting-land |
| blocked | inside worktree / repo root off base branch / intersecting base dirt / stale journal | named blocker + the unblocking act |
| empty | no commits past base | release handoff ("nothing to join — release this dash?") |

Then: landing → **interrupted teardown** ⊕(join journal `Integrated`/`WorktreeRemoved`/`BranchDeleted`; resumed by `--continue` — a real state users hit, with its own presentation) → joined ⊕(branch gone, `Tug-Dash` trailer on main).

**Discard:** releasing → released ⊕ (worktree and branch gone, nothing merged).

**Orthogonal:** parked ⊕(zero bound sessions, rounds exist) — visible in the Lens, never auto-cleaned.

---

## Phases {#phases}

Each phase is independently shippable and ends with the standard bar: `cargo nextest run`, `bun test`, `bunx vite build`, `just app-test-changed` green.

### Phase 1 — Foundation (Rust/CLI; nothing visible) {#phase-1}

The identity and binding substrate everything else stands on.

1. **Dash id** ([P03]): minted at `create`, stored `branch.tugdash/<name>.tugid`; surfaced in `dash list/show` JSON; `tugdash-core` gains id resolution (name→id, id→name). Draft rows for dashes move to `owner_id = <dash-id>` with a compat read window for existing `tugdash/<name>` rows (the same tolerant-read-then-cut pattern used for the worktree home migration).
2. **Session↔dash binding** ([P01], [P02]): `dash_id` column on the sessions ledger `sessions` table (schema-versioned migration); CONTROL verbs `bind_dash` / `unbind_dash`; `tugutil dash bind|unbind` for the skill path; binding echoed through `spawn_session_ok` and `list_card_bindings` into `CardSessionBinding`; restored by the existing restore pass. `dash create` auto-binds when `TUG_SESSION_ID` is present; join and release clear **all** bindings for the dash id.
3. **`tugutil dash status <name> --json`**: the one machine-readable readout — id, stage (per the state model), base, rounds, dirt, plan path, step *i*/*N*, draft presence, join-journal phase, bound sessions.
4. **Extract `dash_entries`** out of `tugcast/src/feeds/changeset.rs` into tugdash-core (the flagged duplication with the CLI), and extend `DashChangesetEntry` additively: `id`, `stage`, `step_current`/`step_total`, `bound_sessions`. The CHANGESET_ALL feed carries it to every deck for free.

**Contract to later phases:** `CardSessionBinding.dash` (id + name), `DashChangesetEntry` with stage/progress, `dash status` JSON shape.

### Phase 2 — Visibility (read-only UI) {#phase-2}

Dashes become visible everywhere they should be, with zero landing-path stakes.

1. **Changes dash lane**: `SessionChangesView` renders `snapshot.dashes` in dash grammar (name · base · rounds · dirty — never session-file grammar; the perky-frog rule), with range diffs via the already-built `{kind: "range"}` descriptor and the maintained join draft shown read-only. A dash-bound card fronts its dash's lane; unbound cards fold dashes under the project.
2. **Card chrome chip**: the bound dash's name in the Session card chrome; the visible answer to "where am I working?"
3. **Lens "Dashes" section**: new registered section (registry entry + `main.tsx` + `setSectionContent`/`collapsedSummary`), one row per inflight dash: name, stage, step *i*/*N*, mated session(s) with the `focus-session-card` jump, and a live in-progress indicator as a leaf subscription (the `SessionPhaseDot` pattern — never a high-churn field in the row projection). Parked dashes render with their own mark.
4. **`/dash <name>` gesture** ([P05]): local slash verb — resolve name; existing dash → bind this card; new name → `dash create` (which auto-binds). Bare `/dash` with dashes inflight opens the lane/section for discovery.

### Phase 3 — Lifecycle codification (CLI + skills) {#phase-3}

The improvised workflow becomes verbs; the skills shrink to policy.

1. **Step verbs** ([P04]): `dash step start|done` editing the plan ledger table + structured dash-log lines; `status`/feed derive `implementing (i/N)` from them.
2. **Stage declarations** ([P06]): `built` and `audited` markers recorded by the verbs/skills that reach them.
3. **Draft symmetry**: the plain-dash lane maintains the join draft the same way `implement` phase 3 does (via `dash-run` skill text or a `dash draft` convenience), retiring `dash-join`'s compose-fallback branch.
4. **Skill renames + rewrites** ([P05]): `dash-implement`, `dash-run`, `dash-join`, `dash-audit` with one-release aliases; rewrite onto the new verbs (bind, status, step); factor the ~70% duplicated doctrine text between `dash-run` and `dash-implement` into one shared reference both cite; update `tugplug/CLAUDE.md`, repo `CLAUDE.md` git-policy exceptions, and the memory-relevant naming.

### Phase 4 — Join mode (the landing surface) {#phase-4}

The twin of commit mode, over server machinery that already exists. No new Rust beyond receipts.

1. **Deck senders**: `changeset_join` / `changeset_release` join `changeset-verb-store` (the missing half the brief names).
2. **`join-mode-controller`** mirroring `commit-mode-controller`: `/join` (bare = bound dash; `/join <name>` = explicit) enters the mode; composer becomes the join-message editor seeded from the dash draft; Z5 swaps to cancel / auto-message / join; `evaluateJoinLandGate` as the exported pure gate (idle, no pending landing, preview clean-or-resolved, non-empty message), enforced at dispatch and affordance per the [P08] doctrine of the consolidation plan.
3. **Four-outcome presentation** per the state model: clean → land; conflicted → the resolve lane wired to the existing `changeset-join-store` overlay, then candidate-land; blocked → named blocker; empty → release handoff. Interrupted teardown gets a "resume teardown" affordance over `--continue`.
4. **Receipts**: join and release receipts as server-formatted shell-ledger ink (the commit-receipt [P07] pattern from the inline-dialog plan — one Rust formatter, durable, restored on reload); History badges keep reading the `Tug-Dash` trailer.
5. **Release's new home**: the dash lane row, shade/lane-only with the discard preflight (`discards k rounds · n dirty files`), honoring the consolidation plan's [P14] ruling.
6. **Land side-effects**: server clears the dash draft and all bindings for the id; the card exits join mode with the receipt in the transcript. The `tugplug:dash-join` skill survives unchanged as the headless/agentic path over the same verbs.

### Phase 5 — Polish + doctrine {#phase-5}

1. Multi-dash discovery and switching refinements (`/dash` picker when several exist; Lens ordering).
2. Parked-dash affordances: adopt (bind), release, or leave.
3. **`tuglaws/dash-lifecycle.md`**: the state model, the binding concept, the derive-vs-declare rule, and the landing doctrine — plus updates to `tracking-changes.md` (including its stale two-beat `/commit` description) and `design-decisions.md`.
4. Drop the one-release aliases (skill names, draft-row compat reads) once shipped bundles have turned over.

---

## Risks {#risks}

| Risk | Impact | Mitigation |
|---|---|---|
| Draft-key migration (name→id) strands an inflight draft | med | compat read window; migration copies live `tugdash/<name>` rows to id keys on first resolution |
| Sessions-table migration collides with restore pass | med | additive column, schema-versioned; restore tolerates NULL dash_id |
| Ledger-table editing by `dash step` mangles a hand-edited plan | med | strict parse of the skeleton's ledger grammar; refuse (exit 1) rather than fuzzy-match; the skill falls back to hand-editing on refusal |
| Dash lane re-destabilizes the shipped Changes surface | med | phase 2 is view-layer only over unchanged stores; dash grammar kept visually distinct; app-test coverage per surface |
| Join mode diverges from commit mode conventions | low | mirror `commit-mode-controller` structurally; shared gate-evaluation shape; name the tuglaws in each dash commit |

---

## Sequencing note {#sequencing}

Phases 2 and 3 are independent of each other (both depend only on phase 1) and could run as parallel dashes. Phase 4 depends on 1 and benefits from 2's lane rendering. Visibility-first is deliberate: it de-risks the binding concept with zero landing-path stakes before the landing surface is built on it.
