## WORK Tracking Revamp — accurate Z2 summary, no-flicker task list, RemoteTrigger coverage {#work-revamp}

**Purpose:** Make the Z2 `WORK` cell honestly reflect *all* live work as a single active-work count, stop the task list from momentarily dropping to zero across turn boundaries, extend coverage to claude.ai `RemoteTrigger` routines, and rename the popover's invented "Checklist" label to "Tasks".

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-07-10 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The `WORK` cell in the Z2 status row is the unified surface over every trackable unit of session work: the task checklist (`TaskCreate`/`TaskUpdate` calls), the background-jobs ledger (background `Bash`, async `Agent`, `Monitor`, scheduled `ScheduleWakeup`/`CronCreate` rows), and the `/goal`. The surface unifies but the storage stays split across three sources, and `WORK` is a pure projection over them (`select-work.ts`). Three defects motivate this phase:

1. **The Z2 summary does not reflect all work.** `workCellLabel` (`#work-cell-label-current`) is a single-category priority cascade — it shows the goal, *or* the jobs fraction, *or* the scheduled count, *or* the tasks fraction, *or* "None". When several categories are active at once, the cell shows only the top-priority one and hides the rest. A session with running jobs *and* a checklist reads as jobs-only.
2. **The task list flickers to zero and restores.** Observed in session `16f90a80` (screenshots: the cell reads "6/7", then "None" a moment later, mid-turn, then restores). Root cause is the turn-scoped visibility gate in `useTaskListState` (`#flicker-root-cause`): when a new turn opens with an empty `activeTurn.messages`, the gate returns the empty state until that turn streams its first `TaskCreate`/`TaskUpdate`, collapsing the whole checklist in the gap.
3. **The popup invents terminology and misses a source.** The popover labels the task group "Checklist" (`#popover-groups-current`) — the items are `Task*` tool calls, so the honest label is "Tasks". Separately, `RemoteTrigger` (claude.ai scheduled cloud routines) is render-only today (`RemoteTriggerToolBlock`) and never enters the jobs ledger, so scheduled cloud work is invisible to `WORK`.

#### Strategy {#strategy}

- Replace the single-category cascade with **one aggregate active-work count** ([P01]/[P02]) so the cell reflects every live category at once; keep `composeWorkSummary` as the accessible per-category breakdown and keep the popover as the full grouped ledger.
- Fix the flicker by **dropping the turn-scoped empty gate** ([P03]) in `useTaskListState`, so the last non-empty fold persists across the turn-open gap. The reducer's existing batch-boundary supersede (`#reducer-batch-boundary`) remains the only mechanism that clears a list.
- Rename the popover group label "Checklist" → "Tasks" ([P04]); leave the internal `WorkGroup` type value untouched (non-goal).
- Add `RemoteTrigger` coverage as a `"remote"` scheduled job row ([P05]) folded deck-side in the reducer — no tugcode/binary change needed, since `RemoteTrigger` rides the transcript as an ordinary `tool_use`/`tool_result` the reducer already sees. Guard the id-less local-wake reconciliation so a local wake never flips a remote row ([P06]).
- Ship as flat, independently-committable steps: aggregate count, flicker fix, rename, then the two-step RemoteTrigger model + wiring, closed by an integration checkpoint.

#### Success Criteria (Measurable) {#success-criteria}

- With a checklist (some tasks incomplete) **and** ≥1 running job **and** ≥1 scheduled row present at once, the Z2 `WORK` cell reads a single number equal to (incomplete tasks + running jobs + scheduled rows + active-goal), not any one category's fraction. (Unit test over `workActiveCount`; app-test asserting the rendered cell text.)
- Opening a new turn over a pre-existing, still-incomplete checklist never drops the `WORK` cell to "None" before the turn's first `Task*` frame. (Unit test on the hook fold; app-test driving a turn boundary and asserting the count never reads 0 between frames.)
- The popover's task group header reads "Tasks" (rendered uppercase "TASKS"), never "Checklist". (DOM/app-test assertion.)
- A `RemoteTrigger` `create` call produces one `"remote"` scheduled row in the ledger, visible in the popover's Scheduled group and counted by `WORK`; `list`/`get`/`run` produce no row. (Unit test on the fold; app-test over a synthesized `RemoteTrigger` tool result.)
- `bunx vite build` succeeds; `bun test` (tugdeck) passes; `just app-test` passes.

#### Scope {#scope}

1. Aggregate active-work count for the Z2 `WORK` cell (`select-work.ts`, renderer wiring).
2. Turn-boundary flicker fix (`useTaskListState`).
3. Popover label rename Checklist → Tasks (`dev-card-telemetry-popovers.tsx`).
4. `RemoteTrigger` `create`/`update` coverage as a `"remote"` scheduled ledger row (data model + narrowing + reducer dispatch).

#### Non-goals (Explicitly out of scope) {#non-goals}

- Renaming the internal `WorkGroup` union value `"checklist"` (and `selectWorkItems`' internal group key) — display-label-only change this phase.
- Redesigning `workCellPose` (the indicator running/completed/stopped/aborted grammar) — it stays; only the label changes.
- tugcode-side changes: the pulse narration (`voice.ts`), `pendingScheduledTriggers` (`session.ts`), or any inbound-message allowlist. The `WORK` fold is entirely deck-side, so no binary rebuild is needed.
- Agent-team teammates (`SendMessage` / named background agents) as work rows — deferred (user chose RemoteTrigger only).
- `PushNotification`, `CronList`, `TaskList`/`TaskGet`/`TaskOutput`, and `RemoteTrigger` `list`/`get`/`run` as ledger rows — these are notifications or read-only queries, correctly excluded.

#### Dependencies / Prerequisites {#dependencies}

- None external. All touched files are in `tugdeck/` and edited under live HMR; no tugcast/tugutil/tugcode rebuild.

#### Constraints {#constraints}

- **Warnings are errors** across the workspace; `bunx tsc --noEmit` (`bun run check`) must stay clean.
- **Verify with `bunx vite build`** before declaring any tugdeck change done — the debug app loads the production rollup bundle, so a dev-only-passing import can hang the app at splash.
- Tuglaws: external state enters React through `useSyncExternalStore` only ([L02]); appearance changes go through CSS/DOM, never React state ([L06]). All state here is derived/store state; no new persistence.
- The Z2 status row is a fixed-width flex group — every cell reserves a stable width so the group never reflows; the `WORK` indicator's `phaseLabels.max` token drives that reservation.

#### Assumptions {#assumptions}

- `RemoteTrigger` rides the transcript as a normal `tool_use` with a landed `tool_result` (confirmed: `RemoteTriggerToolBlock` renders it from the transcript, dispatched as `remotetrigger`), so `handleToolResult`'s scheduled-work `else` branch (`#reducer-scheduled-dispatch`) sees it exactly like `CronCreate`.
- The `RemoteTrigger` input shape is `{ action, trigger_id?, body? }` with actions `list`/`get`/`create`/`update`/`run` (pinned by `narrowRemoteTriggerInput` and its tests). The `create`/`update` result is API JSON with an appended summary line carrying a server-parsed run time + routine URL; its exact field names for a trigger id / next run time are not pinned by a captured fixture (see [Q01]).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Anchors are explicit and kebab-case; steps cite decisions/specs/anchors, never line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] RemoteTrigger result id + next-run-time parsing (OPEN) {#q01-remote-result-parse}

**Question:** What are the exact field names in a `RemoteTrigger` `create`/`update` result JSON for (a) the trigger/routine id and (b) the next scheduled run time?

**Why it matters:** The id keys the ledger row (so a later `update` re-labels the same row); a parseable future run time would let a one-shot remote row carry a real `firesAtMs` (and thus be reaped when long-past). Guessing wrong only degrades gracefully — the row still appears keyed by `tool_use_id` — but a wrong `firesAtMs` could cause premature reaping.

**Options (if known):**
- Parse `id` / `trigger_id` from the top-level JSON; parse an ISO run-time from the appended summary line.
- Skip run-time parsing entirely — treat every remote row like a cron (`firesAtMs: null`, never time-reaped).

**Plan to resolve:** Defensive default now (below), tighten if a real fixture is captured. `parseRemoteTriggerCreateId` tries `JSON.parse(result)` and reads the first non-empty string among `id` / `trigger_id`, falling back to the call's `tool_use_id`. `firesAtMs` is left `null` this phase (remote rows read by `scheduleLabel`, like crons), so no time-reaping mis-fires.

**Resolution:** DECIDED for this phase (see [P05]) — id parsed defensively with `tool_use_id` fallback; `firesAtMs: null`. Run-time-driven countdown DEFERRED to a follow-on once a fixture exists.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Dropping the turn-gate lingers a completed checklist in the popover | low | med | Reducer batch-supersede keeps only the current batch; completed tasks contribute 0 to the active count | Popover shows stale batches across many turns |
| A local wake flips a remote row to completed | med | low | Exclude `kind === "remote"` from `flipEarliestElapsedScheduled` ([P06]) | A remote row disappears when a local wakeup fires |
| `phaseLabels.max` width change destabilizes the Z2 row | low | low | Reserve a 2-digit `max` token and verify the cell group width is unchanged in the app | Counts routinely exceed 2 digits |

**Risk R01: Completed checklist lingers after the gate is removed** {#r01-linger}

- **Risk:** Without the turn-scoped empty gate, an all-completed checklist stays visible in the popover's Tasks group until a fresh `TaskCreate` supersedes it (which may not happen again this session).
- **Mitigation:** The reducer already collapses history to the current batch (`#reducer-batch-boundary`), so at most one completed batch lingers; the aggregate count reads 0 active for it, so the cell does not falsely claim pending work.
- **Residual risk:** A finished session's last checklist remains struck-through in the popover — acceptable (struck-through completed rows are already the popover's normal presentation) and strictly better than the flicker.

**Risk R02: Remote row flipped by an unrelated local wake** {#r02-remote-flip}

- **Risk:** `flipEarliestElapsedScheduled` flips the earliest elapsed scheduled row on any id-less local wake; a remote row could be that row and get wrongly completed.
- **Mitigation:** [P06] excludes `kind === "remote"` from the flip candidate scan.
- **Residual risk:** Remote rows never auto-complete locally — they persist as scheduled until cleared. Accepted: their execution is external (claude.ai) and unobservable from the local session.

---

### Design Decisions {#design-decisions}

#### [P01] The Z2 WORK cell shows one aggregate active-work count (DECIDED) {#p01-aggregate-count}

**Decision:** Replace `workCellLabel`'s single-category priority cascade with a single integer — the count of all currently-active work items across every category — rendered as the cell's label (`"None"` when zero).

**Rationale:**
- The user chose "Total active count" as the representation: one honest number that reflects every live category, not a fraction that hides the others.
- A fraction (`done/total`) mixes semantics across categories (a finished job and a completed task are not the same unit); a count sidesteps that.
- The full picture stays reachable — `composeWorkSummary` remains the cell's `aria-label` and the popover carries the grouped, per-category detail.

**Implications:**
- `workCellLabel(taskCounts, jobCounts, goal)` returns `String(workActiveCount(...))` or `"None"`.
- The renderer's `phaseLabels.max` reservation changes from `"00/00"` to a 2-digit `"00"` (bare count, not a fraction). Verify the fixed-width cell group is unchanged.
- `workCellPose` is unchanged — the indicator's running/completed/aborted grammar still drives the dot; only the numeric label changes.

#### [P02] Active work = incomplete tasks + running jobs + scheduled rows + active goal (DECIDED) {#p02-active-definition}

**Decision:** `workActiveCount = (taskCounts.total − taskCounts.completed) + jobCounts.running + jobCounts.scheduled + (goalIsActive(goal) ? 1 : 0)`.

**Rationale:**
- "Active" means work still pending or in flight. Incomplete tasks (`pending` + `in_progress`) are pending work; `running` jobs execute now; `scheduled` rows are promised future work; an active goal is one live objective.
- Terminal jobs (`completed`/`failed`/`stopped`) are history, not active — excluded (they live in the popover's Finished group).
- Uses the existing `JobCounts` (`countJobs`, `#job-counts`) and `TaskCounts` (`countTasks`, `#task-counts`) fields verbatim — no new counting primitives.

**Implications:**
- New pure helper `workActiveCount` in `select-work.ts` alongside `workCellLabel`.
- `hasWork` (renderer, `#renderer-work-wiring`) already gates the empty state and is unaffected.

#### [P03] The task list persists across turn boundaries; the turn-scoped empty gate is removed (DECIDED) {#p03-drop-gate}

**Decision:** `useTaskListState` always folds the whole transcript's `Task*` calls and returns that state; it no longer returns `EMPTY_TASK_LIST_STATE` when the latest turn has not yet emitted a `Task*` event.

**Rationale:**
- The gate (`#flicker-root-cause`) is the sole cause of the zero-then-restore flicker: it blanks the list the instant a new `activeTurn` opens and only restores it when the turn streams its first `Task*` frame.
- The reducer already collapses accumulated history to the current batch via its batch-boundary supersede (`#reducer-batch-boundary`), so folding the full transcript yields the current checklist, not every historical batch. The gate was a redundant second clearing layer.
- Persisting the last fold is exactly the "don't vanish" behavior the user wants.

**Implications:**
- The `useMemo` body in `useTaskListState` drops the `if (latest === null || !hasTaskEvent(latest)) return EMPTY_TASK_LIST_STATE` branch and folds unconditionally.
- `hasTaskEvent` and `selectLatestTurnMessages` become unused by the hook. They are consumed only by the hook's own unit test (`#gate-helper-consumers`). Remove both exports and their tests, or keep them only if a remaining consumer exists (there is none). The module docstring's "turn-scoped visibility" section is rewritten to describe persistence.
- Behavior change accepted under [R01]: a completed checklist lingers in the popover until superseded.

#### [P04] The popover task group is labelled "Tasks" (DECIDED) {#p04-tasks-label}

**Decision:** Change the popover group label string from `"Checklist"` to `"Tasks"` at the `group("Checklist", taskRows, !hasTasks)` call (`#popover-groups-current`).

**Rationale:**
- The rows are `TaskCreate`/`TaskUpdate` items — "Tasks" is what they are. "Checklist" is invented terminology; the project rule is to name things as what they are.
- Minimal, self-contained, no ripple into the `WorkGroup` type (non-goal).

**Implications:**
- One string literal changes; CSS uppercases it to "TASKS" via `.tug-popup-list-group-label`. No other rename this phase.

#### [P05] RemoteTrigger create/update folds into the ledger as a "remote" scheduled row (DECIDED) {#p05-remote-row}

**Decision:** Add `"remote"` to `WorkKind` and `JobItem["kind"]`. In the reducer's scheduled-work `else` branch, a `remotetrigger` tool result with `action === "create"` inserts one scheduled `"remote"` row (keyed by parsed trigger id, fallback `tool_use_id`); `action === "update"` re-labels the matching row if present. `list`/`get`/`run` produce no row.

**Rationale:**
- `create` schedules future cloud work — genuine scheduled work the user wants surfaced.
- `run` fires an immediate external run with no local completion signal — not a trackable local row; `list`/`get` are read-only queries (consistent with excluding `CronList`).
- Modeled on the cron row (`scheduledRowFromCron`): `firesAtMs: null`, reads by `scheduleLabel` (the routine's schedule from `input.body`, or the trigger id).

**Implications:**
- New narrowing/row helpers in `select-scheduled-work.ts`: `parseRemoteTriggerCreateId`, `scheduledRowFromRemoteTrigger`.
- `jobGroup` (`#select-work-jobgroup`) already routes any `scheduled` status to the Scheduled group regardless of kind — no change. `jobActions` must return `[]` for a `"remote"` scheduled row (no local cancel action exists — `RemoteTrigger` has no `delete` action).
- Popover Scheduled group and the aggregate count pick up remote rows automatically (both are kind-agnostic over `status === "scheduled"`).

#### [P06] Remote rows are excluded from id-less local-wake reconciliation (DECIDED) {#p06-remote-no-flip}

**Decision:** `flipEarliestElapsedScheduled` skips rows with `kind === "remote"` when choosing the earliest elapsed scheduled row to flip on an id-less local wake.

**Rationale:**
- A fired local `ScheduleWakeup`/`CronCreate` wake carries no `task_id`; the current heuristic flips the earliest elapsed scheduled row. A remote row (external execution) must never be completed by a *local* wake — that would be a false completion.
- Remote rows have `firesAtMs: null`, so they can only be picked as the cron-fallback candidate; the guard removes them from that fallback too.

**Implications:**
- One `continue` guard in the `flipEarliestElapsedScheduled` scan. `reapElapsedScheduled` already ignores rows without a numeric `firesAtMs`, so remote rows are never time-reaped either (they persist as scheduled until Clear).

---

### Deep Dives (Optional) {#deep-dives}

#### Current WORK label cascade (the accuracy defect) {#work-cell-label-current}

`workCellLabel` in `select-work.ts` returns the first matching category and stops:

- goal active → `"goal"`
- `jobCounts.total > 0` → `finished/total`
- `jobCounts.scheduled > 0` → bare scheduled count
- `taskCounts.total > 0` → `completed/total`
- else → `"None"`

So a session with running jobs and a checklist reads jobs-only; the checklist is invisible in the cell. [P01]/[P02] replace this with `workActiveCount`. `composeWorkSummary` (the accessible breakdown: `"N running, N scheduled, C/T tasks, N finished"`) is retained as the `aria-label` and the popover footer summary.

#### The flicker root cause {#flicker-root-cause}

`useTaskListState`'s `useMemo` computes `latest = selectLatestTurnMessages(transcript, inflightMessages)` — the in-flight turn's messages when `activeTurn !== null`, else the last committed turn's. It then returns `EMPTY_TASK_LIST_STATE` unless `hasTaskEvent(latest)` is true. When `handleSend` opens a new turn, `activeTurn.messages` is `[]`, so `latest` is that empty array, `hasTaskEvent([])` is false, and the whole checklist collapses to empty — the "None" the user sees — until the turn streams its first `TaskCreate`/`TaskUpdate`, at which point the full transcript re-folds and the list restores. [P03] removes this gate.

#### The reducer batch-boundary rule (why full-transcript folding is safe) {#reducer-batch-boundary}

`reduceTaskListState` folds every `Task*` call in order but applies one cross-batch rule: a `TaskCreate` arriving over a **non-empty, fully-completed** list starts a fresh batch (`tasks = []`), so the assembled state is always the *current* batch, not the session's accumulated history. This is what makes unconditional full-transcript folding ([P03]) correct — history does not pile up.

#### RemoteTrigger current touchpoints {#remote-trigger-touchpoints}

`RemoteTrigger` is dispatched as `remotetrigger` → `RemoteTriggerToolBlock` (`dev-assistant-renderer-registrations.ts`), which narrows input via `narrowRemoteTriggerInput` (`{ action, trigger_id?, body? }`). It has no ledger fold today. The reducer's `handleToolResult` scheduled-work `else` branch (`#reducer-scheduled-dispatch`) is where `schedulewakeup`/`croncreate`/`crondelete` fold; `remotetrigger` is added there ([P05]).

---

### Specification {#specification}

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `workActiveCount` (Z2 cell label) | local-data (derived) | pure fn over `useSyncExternalStore` snapshot | [L02] |
| Task list persistence across turns | local-data (derived) | `useTaskListState` fold over snapshot; no new state | [L02] |
| Popover "Tasks" label | structure (static text) | JSX string + CSS uppercase | [L06] |
| `"remote"` scheduled job rows | structure (session ledger) | reducer fold into `snapshot.jobs`, read via `useJobsState`/`useSyncExternalStore` | [L02] |

#### Key symbols (current) {#current-symbols}

Each bold label below is an anchor cited by the execution steps.

- **`#select-work-jobgroup`** {#select-work-jobgroup} — `workCellLabel`, `composeWorkSummary`, `workCellPose`, `selectWorkItems`, `WorkKind`, `jobGroup`, `jobActions` in `select-work.ts`. `jobGroup` routes any `status === "scheduled"` row to the Scheduled group regardless of `kind`; `jobActions` returns `["stop"]` (running), `["cancel"]` (cron scheduled), `["stop-loop"]` (other scheduled), `[]` (terminal).
- **`#job-counts`** {#job-counts} — `countJobs` / `JobCounts` in `select-jobs.ts`. Fields: `total` (= `jobs.length − scheduled`, the fraction denominator), `running`, `watching`, `scheduled`, `completed`, `failed`, `stopped`, `finished` (= `completed + failed + stopped`). Also here: `JobItem`, `flipEarliestElapsedScheduled`, `reapElapsedScheduled`, `clearTerminalJobs`, `isTerminalJobStatus`.
- **`#task-counts`** {#task-counts} — `countTasks` / `TaskCounts` in `body-kinds/todo-list-block.tsx`. Fields: `total`, `pending`, `inProgress`, `completed`. Incomplete tasks = `total − completed`.
- **`#scheduled-work-symbols`** {#scheduled-work-symbols} — `narrowCronCreateInput`, `scheduledRowFromCron`, `parseCronCreateResultId`, `flipEarliestElapsedScheduled`, `reapElapsedScheduled`, `stopScheduledRow` in `select-scheduled-work.ts`.
- **`#task-list-hook`** {#task-list-hook} — `useTaskListState`, `hasTaskEvent`, `selectLatestTurnMessages`, `iterateAllTaskCalls` in `hooks/use-task-list-state.ts`; `reduceTaskListState`, `taskListIsActive`, `EMPTY_TASK_LIST_STATE` in `select-task-list.ts`.
- **`#renderer-work-wiring`** {#renderer-work-wiring} — the WORK block in `dev-card-telemetry-renderers.tsx`: `taskCounts = countTasks(...)`, `jobCounts = countJobs(...)`, `workLabelText = workCellLabel(...)`, `workIndicatorState = workCellPose(...)`, `workSummary = composeWorkSummary(...)`, and the `<TugStatusCell priority="work">` block whose `<TugProgressIndicator>` carries `label={workLabelText}`, `aria-label={workSummary}`, and `phaseLabels={{ none: "None", max: "00/00" }}`.
- **`#popover-groups-current`** {#popover-groups-current} — `WorkPopoverContent` in `dev-card-telemetry-popovers.tsx`; the `group("Goal"/"Running"/"Scheduled"/"Checklist"/"Finished", …)` calls and the footer `composeWorkSummary` + Clear button.
- **`#reducer-scheduled-dispatch`** {#reducer-scheduled-dispatch} — the scheduled-work `else` block in `handleToolResult` (`reducer.ts`): the `schedulewakeup` / `croncreate` / `crondelete` branches, guarded by `!isReplaying && mutated.status === "done"`, followed by `jobs = reapElapsedScheduled(jobs, now)`. The `remotetrigger` branch is added here ([P05]).
- **`#gate-helper-consumers`** {#gate-helper-consumers} — `hasTaskEvent` / `selectLatestTurnMessages` are consumed only by `hooks/__tests__/use-task-list-state.test.ts` (verified: no non-test importer), so removing them touches only the hook and that test.
- `narrowRemoteTriggerInput`, `RemoteTriggerInput` (`{ action, trigger_id?, body? }`) — `blocks/remote-trigger-tool-block.tsx` (see `#remote-trigger-touchpoints`).

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Pure fns: `workActiveCount`, hook fold, remote-row narrowing/fold, `flipEarliestElapsedScheduled` guard | Every step's core logic |
| **Integration (app-test)** | Real app driven via `just app-test`: cell text, popover labels, no-zero across a turn boundary, remote row appears | Per behavior-visible step + the integration checkpoint |
| **Build/Contract** | `bunx vite build` + `bun run check` clean | Every step |

#### What stays out of tests {#test-non-goals}

- No jsdom render tests or mock-store assertions — drive real code paths (pure fns directly; UI via the real app under `just app-test`). Banned patterns per project convention.
- tugcode/pulse narration — out of scope this phase (no tugcode change).

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. Every tugdeck step runs `bunx vite build` and `bun run check` before commit.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Aggregate active-work count in the Z2 cell | pending | — |
| #step-2 | Drop the turn-scoped gate (flicker fix) | pending | — |
| #step-3 | Rename popover group Checklist → Tasks | pending | — |
| #step-4 | RemoteTrigger data model + narrowing (pure) | pending | — |
| #step-5 | RemoteTrigger reducer fold + wake guard | pending | — |
| #step-6 | Integration checkpoint | pending | — |

---

#### Step 1: Aggregate active-work count in the Z2 cell {#step-1}

**Commit:** `tugdeck(work): Z2 WORK cell shows one aggregate active-work count`

**References:** [P01] aggregate count, [P02] active definition, (#work-cell-label-current, #renderer-work-wiring, #job-counts, #task-counts, #success-criteria)

**Artifacts:**
- `workActiveCount` helper + rewritten `workCellLabel` in `select-work.ts`.
- Updated `phaseLabels.max` in the `<TugStatusCell priority="work">` indicator (`dev-card-telemetry-renderers.tsx`).

**Tasks:**
- [ ] Add `export function workActiveCount(taskCounts, jobCounts, goal)` in `select-work.ts` returning `(taskCounts.total − taskCounts.completed) + jobCounts.running + jobCounts.scheduled + (goalIsActive(goal) ? 1 : 0)` ([P02]).
- [ ] Rewrite `workCellLabel` to `const n = workActiveCount(...); return n === 0 ? "None" : String(n)`. Keep the signature (`taskCounts, jobCounts, goal`) so the renderer call is unchanged.
- [ ] Update the module docstring on `workCellLabel` to describe the aggregate reading (remove the "live work first / cascade" prose).
- [ ] In `dev-card-telemetry-renderers.tsx`, change the WORK indicator `phaseLabels` from `{ none: "None", max: "00/00" }` to `{ none: "None", max: "00" }`. Leave `workSummary` (`composeWorkSummary`) as the `aria-label`.

**Tests:**
- [ ] Unit: `workActiveCount` over combinations — tasks-only, jobs-only, scheduled-only, goal-only, and all-together (asserts the sum, not any single category). Add to the existing `select-work` test file (create one if absent, mirroring sibling `select-*` tests).
- [ ] Unit: `workCellLabel` returns `"None"` at zero and the aggregate string otherwise.

**Checkpoint:**
- [ ] `bun test tugdeck/src/lib/code-session-store` (new/updated tests green)
- [ ] `bun run check` && `bunx vite build`
- [ ] `just app-test` — with a checklist + a running job present, the WORK cell reads the summed count; the cell group width is unchanged.

---

#### Step 2: Drop the turn-scoped gate (flicker fix) {#step-2}

**Depends on:** #step-1

**Commit:** `tugdeck(work): persist task list across turns; kill the zero-flicker`

**References:** [P03] drop gate, (#flicker-root-cause, #reducer-batch-boundary, #gate-helper-consumers)

**Artifacts:**
- Simplified `useTaskListState` fold; removed `hasTaskEvent` / `selectLatestTurnMessages` exports; rewritten module docstring.
- Updated `hooks/__tests__/use-task-list-state.test.ts`.

**Tasks:**
- [ ] In `useTaskListState`, replace the `useMemo` body with an unconditional fold: `return reduceTaskListState(iterateAllTaskCalls(snapshot.transcript, inflightMessages ?? []))` ([P03]).
- [ ] Remove `hasTaskEvent` and `selectLatestTurnMessages` (unused after the change; only the test consumes them, `#gate-helper-consumers`). Keep `iterateAllTaskCalls`.
- [ ] Rewrite the module docstring's "turn-scoped visibility" section to state the new contract: the list is the current batch (per the reducer's batch-boundary supersede) and persists across the turn-open gap; it clears only when a fresh `TaskCreate` supersedes a fully-completed batch.
- [ ] Update `use-task-list-state.test.ts`: drop the `hasTaskEvent` / `selectLatestTurnMessages` describe blocks; add a test that folds a transcript with a committed incomplete checklist plus an **empty** in-flight turn and asserts the tasks are still present (no collapse to empty).

**Tests:**
- [ ] Unit: incomplete committed checklist + empty active turn → fold returns the checklist (non-empty), not `EMPTY_TASK_LIST_STATE`.
- [ ] Unit: a `TaskCreate` over a fully-completed batch still starts a fresh batch (regression guard on `#reducer-batch-boundary` — should be unchanged).

**Checkpoint:**
- [ ] `bun test tugdeck/src/lib/code-session-store/hooks` green
- [ ] `bun run check` && `bunx vite build`
- [ ] `just app-test` — drive a checklist, then open a new turn whose first streamed block is non-`Task*`; assert the WORK cell count never reads `None`/`0` in the gap before the turn's first `Task*` frame.

---

#### Step 3: Rename popover group Checklist → Tasks {#step-3}

**Depends on:** #step-1

**Commit:** `tugdeck(work): label the popover task group "Tasks", not "Checklist"`

**References:** [P04] Tasks label, (#popover-groups-current)

**Artifacts:**
- One string change in `WorkPopoverContent` (`dev-card-telemetry-popovers.tsx`).

**Tasks:**
- [ ] Change `group("Checklist", taskRows, !hasTasks)` to `group("Tasks", taskRows, !hasTasks)`.
- [ ] Scan the file for any other user-visible "Checklist" string in this popover; there is none expected (the `WorkGroup` type value `"checklist"` is internal, non-goal).

**Tests:**
- [ ] App-test/DOM assertion that the rendered group header reads "TASKS" (uppercased) when tasks are present, and "Checklist" appears nowhere in the popover.

**Checkpoint:**
- [ ] `bun run check` && `bunx vite build`
- [ ] `just app-test` — open the WORK popover with tasks present; the section header reads "TASKS".

---

#### Step 4: RemoteTrigger data model + narrowing (pure) {#step-4}

**Depends on:** #step-1

**Commit:** `tugdeck(work): model RemoteTrigger routines as "remote" scheduled rows`

**References:** [P05] remote row, [P06] no local flip, [Q01] result parsing, (#remote-trigger-touchpoints, #select-work-jobgroup)

**Artifacts:**
- `"remote"` added to `WorkKind` (`select-work.ts`) and `JobItem["kind"]` (`select-jobs.ts`).
- `parseRemoteTriggerCreateId` + `scheduledRowFromRemoteTrigger` in `select-scheduled-work.ts`.
- `jobActions` returns `[]` for a remote scheduled row; `flipEarliestElapsedScheduled` skips remote rows.

**Tasks:**
- [ ] Add `"remote"` to the `WorkKind` union (`select-work.ts`) and to `JobItem["kind"]` (`select-jobs.ts`). Fix any exhaustiveness switches the compiler flags.
- [ ] In `select-work.ts` `jobActions`, ensure a `scheduled` row of `kind === "remote"` returns `[]` (no local cancel). Keep cron → `["cancel"]`, other scheduled → `["stop-loop"]`.
- [ ] In `select-scheduled-work.ts`, add `parseRemoteTriggerCreateId(result)`: `JSON.parse` the result string (guard non-string/parse-throw), return the first non-empty string among `id` / `trigger_id`, else `undefined` ([Q01]).
- [ ] Add `scheduledRowFromRemoteTrigger(toolUseId, input, result, nowMs)` building a `JobItem` with `kind: "remote"`, `status: "scheduled"`, `jobId: parseRemoteTriggerCreateId(result) ?? toolUseId`, `firesAtMs: null`, `scheduleLabel` from `input.body` (a `schedule`/`cron`/`when` string if present, else the trigger id), `description` from `input.body`'s prompt/name or the routine id. Import `RemoteTriggerInput`/`narrowRemoteTriggerInput` from the block module, or add a local narrow to keep `select-scheduled-work.ts` free of a component import (prefer a local `narrowRemoteTriggerToolInput` mirroring the block's shape to avoid a lib→component dependency).
- [ ] In `flipEarliestElapsedScheduled` (`select-scheduled-work.ts`), add `if (j.kind === "remote") continue;` in the candidate scan ([P06]).

**Tests:**
- [ ] Unit: `parseRemoteTriggerCreateId` — parses `id`/`trigger_id`, returns `undefined` on non-JSON / missing.
- [ ] Unit: `scheduledRowFromRemoteTrigger` — keyed by parsed id, `firesAtMs: null`, `scheduleLabel` from body, `kind: "remote"`, `status: "scheduled"`.
- [ ] Unit: `flipEarliestElapsedScheduled` does not flip a `"remote"` row even when it is the only/earliest scheduled row.
- [ ] Unit: `jobActions` returns `[]` for a remote scheduled row.

**Checkpoint:**
- [ ] `bun test tugdeck/src/lib/code-session-store` green
- [ ] `bun run check` && `bunx vite build`

---

#### Step 5: RemoteTrigger reducer fold + integration into the ledger {#step-5}

**Depends on:** #step-4

**Commit:** `tugdeck(work): fold RemoteTrigger create/update into the jobs ledger`

**References:** [P05] remote row, [Q01] result parsing, (#reducer-scheduled-dispatch, #remote-trigger-touchpoints)

**Artifacts:**
- A `remotetrigger` branch in `handleToolResult`'s scheduled-work `else` block (`reducer.ts`).

**Tasks:**
- [ ] In the `else` block after `crondelete` (`#reducer-scheduled-dispatch`), add `else if (toolName === "remotetrigger")`: narrow the input, read `action`; on `"create"` insert `scheduledRowFromRemoteTrigger(mutated.toolUseId, input, mutated.result, now)` via `insertJob`; on `"update"` re-label the matching row by parsed id if present (fallback: no-op); `"run"`/`"list"`/`"get"` → no row ([P05]).
- [ ] Confirm `insertJob` idempotency keys on `jobId` so a re-folded transcript (resume/replay) does not duplicate the row.
- [ ] Verify no `task_started`/`task_updated` frame path exists for `remotetrigger` (there is none — it is tool-call-only, like cron), so the tool-result fold is the sole insert path.

**Tests:**
- [ ] Unit (reducer-level, mirroring the existing scheduled-work reducer tests): a `remotetrigger` `create` tool result inserts one `"remote"` scheduled row; `list`/`get`/`run` insert none; a second identical `create` fold does not duplicate.

**Checkpoint:**
- [ ] `bun test tugdeck/src/lib/code-session-store` green
- [ ] `bun run check` && `bunx vite build`

---

#### Step 6: Integration checkpoint {#step-6}

**Depends on:** #step-2, #step-3, #step-5

**Commit:** `N/A (verification only)`

**References:** [P01], [P02], [P03], [P04], [P05], [P06], (#success-criteria)

**Tasks:**
- [ ] Verify all steps compose: aggregate count includes remote scheduled rows; the popover shows a "Scheduled" group entry for a remote routine and a "TASKS" group for the checklist; the checklist does not flicker across a turn.

**Tests:**
- [ ] App-test end-to-end (`just app-test`): synthesize a session with an incomplete checklist, a running background job, and a `RemoteTrigger` `create` result; assert (a) the WORK cell reads the summed active count, (b) the popover has "Running", "Scheduled" (with the remote row), and "TASKS" groups, (c) opening a new turn does not drop the count to `None`.

**Checkpoint:**
- [ ] `bun run check` && `bunx vite build`
- [ ] `just app-test` full sweep green

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The Z2 `WORK` cell reports one honest aggregate active-work count across tasks, jobs, scheduled rows (including claude.ai `RemoteTrigger` routines), and goal; the task list no longer flickers to zero across turns; and the popover names its task group "Tasks".

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `workActiveCount` sums every active category; `workCellLabel` renders it (or "None"). (Unit + app-test)
- [ ] No zero-flicker on a turn boundary over an incomplete checklist. (Unit + app-test)
- [ ] Popover task group reads "TASKS". (App-test/DOM)
- [ ] `RemoteTrigger` `create` → one `"remote"` scheduled row in the popover + count; `run`/`list`/`get` → none; no local wake flips it. (Unit + app-test)
- [ ] `bun run check`, `bunx vite build`, `just app-test` all green.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Parse a real next-run-time from `RemoteTrigger` results to give remote rows a live countdown ([Q01]).
- [ ] Agent-team teammates (`SendMessage` / named agents) as running work rows.
- [ ] tugcode-side pulse narration for remote routines.
- [ ] Rename the internal `WorkGroup` `"checklist"` value to `"tasks"` for vocabulary consistency.

| Checkpoint | Verification |
|------------|--------------|
| Aggregate count | `bun test` on `workActiveCount` + app-test cell text |
| No flicker | `bun test` hook fold + app-test turn boundary |
| Tasks label | app-test popover header |
| RemoteTrigger row | `bun test` fold + app-test popover Scheduled group |
| Build/typecheck | `bun run check` && `bunx vite build` && `just app-test` |
