## Phase 1.0: Robust Checklist Reconciliation {#phase-checklist-reconciliation}

**Purpose:** Harden the implement skill's checklist reconciliation so that reviewer-approved steps always reach "completed" state without fragile ordinal counting or unrecoverable halts.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-24 | <!-- revision 4 -->

---

### Phase Overview {#phase-overview}

#### Context {#context}

During the plan-quality-split implementation run, three related issues surfaced in the implement skill's checklist reconciliation. First, the orchestrator manually constructs batch JSON by combining coder-reported ordinals with reviewer-reported checkpoint verdicts; the coder may under-report items, leaving silent "open" items that cause `state complete` to fail. Second, when `tugcode commit` returns `state_update_failed: true`, the implement skill halts with no recovery path, even though the git commit already succeeded and the reviewer confirmed all work was done. Third, the coder-agent produces multi-line Bash commands that trigger Claude Code's newline confirmation prompt, breaking unattended operation.

These three issues share a root cause: the orchestration layer trusts agents to count checklist items accurately and offers no fallback when counting fails. The CLI's strict validation (requiring all items completed before `state complete`) is correct; the problem is that the orchestrator's method of getting items into the "completed" state is fragile, and there is no recovery when it breaks.

#### Strategy {#strategy}

- Add a `--complete-remaining` flag to `tugcode state update --batch` that marks all non-specified items as completed, enabling the orchestrator to send only deferred items and let the CLI handle the rest.
- Remove the empty-array guard in the Rust batch path so `--complete-remaining` with an empty array (meaning "complete everything") is valid.
- Replace the hard halt on `state_update_failed` with a recovery loop that queries open items and auto-completes if the reviewer already approved.
- Simplify orchestrator batch construction to only send deferred items plus `--complete-remaining`, eliminating manual ordinal counting.
- Add tool preference guidance to `coder-agent.md` to prevent multi-line Bash commands.
- Retain `checklist_status` in the coder-agent output contract as-is (still REQUIRED with ordinals) but change the orchestrator to use it only for progress messages, not for state updates.

#### Stakeholders / Primary Customers {#stakeholders}

1. Implement skill orchestrator (primary consumer of batch update and state complete commands)
2. Coder-agent (affected by tool preference guidance)
3. Committer-agent (source of `state_update_failed` signals)

#### Success Criteria (Measurable) {#success-criteria}

- `echo '[]' | tugcode state update <plan> <step> --worktree <path> --batch --complete-remaining` succeeds and marks all open items as completed (verified by integration test)
- `echo '[{"kind":"task","ordinal":5,"status":"deferred","reason":"manual"}]' | tugcode state update <plan> <step> --worktree <path> --batch --complete-remaining` marks item 5 as deferred and all other open items as completed (verified by integration test)
- The implement skill SKILL.md contains a recovery loop for `state_update_failed` that queries, auto-completes, and escalates after 3 attempts
- The implement skill SKILL.md no longer constructs itemized batch JSON from coder/reviewer ordinals; it sends only deferred items + `--complete-remaining`
- `coder-agent.md` contains tool preference guidance preferring Grep/Read/Glob over Bash equivalents and requiring single-line Bash commands

#### Scope {#scope}

1. `tugcode state update --batch --complete-remaining` flag (Rust CLI)
2. Empty-array guard removal when `--complete-remaining` is present (Rust CLI)
3. Structured `state_failure_reason` field in `CommitData` (Rust CLI, `output.rs` and `commit.rs`)
4. Recovery loop for `state_update_failed` in implement skill (SKILL.md)
5. Simplified batch construction in implement skill (SKILL.md)
6. Tool preference guidance in coder-agent (coder-agent.md)
7. Orchestrator change: `checklist_status` used for progress messages only (SKILL.md)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the coder-agent output contract (checklist_status remains REQUIRED with ordinals)
- Changing the reviewer-agent output contract
- Adding a new top-level `tugcode state complete-all` subcommand (using flag on existing `update --batch` instead)
- Modifying `tugcode state complete --force` behavior
- Changing how `tugcode commit` internally calls `state complete` (we add a classification field to the output, not new logic)

#### Dependencies / Prerequisites {#dependencies}

- Existing `tugcode state update --batch` command (implemented in accurate-state-tracking plan)
- Existing `tugcode state show --json` command (needed for recovery loop queries; JSON output always includes `checklist_items` regardless of `--checklist` flag)
- Existing `tugcode state complete` command (called after recovery loop marks all items completed)

#### Constraints {#constraints}

- The implement skill's Bash hook restricts commands to `tugcode` CLI only; all recovery-loop commands must use `tugcode state` subcommands.
- `permissionMode: dontAsk` does not suppress Claude Code's built-in newline validation, so single-line Bash is mandatory for unattended operation.
- Warnings are errors in the Rust codebase (`-D warnings` in `.cargo/config.toml`).

#### Assumptions {#assumptions}

- The new `tugcode state update --batch --complete-remaining` is the primary recovery mechanism for the automated recovery loop; `tugcode state complete --force` exists as a last-resort manual recovery option but is not used in the automated path because it overwrites deferred items.
- Changes to `coder-agent.md` (tool preference guidance, single-line Bash rule) are straightforward documentation additions with no contract implications.
- The implement skill's Bash hook is compatible with all proposed recovery-loop commands (`tugcode state show`, `tugcode state update --batch --complete-remaining`, `tugcode state complete`).
- Plan steps will be implemented sequentially.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| `--complete-remaining` masks genuine incomplete work | high | low | Only used after reviewer APPROVE; deferred items are explicitly sent in the batch | Post-implementation audit finds items incorrectly auto-completed |
| Recovery loop retries on non-recoverable failure | med | low | Switch on structured `state_failure_reason` enum; immediately escalate for `drift`, `ownership`, `db_error` | Non-recoverable failures observed wasting retry attempts |
| Recovery loop infinite retries | med | low | Hard cap at 3 attempts before escalation | Recovery loop runs more than 3 times in any single step |
| Coder-agent ignores tool preference guidance | low | med | Guidance is prominent in agent prompt; Claude Code's built-in preferences reinforce it | Multi-line Bash prompts reappear in implementation runs |

**Risk R01: Auto-completion masks incomplete work** {#r01-auto-complete-masks}

- **Risk:** `--complete-remaining` could mark items as completed that were genuinely not done.
- **Mitigation:** The flag is only used after the reviewer has issued an APPROVE verdict. Deferred items (non-PASS from reviewer) are explicitly sent in the batch before `--complete-remaining` takes effect on the rest.
- **Residual risk:** If the reviewer incorrectly approves, items will be marked complete. This is an existing risk with the current flow (reviewer approval already gates completion).

**Risk R02: Recovery loop cannot resolve state mismatch** {#r02-recovery-unresolvable}

- **Risk:** The recovery loop queries open items but cannot determine the correct action (e.g., items that should have been deferred but were not reported by the reviewer, or the failure is caused by plan drift rather than incomplete items).
- **Mitigation:** The recovery loop reads the structured `state_failure_reason` field (per [D07]) and immediately escalates for non-recoverable reasons (`drift`, `ownership`, `db_error`), avoiding wasted retries on unresolvable conditions. Only `open_items` failures enter the retry loop. For `open_items` failures, after 3 failed attempts, escalate to user with AskUserQuestion showing the specific open items and recommending `tugcode state update --batch --complete-remaining` as the manual recovery path. Avoid recommending `state reconcile` (which erases deferred state) or `state complete --force` (which overwrites deferred items) in automated escalation messages.
- **Residual risk:** User intervention is required for non-recoverable failure reasons and for `open_items` failures after 3 retries, but this is strictly better than the current hard halt with no recovery path.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Add --complete-remaining flag to existing state update --batch (DECIDED) {#d01-complete-remaining-flag}

**Decision:** Add a `--complete-remaining` boolean flag to the existing `tugcode state update --batch` command rather than creating a new `state complete-all` subcommand.

**Rationale:**
- Reuses the existing batch infrastructure (ownership checks, drift detection, transaction handling)
- Allows combining explicit deferred-item entries with auto-completion of everything else in a single atomic operation
- Avoids adding a new subcommand to the CLI surface area

**Implications:**
- The `--complete-remaining` flag must be gated behind `--batch` (only valid in batch mode)
- When `--complete-remaining` is present and the batch array is empty, all open items are marked completed
- The empty-array guard (`entries.is_empty()` error) must be removed when `--complete-remaining` is active
- The `--complete-remaining` SQL targets only items with `status = 'open'`, deliberately preserving items already set to `deferred` by explicit batch entries. This is a key advantage over `state complete --force`, which overwrites all non-completed items including deferred ones.

#### [D02] Remove empty-array guard when --complete-remaining is present (DECIDED) {#d02-remove-empty-guard}

**Decision:** The current guard `if entries.is_empty() { return Err(...) }` in both `state.rs` (CLI layer) and `state.rs` (tugtool-core layer) will be conditioned on `--complete-remaining` being absent. When `--complete-remaining` is true, empty arrays are valid input meaning "complete all remaining open items."

**Rationale:**
- Empty arrays with `--complete-remaining` are the primary use case (reviewer approved, no deferred items)
- Without this change, the orchestrator would need to send at least one dummy entry to satisfy the guard

**Implications:**
- Two code locations need updating: `tugcode/crates/tugcode/src/commands/state.rs` (line ~655) and `tugcode/crates/tugtool-core/src/state.rs` (line ~857)
- The `batch_update_checklist` function signature (or a wrapper) needs a `complete_remaining` parameter
- When `complete_remaining` is true and entries is empty, the function must still execute the "complete remaining" SQL update

#### [D03] Recovery loop mirrors reviewer REVISE retry pattern (DECIDED) {#d03-recovery-loop-pattern}

**Decision:** Replace the hard halt on `state_update_failed` with a recovery loop that: (0) reads the structured `state_failure_reason` field from the committer JSON output and immediately escalates for non-recoverable reasons (`drift`, `ownership`, `db_error`), (1) for `open_items` failures, queries `tugcode state show {plan_path} --json` and filters client-side by step_anchor to find open items, (2) auto-completes if the reviewer already approved (using `--complete-remaining`), (3) escalates to user after 3 failed attempts.

**Rationale:**
- The git commit already succeeded when `state_update_failed` fires; halting loses the commit context
- The reviewer confirmed all work was done; the failure is in state tracking, not implementation
- The reviewer REVISE loop already proves the retry-with-escalation pattern works in the implement skill
- `state_update_failed` can be caused by plan drift, ownership errors, or db errors (not just incomplete items), so the recovery loop must classify the failure reason and only retry for recoverable conditions

**Implications:**
- The implement skill SKILL.md section 3f (committer post-call handling) must be rewritten to add the recovery loop
- The failure message block must be updated to describe the new recovery flow instead of the hard halt
- Recovery uses `tugcode state update --batch --complete-remaining` as the primary mechanism
- The recovery loop switches on the structured `state_failure_reason` field (per [D07]) rather than string-matching against warnings

#### [D04] Orchestrator sends only deferred items plus --complete-remaining (DECIDED) {#d04-simplified-batch}

**Decision:** The orchestrator no longer constructs an itemized batch from coder `checklist_status` and reviewer `plan_conformance.checkpoints[]`. Instead, it sends only items with non-PASS verdicts (deferred) and uses `--complete-remaining` to mark everything else completed.

**Rationale:**
- Eliminates the fragile ordinal-counting that caused the original failure (coder reported 19 of 20 tasks)
- Removes agents from the critical path of state tracking entirely
- The CLI is the single source of truth for checklist item counts (parsed from plan markdown at `state init` time)

**Implications:**
- The "After APPROVE" section in SKILL.md must be rewritten
- The coder's `checklist_status` is still required in the output contract but used only for progress messages
- The reviewer's `plan_conformance.checkpoints[]` deferred entries are the only items sent in the batch

#### [D05] Coder checklist_status retained for progress messages only (DECIDED) {#d05-checklist-progress-only}

**Decision:** The coder-agent output contract retains `checklist_status` as REQUIRED with ordinals, but the orchestrator uses it only for human-readable progress messages, not for constructing state update batches.

**Rationale:**
- Removing `checklist_status` from the contract would require coder-agent.md changes and risk breaking existing coder behavior
- The progress information is valuable for human monitoring of implementation runs
- Decoupling state updates from coder reporting eliminates the counting fragility without contract changes

**Implications:**
- The orchestrator's batch construction code changes but the coder-agent.md output contract section does not
- Progress messages in the implement skill can still report "coder completed N/M tasks" based on `checklist_status`

#### [D07] Add structured state_failure_reason to commit JSON output (DECIDED) {#d07-structured-failure-reason}

**Decision:** Add a `StateFailureReason` Rust enum (with serde `rename_all = "snake_case"` serialization) and an `Option<StateFailureReason>` field on `CommitData` in `output.rs`. When `state_update_failed` is true, this field contains one of: `"open_items"`, `"drift"`, `"ownership"`, `"db_error"`. When `state_update_failed` is false, the field is null. Classification in `commit.rs` matches directly on `TugError` enum variants -- no string matching anywhere. The recovery loop switches on this enum value instead of inspecting the `warnings` array.

**Rationale:**
- String-matching against freeform warning text is fragile; any wording change in `commit.rs` would silently break recovery classification
- A typed Rust enum with serde serialization makes the contract explicit, machine-parseable, and compile-time exhaustive
- The `commit.rs` code has the `TugError` variant available at classification time (before formatting to string), so direct pattern matching on the variant is straightforward
- Using `Option<StateFailureReason>` instead of `Option<String>` prevents accidental invalid values

**Implications:**
- `output.rs` gains a new `StateFailureReason` enum with variants `OpenItems`, `Drift`, `Ownership`, `DbError`, serialized to lowercase snake_case strings via `#[serde(rename_all = "snake_case")]`
- `CommitData` gains `state_failure_reason: Option<StateFailureReason>` with `skip_serializing_if = "Option::is_none"`
- `commit.rs` classifies the failure reason by matching on `TugError` variants directly: `StateIncompleteChecklist` | `StateIncompleteSubsteps` -> `OpenItems`, `StatePlanHashMismatch` -> `Drift`, `StateOwnershipViolation` | `StateStepNotClaimed` -> `Ownership`, all others (`StateDbOpen`, `StateDbQuery`, `Io`, etc.) -> `DbError`. No string matching.
- The `check_commit_drift` path (which returns `Ok(Some(_))` rather than a TugError) maps to `Drift` directly
- The `StateDb::open()` and `find_repo_root_from()` failure paths map to `DbError` directly
- Existing `warnings` array is preserved for human-readable context but is no longer the machine-parseable signal
- The recovery loop in SKILL.md switches on `state_failure_reason` instead of string-matching warnings
- Only `"open_items"` enters the retry loop; `"drift"`, `"ownership"`, and `"db_error"` escalate immediately

#### [D06] Add tool preference guidance to coder-agent (DECIDED) {#d06-tool-preferences}

**Decision:** Add a "Tool Usage" section to `coder-agent.md` that instructs the coder to prefer Grep/Read/Glob over Bash grep/cat/find and to use single-line Bash commands only.

**Rationale:**
- Claude Code's `permissionMode: dontAsk` does not suppress the built-in newline validation prompt
- The coder-agent has Grep, Read, Glob tools available but no instructions to prefer them
- Single-line Bash eliminates the confirmation prompt that breaks unattended operation

**Implications:**
- Documentation-only change to `coder-agent.md` with no contract implications
- Aligns with Claude Code's built-in guidance that already recommends these tool preferences

---

### 1.0.1 Specification {#specification}

#### 1.0.1.1 CLI: --complete-remaining Flag {#complete-remaining-spec}

**Spec S01: --complete-remaining flag behavior** {#s01-complete-remaining}

The `--complete-remaining` flag is added to the `Update` variant of the `StateCommand` enum in `tugcode/crates/tugcode/src/commands/state.rs`.

**Flag definition:**
```rust
/// Mark all non-specified open items as completed (use with --batch)
#[arg(long, requires = "batch")]
complete_remaining: bool,
```

**Behavior when `--complete-remaining` is true:**
1. Read batch JSON from stdin (may be empty array `[]`)
2. If entries are non-empty, apply each entry as normal (update the specified items)
3. After applying explicit entries, execute: `UPDATE checklist_items SET status = 'completed', updated_at = ? WHERE plan_path = ? AND step_anchor = ? AND status = 'open'`
4. Return combined count of items updated (explicit entries + auto-completed remaining)

**Important:** The `WHERE status = 'open'` clause means `--complete-remaining` preserves items already set to `deferred` by explicit batch entries. This contrasts with `state complete --force`, which overwrites all non-completed items including deferred ones. This makes `--complete-remaining` safe to use when the batch includes explicit deferred items for checkpoints the reviewer flagged.

**Behavior when `--complete-remaining` is false (current behavior, unchanged):**
1. Read batch JSON from stdin
2. If entries are empty, return error "Batch update array must contain at least one entry"
3. Apply each entry as normal

**Spec S02: tugtool-core batch_update_checklist changes** {#s02-batch-core-changes}

The `batch_update_checklist` function in `tugcode/crates/tugtool-core/src/state.rs` gains a `complete_remaining: bool` parameter. The function signature changes:

```rust
pub fn batch_update_checklist<T>(
    &mut self,
    plan_path: &str,
    anchor: &str,
    worktree: &str,
    entries: &[T],
    complete_remaining: bool,
) -> Result<UpdateResult, TugError>
```

When `complete_remaining` is true:
- The empty-array guard is skipped
- After processing all explicit entries, an additional SQL UPDATE marks remaining open items as completed
- The entire operation (explicit entries + complete-remaining) runs in a single transaction

**Transaction ordering guarantee:** The complete-remaining SQL (`UPDATE ... WHERE status = 'open'`) must execute *after* all explicit entry updates within the same transaction. SQLite guarantees that updates within a transaction are visible to subsequent statements in that transaction, so explicit deferred entries are already flushed when the complete-remaining UPDATE runs — it will not overwrite them because their status is no longer `'open'`. This ordering is critical: the explicit entries must be applied first so that `--complete-remaining` only targets genuinely unprocessed items.

#### 1.0.1.2 CLI: Structured state_failure_reason in CommitData {#commit-failure-reason-spec}

**Spec S05: StateFailureReason enum and state_failure_reason field in CommitData** {#s05-state-failure-reason}

Add a new enum and nullable field to `tugcode/crates/tugcode/src/output.rs`:

```rust
/// Structured reason for state update failure in tugcode commit.
/// Serialized to lowercase snake_case strings for JSON output.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StateFailureReason {
    /// complete_step failed because open checklist items or substeps remain
    OpenItems,
    /// Plan file has been modified since state was initialized
    Drift,
    /// Step ownership check failed or step not in expected status
    Ownership,
    /// Could not open state.db, query failed, or other infrastructure error
    DbError,
}
```

Add the field to `CommitData`:

```rust
/// Structured reason for state update failure (null when state_update_failed is false)
#[serde(skip_serializing_if = "Option::is_none")]
pub state_failure_reason: Option<StateFailureReason>,
```

**Allowed values (when `state_update_failed` is true):**

| JSON value | Rust variant | Meaning | TugError variants |
|------------|-------------|---------|-------------------|
| `"open_items"` | `OpenItems` | Checklist items or substeps still open | `StateIncompleteChecklist`, `StateIncompleteSubsteps` |
| `"drift"` | `Drift` | Plan file changed since state init | `StatePlanHashMismatch`, or `check_commit_drift()` returns `Ok(Some(_))` |
| `"ownership"` | `Ownership` | Step not claimed or claimed by different worktree | `StateOwnershipViolation`, `StateStepNotClaimed` |
| `"db_error"` | `DbError` | Database or infrastructure error | `StateDbOpen`, `StateDbQuery`, `Io`, and all other TugError variants |

**Classification logic in commit.rs:**

`classify_state_error` is used **only** on Path 2 (the `complete_step` error path), where a `TugError` is available. All other paths set `state_failure_reason` directly because they don't have a `TugError` to classify — `check_commit_drift()` returns `Result<Option<String>, String>`, and the `StateDb::open()` / `find_repo_root_from()` error paths produce raw strings in the current code.

```rust
// Path 1: check_commit_drift() returns Ok(Some(_)) — drift detected before complete_step
// No TugError available; check_commit_drift returns Result<Option<String>, String>
state_failure_reason = Some(StateFailureReason::Drift)

// Path 2: check_commit_drift() returns Ok(None) — proceed to complete_step
// This is the ONLY path where classify_state_error is used
match db.complete_step(...) {
    Ok(_) => state_failure_reason = None,
    Err(e) => {
        state_failure_reason = Some(classify_state_error(&e));
        // classify_state_error matches on TugError variants:
        //   StateIncompleteChecklist { .. } | StateIncompleteSubsteps { .. } => OpenItems
        //   StatePlanHashMismatch { .. } => Drift
        //   StateOwnershipViolation { .. } | StateStepNotClaimed { .. } => Ownership
        //   _ => DbError  // StateDbOpen, StateDbQuery, Io, etc.
    }
}

// Path 3: check_commit_drift() returns Err(_) — drift check itself failed
// No TugError; check_commit_drift returns Err(String); set directly
state_failure_reason = Some(StateFailureReason::DbError)

// Path 4: StateDb::open() failed — set directly
state_failure_reason = Some(StateFailureReason::DbError)

// Path 5: find_repo_root_from() failed — set directly
state_failure_reason = Some(StateFailureReason::DbError)
```

**Key design point:** The `classify_state_error` helper function takes a `&TugError` reference and matches on variant discriminants. It is only applicable to Path 2 because `complete_step` is the only call that returns a `TugError`. Paths 1, 3, 4, and 5 set `state_failure_reason` directly to the appropriate variant without going through `classify_state_error`. The wildcard `_ => DbError` arm in `classify_state_error` ensures any future TugError variants added to `complete_step` default to the safest non-retryable classification.

**Backward compatibility:** The field is `skip_serializing_if = "Option::is_none"`, so existing consumers that do not expect it will not see it when `state_update_failed` is false. When `state_update_failed` is true, the field is always present. The `warnings` array continues to carry human-readable details.

#### 1.0.1.3 Implement Skill: Recovery Loop {#recovery-loop-spec}


**Spec S03: state_update_failed recovery loop** {#s03-recovery-loop}

When the committer returns `state_update_failed == true`:

```
0. Read state_failure_reason from committer JSON output (per [D07]).
   Switch on reason:
     - "drift":     Escalate immediately. AskUserQuestion: "State update failed due to plan
                    drift. Manual recovery: re-run tugcode state init, then retry."
     - "ownership": Escalate immediately. AskUserQuestion: "State update failed: step
                    ownership mismatch. Check worktree configuration."
     - "db_error":  Escalate immediately. AskUserQuestion: "State update failed: database
                    error. Warning: {warnings[0]}. Manual recovery needed."
     - "open_items": Enter retry loop below.
     - null/missing: Enter retry loop below (defensive fallback).
   Do NOT enter retry loop for drift, ownership, or db_error.

recovery_attempts = 0
max_recovery_attempts = 3

while recovery_attempts < max_recovery_attempts:
  recovery_attempts += 1

  1. Query: tugcode state show {plan_path} --json
     (Note: state show does not accept --step or --worktree flags. The --checklist
     flag only affects text rendering; JSON output always includes checklist_items
     regardless.)
  2. Parse JSON output. Filter checklist_items where step_anchor == {step_anchor}
     and status == "open" (client-side filtering).
  3. If no open items found for this step:
     - State is already consistent; proceed to next step
     - Break loop
  4. If open items found AND reviewer verdict was APPROVE (no non-PASS checkpoints):
     - Run: echo '[]' | tugcode state update {plan_path} {step_anchor} --worktree {worktree_path} --batch --complete-remaining
     - If succeeds: proceed to verification (step 6)
     - If fails: continue loop (retry)
  5. If open items found AND reviewer had non-PASS checkpoint items:
     - Construct deferred-only batch from reviewer's non-PASS checkpoint verdicts
       (same format as Spec S04 step 1).
     - Run: echo '<deferred_batch_json>' | tugcode state update {plan_path} {step_anchor} --worktree {worktree_path} --batch --complete-remaining
     - If succeeds: proceed to verification (step 6)
     - If fails: continue loop (retry)
  6. Post-recovery verification:
     - Run: tugcode state show {plan_path} --json
     - Filter checklist_items where step_anchor == {step_anchor} and status == "open"
     - If zero open items: run tugcode state complete {plan_path} {step_anchor} --worktree {worktree_path}
       (Note: state complete without --force is correct here because all open items
       should now be completed or deferred by --complete-remaining.)
       - If complete succeeds: break loop
       - If complete fails: continue loop (retry)
     - If open items remain: continue loop (retry)

if recovery_attempts >= max_recovery_attempts:
  AskUserQuestion: "State reconciliation failed after 3 attempts. Open items: {list}.
    Manual recovery: echo '[]' | tugcode state update {plan_path} {step_anchor}
    --worktree {worktree_path} --batch --complete-remaining"
```

**Note on recovery guidance:** The escalation message recommends `state update --batch --complete-remaining` as the manual recovery path because it preserves deferred items. Avoid recommending `state complete --force` (which overwrites deferred items) or `state reconcile` (which erases deferred state) unless the user explicitly does not care about deferred semantics.

#### 1.0.1.4 Implement Skill: Simplified Batch Construction {#simplified-batch-spec}

**Spec S04: simplified batch construction** {#s04-simplified-batch}

**Current flow (replaced):**
1. Iterate coder `checklist_status.tasks[]` and `checklist_status.tests[]` to build batch entries
2. Iterate reviewer `plan_conformance.checkpoints[]` to add checkpoint entries
3. Send full itemized batch via `--batch`

**New flow:**
1. Collect only non-PASS checkpoint items from reviewer `plan_conformance.checkpoints[]`:
   - `FAIL`, `BLOCKED`, `UNVERIFIED` map to `{"kind": "checkpoint", "ordinal": N, "status": "deferred", "reason": "<from reviewer>"}`
2. If any deferred items exist, send them as batch JSON with `--complete-remaining`:
   ```
   echo '<deferred_items_json>' | tugcode state update {plan_path} {step_anchor} --worktree {worktree_path} --batch --complete-remaining
   ```
3. If no deferred items exist, send empty array with `--complete-remaining`:
   ```
   echo '[]' | tugcode state update {plan_path} {step_anchor} --worktree {worktree_path} --batch --complete-remaining
   ```

**Note:** The coder's `checklist_status` is still parsed but used only for the progress message output (e.g., "Coder completed 18/20 tasks, 5/5 tests").

---

### 1.0.2 Symbol Inventory {#symbol-inventory}

#### 1.0.2.1 Modified files {#modified-files}

**Table T01: Files modified** {#t01-files-modified}

| File | Change |
|------|--------|
| `tugcode/crates/tugcode/src/commands/state.rs` | Add `--complete-remaining` flag to `Update` variant; pass to `run_state_update`; conditionally skip empty-array guard |
| `tugcode/crates/tugcode/src/main.rs` | Add `complete_remaining` to `StateCommands::Update` destructuring and pass to `commands::run_state_update` |
| `tugcode/crates/tugtool-core/src/state.rs` | Add `complete_remaining: bool` parameter to `batch_update_checklist`; conditionally skip empty-array guard; add complete-remaining SQL update |
| `tugcode/crates/tugcode/src/output.rs` | Add `StateFailureReason` enum and `state_failure_reason: Option<StateFailureReason>` field to `CommitData`; update serialization tests |
| `tugcode/crates/tugcode/src/commands/commit.rs` | Add `classify_state_error` helper matching `TugError` variants to `StateFailureReason`; populate `state_failure_reason` field in each error arm |
| `tugcode/crates/tugcode/tests/state_integration_tests.rs` | Add integration tests for `--complete-remaining` flag |
| `tugplug/skills/implement/SKILL.md` | Rewrite batch construction (section 3e "After APPROVE"); add recovery loop using `state_failure_reason` (section 3f); update failure message block |
| `tugplug/agents/coder-agent.md` | Add "Tool Usage" section with tool preferences and single-line Bash rule; label `checklist_status` as non-authoritative progress telemetry |

#### 1.0.2.2 Symbols to add / modify {#symbols}

**Table T02: Symbols** {#t02-symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `complete_remaining` | field (bool) | `state.rs` `Update` variant | New CLI flag, `#[arg(long, requires = "batch")]` |
| `run_state_update` | fn signature | `tugcode/src/commands/state.rs` | Add `complete_remaining: bool` parameter; pass to `batch_update_checklist`; conditional empty-array guard |
| `StateCommands::Update` destructuring | match arm | `tugcode/src/main.rs` | Add `complete_remaining` to destructuring pattern and pass to `run_state_update` call |
| `batch_update_checklist` | fn signature | `tugtool-core/src/state.rs` | Add `complete_remaining: bool` parameter |
| `StateFailureReason` | enum | `output.rs` | New enum with variants `OpenItems`, `Drift`, `Ownership`, `DbError`; `#[serde(rename_all = "snake_case")]` |
| `state_failure_reason` | field (Option&lt;StateFailureReason&gt;) | `output.rs` `CommitData` | New nullable field; serializes to `"open_items"`, `"drift"`, `"ownership"`, `"db_error"` |
| `classify_state_error` | fn | `commit.rs` | Helper that matches `&TugError` to `StateFailureReason` variant |

---

### 1.0.3 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Integration** | Test `--complete-remaining` flag end-to-end via CLI | All Rust changes |
| **Unit** | Test `batch_update_checklist` with `complete_remaining=true` and empty/non-empty entries | Core library changes |

#### Key Test Scenarios {#key-test-scenarios}

**List L01: Integration test scenarios for --complete-remaining** {#l01-test-scenarios}

1. Empty array + `--complete-remaining`: all open items marked completed
2. Non-empty array (with deferred items) + `--complete-remaining`: specified items get their explicit status, remaining open items marked completed
3. Deferred-only batch + `--complete-remaining`: only deferred checkpoint items in batch, all other open items (tasks, tests) marked completed (orchestrator's primary path when reviewer has non-PASS checkpoints)
4. Empty array WITHOUT `--complete-remaining`: error "Batch update array must contain at least one entry" (existing behavior preserved)
5. `--complete-remaining` without `--batch`: CLI argument error (requires = "batch" enforced by clap)
6. `--complete-remaining` when no open items remain: succeeds with 0 items updated (idempotent)
7. `--complete-remaining` respects ownership check (wrong worktree rejected)

**List L02: Unit test scenarios for StateFailureReason classification** {#l02-classification-tests}

1. `classify_state_error` maps `StateIncompleteChecklist` to `OpenItems`
2. `classify_state_error` maps `StateIncompleteSubsteps` to `OpenItems`
3. `classify_state_error` maps `StatePlanHashMismatch` to `Drift`
4. `classify_state_error` maps `StateOwnershipViolation` to `Ownership`
5. `classify_state_error` maps `StateStepNotClaimed` to `Ownership`
6. `classify_state_error` maps `StateDbOpen` to `DbError`
7. `classify_state_error` maps `StateDbQuery` to `DbError`
8. `StateFailureReason` serde round-trip: `OpenItems` serializes to `"open_items"` and deserializes back
9. `CommitData` with `state_failure_reason: None` omits field from JSON; with `Some(OpenItems)` includes `"open_items"`

---

### 1.0.4 Execution Steps {#execution-steps}

#### Step 0: Add --complete-remaining flag and structured failure reason to CLI {#step-0}

**Commit:** `feat(state): add --complete-remaining flag and structured state_failure_reason`

**References:** [D01] Add --complete-remaining flag, [D02] Remove empty-array guard, [D07] Structured failure reason, Spec S01, Spec S02, Spec S05, Table T01, Table T02, (#complete-remaining-spec, #s02-batch-core-changes, #s05-state-failure-reason, #commit-failure-reason-spec)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/state.rs`: new `complete_remaining` field on `Update` variant, updated `run_state_update` signature, conditional empty-array guard, pass-through to core
- Modified `tugcode/crates/tugcode/src/main.rs`: `StateCommands::Update` destructuring updated to include `complete_remaining` and pass to `run_state_update`
- Modified `tugcode/crates/tugtool-core/src/state.rs`: updated `batch_update_checklist` signature and implementation with complete-remaining SQL update
- Modified `tugcode/crates/tugcode/src/output.rs`: new `StateFailureReason` enum; `CommitData` gains `state_failure_reason: Option<StateFailureReason>` field
- Modified `tugcode/crates/tugcode/src/commands/commit.rs`: new `classify_state_error` helper matching `TugError` variants to `StateFailureReason`; populates `state_failure_reason` in each error arm

**Tasks:**
- [ ] Add `complete_remaining: bool` field with `#[arg(long, requires = "batch")]` to the `Update` variant in `StateCommand`
- [ ] Update the `StateCommands::Update` destructuring in `main.rs` to include `complete_remaining` and pass it to `commands::run_state_update`
- [ ] Add `complete_remaining: bool` parameter to `run_state_update` function signature in `state.rs`
- [ ] In `run_state_update`, pass `complete_remaining` to the batch code path
- [ ] Conditionalize the empty-array guard in `run_state_update`: only error when `!complete_remaining && entries.is_empty()`
- [ ] Add `complete_remaining: bool` parameter to `batch_update_checklist` in tugtool-core
- [ ] Conditionalize the tugtool-core empty-array guard similarly
- [ ] When `complete_remaining` is true, after processing explicit entries, execute `UPDATE checklist_items SET status = 'completed', updated_at = ? WHERE plan_path = ? AND step_anchor = ? AND status = 'open'` within the same transaction
- [ ] Update the single existing caller of `batch_update_checklist` in `run_state_update` (`state.rs` line ~660) to pass the `complete_remaining` parameter from the CLI flag value (clap defaults the flag to `false` when not specified, so backward compatibility is automatic)
- [ ] Add `StateFailureReason` enum to `output.rs` with variants `OpenItems`, `Drift`, `Ownership`, `DbError` and `#[serde(rename_all = "snake_case")]`
- [ ] Add `state_failure_reason: Option<StateFailureReason>` field to `CommitData` in `output.rs` with `#[serde(skip_serializing_if = "Option::is_none")]`
- [ ] Add `classify_state_error(e: &TugError) -> StateFailureReason` helper in `commit.rs` that matches exhaustively on TugError variants: `StateIncompleteChecklist` | `StateIncompleteSubsteps` -> `OpenItems`, `StatePlanHashMismatch` -> `Drift`, `StateOwnershipViolation` | `StateStepNotClaimed` -> `Ownership`, `_ => DbError` (catches `StateDbOpen`, `StateDbQuery`, `Io`, and any future variants)
- [ ] In `commit.rs`, call `classify_state_error` in the `complete_step` `Err(e)` arm (line ~197) to set `state_failure_reason` from the `TugError` variant before formatting `e` to a warning string
- [ ] Set `state_failure_reason = Some(StateFailureReason::Drift)` for the `check_commit_drift` `Ok(Some(_))` path
- [ ] Set `state_failure_reason = Some(StateFailureReason::DbError)` for the `check_commit_drift` `Err(_)`, `StateDb::open` `Err(_)`, and `find_repo_root_from` `Err(_)` paths
- [ ] Update the `CommitData` construction in `commit.rs` to populate `state_failure_reason` in each arm (including `None` for the success path)
- [ ] Update existing `CommitData` serialization tests in `output.rs` to include `state_failure_reason` field (both None and Some cases)

**Tests:**
- [ ] Integration test: empty array + `--complete-remaining` marks all open items completed
- [ ] Integration test: non-empty deferred items + `--complete-remaining` applies deferred then completes remaining
- [ ] Integration test: deferred-only batch + `--complete-remaining` marks deferred items as deferred and all other open items as completed
- [ ] Integration test: empty array WITHOUT `--complete-remaining` still returns error (regression test)
- [ ] Integration test: `--complete-remaining` without `--batch` is rejected by clap
- [ ] Integration test: `--complete-remaining` with no open items remaining succeeds idempotently
- [ ] Integration test: ownership check still enforced with `--complete-remaining`
- [ ] Unit test: `CommitData` serialization with `state_failure_reason: Some(StateFailureReason::OpenItems)` serializes as `"open_items"`
- [ ] Unit test: `CommitData` serialization with `state_failure_reason: None` omits the field
- [ ] Unit test: `StateFailureReason` serde round-trip for all four variants (serialization produces expected snake_case strings, deserialization recovers the variant)
- [ ] Unit test: `classify_state_error` correctly maps each relevant `TugError` variant: `StateIncompleteChecklist` -> `OpenItems`, `StateIncompleteSubsteps` -> `OpenItems`, `StatePlanHashMismatch` -> `Drift`, `StateOwnershipViolation` -> `Ownership`, `StateStepNotClaimed` -> `Ownership`, `StateDbOpen` -> `DbError`, `StateDbQuery` -> `DbError`

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes all tests including new integration and unit tests
- [ ] `cd tugcode && cargo fmt --all --check` reports no formatting issues

**Rollback:**
- Revert the commit; no database schema changes involved

**Commit after all checkpoints pass.**

---

#### Step 1: Simplify implement skill batch construction and add recovery loop {#step-1}

**Depends on:** #step-0

**Commit:** `feat(implement): simplify batch construction and add state recovery loop`

**References:** [D03] Recovery loop pattern, [D04] Simplified batch, [D05] Checklist progress only, [D07] Structured failure reason, Spec S03, Spec S04, Spec S05, Risk R01, Risk R02, (#recovery-loop-spec, #simplified-batch-spec, #s05-state-failure-reason, #r01-auto-complete-masks, #r02-recovery-unresolvable)

**Artifacts:**
- Modified `tugplug/skills/implement/SKILL.md`: rewritten "After APPROVE" batch construction, new recovery loop using `state_failure_reason` in section 3f, updated failure message block

**Tasks:**
- [ ] Rewrite the "After APPROVE -- update state with batch JSON" section to send only deferred checkpoint items + `--complete-remaining` per Spec S04
- [ ] Remove the manual batch construction that iterates coder `checklist_status.tasks[]` and `checklist_status.tests[]`
- [ ] Add a progress message output that uses the coder's `checklist_status` for informational display only (e.g., "Coder reported: N/M tasks completed, P/Q tests completed"), with a note that `checklist_status` is non-authoritative progress telemetry and is never used for state updates
- [ ] Replace the hard halt on `state_update_failed == true` (section 3f) with the recovery loop per Spec S03
- [ ] The recovery loop must switch on the structured `state_failure_reason` field (per [D07] and Spec S05): only `"open_items"` enters the retry loop; `"drift"`, `"ownership"`, and `"db_error"` escalate immediately
- [ ] Ensure the recovery loop uses `tugcode state show {plan_path} --json` (not `--checklist --json`; the `--checklist` flag only affects text rendering, JSON output always includes `checklist_items` regardless). Do not use `--step` or `--worktree` flags (not accepted by the `Show` command). Filter results client-side by `step_anchor`.
- [ ] When the reviewer had non-PASS checkpoint items, the recovery loop must construct a deferred-only batch (from reviewer output) and send with `--complete-remaining` before escalating, per Spec S03 step 5
- [ ] The recovery loop must include a post-recovery verification step: after `--complete-remaining` succeeds, query `tugcode state show --json` again, filter for step's open items, and only call `state complete` if zero open items remain, per Spec S03 step 6
- [ ] Update escalation messages to recommend `tugcode state update --batch --complete-remaining` as the recovery path. Do NOT recommend `state reconcile` (erases deferred state) or `state complete --force` (overwrites deferred items) in automated escalation messages.
- [ ] Update the `state_update_failed` failure message block to describe the new recovery flow instead of "tugstate failure is fatal"
- [ ] Update the "State lifecycle" reference section near the end of SKILL.md to describe `--complete-remaining` usage, the `state_failure_reason` field, and the recovery flow
- [ ] Verify that all `tugcode state` commands in the recovery loop are compatible with the implement skill's Bash hook (tugcode CLI commands only)

**Tests:**
- [ ] Manual review: SKILL.md batch construction section sends only deferred items + `--complete-remaining`
- [ ] Manual review: SKILL.md recovery loop switches on `state_failure_reason` (not string-matching warnings)
- [ ] Manual review: SKILL.md recovery loop includes post-recovery verification step
- [ ] Manual review: SKILL.md recovery loop handles non-PASS reviewer items (deferred-only batch + `--complete-remaining`)
- [ ] Manual review: SKILL.md failure message block describes recovery flow, not hard halt
- [ ] Manual review: Escalation messages recommend `--complete-remaining`, not `state reconcile` or `state complete --force`

**Checkpoint:**
- [ ] The "After APPROVE" section in SKILL.md uses `--complete-remaining` and does not iterate coder checklist_status for batch construction
- [ ] The section 3f committer post-call handling includes a recovery loop with max 3 attempts
- [ ] The recovery loop switches on `state_failure_reason` and immediately escalates for `drift`, `ownership`, `db_error`
- [ ] The recovery loop uses `tugcode state show {plan_path} --json` (no `--checklist`, `--step`, or `--worktree` flags) with client-side filtering by step_anchor
- [ ] The recovery loop includes post-recovery verification (re-query state show, verify zero open items) before calling state complete
- [ ] The recovery loop handles the non-PASS reviewer case (deferred-only batch + `--complete-remaining`) before escalation
- [ ] Escalation messages recommend `state update --batch --complete-remaining`, not `state reconcile` or `state complete --force`
- [ ] The failure message block for `state_update_failed` describes recovery, not fatal halt
- [ ] No references to the old batch construction pattern remain in SKILL.md (aside from the coder output contract description)

**Rollback:**
- Revert the commit; SKILL.md changes are documentation only

**Commit after all checkpoints pass.**

---

#### Step 2: Add tool preference guidance to coder-agent {#step-2}

**Depends on:** #step-0

**Commit:** `docs(coder-agent): add tool preference guidance and single-line Bash rule`

**References:** [D05] Checklist progress only, [D06] Tool preferences, (#d05-checklist-progress-only, #d06-tool-preferences)

**Artifacts:**
- Modified `tugplug/agents/coder-agent.md`: new "Tool Usage" section; `checklist_status` labeled as non-authoritative progress telemetry

**Tasks:**
- [ ] Add a "Tool Usage" section to `coder-agent.md` with the following guidance: prefer Read over cat/head/tail, prefer Grep over bash grep/rg, prefer Glob over bash find/ls, use Bash only for build/test/checkpoint commands, single-line Bash commands only (no `\` continuations or heredocs)
- [ ] Place the section after the "Step Data and Output" section and before the "Error Handling" section (or at a similarly prominent location)
- [ ] Add a clear label to the `checklist_status` field description in the output contract table: "Non-authoritative progress telemetry. The orchestrator uses this for progress messages only, never for state updates. Accuracy is best-effort."

**Tests:**
- [ ] Manual review: coder-agent.md contains "Tool Usage" section with all five tool preference rules
- [ ] Manual review: coder-agent.md `checklist_status` description includes "non-authoritative progress telemetry" label

**Checkpoint:**
- [ ] The "Tool Usage" section exists in coder-agent.md
- [ ] The section includes guidance for Read, Grep, Glob, Bash-only-for-CLI, and single-line-Bash
- [ ] The `checklist_status` field description is labeled as non-authoritative progress telemetry

**Rollback:**
- Revert the commit; documentation-only change

**Commit after all checkpoints pass.**

---

### 1.0.5 Deliverables and Checkpoints {#deliverables}

**Deliverable:** The implement skill reliably reconciles checklist state after reviewer approval without fragile ordinal counting, recovers from state update failures without halting, and the coder-agent avoids multi-line Bash commands.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugcode state update --batch --complete-remaining` accepts empty arrays and marks all open items completed (integration test passes)
- [ ] `tugcode state update --batch --complete-remaining` with deferred items applies them before completing the rest (integration test passes)
- [ ] `tugcode commit --json` output includes `state_failure_reason` field when `state_update_failed` is true (unit test passes)
- [ ] The implement skill SKILL.md "After APPROVE" section sends only deferred items + `--complete-remaining`
- [ ] The implement skill SKILL.md has a recovery loop for `state_update_failed` that switches on `state_failure_reason`, with max 3 attempts for `open_items` and immediate escalation for other reasons
- [ ] The implement skill SKILL.md recovery loop includes post-recovery verification and handles non-PASS reviewer cases
- [ ] `coder-agent.md` has a "Tool Usage" section with tool preferences and single-line Bash rule
- [ ] `coder-agent.md` labels `checklist_status` as non-authoritative progress telemetry
- [ ] `cd tugcode && cargo nextest run` passes all tests
- [ ] `cd tugcode && cargo fmt --all --check` reports no formatting issues

**Acceptance tests:**
- [ ] Integration test: `--complete-remaining` with empty array
- [ ] Integration test: `--complete-remaining` with deferred items
- [ ] Integration test: deferred-only batch + `--complete-remaining` (orchestrator path)
- [ ] Integration test: empty array without `--complete-remaining` still errors (regression)
- [ ] Unit test: `CommitData` serialization includes `state_failure_reason` when present, omits when None
- [ ] Unit test: `StateFailureReason` serde round-trip for all four variants
- [ ] Unit test: `classify_state_error` maps TugError variants to correct `StateFailureReason` values

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add telemetry to track how often the recovery loop fires and whether it resolves without user escalation
- [ ] Consider making `--complete-remaining` the default behavior for `--batch` in a future major version
- [ ] Evaluate whether `checklist_status` should be removed from the coder output contract entirely in a future simplification pass

| Checkpoint | Verification |
|------------|--------------|
| CLI flag works | `cd tugcode && cargo nextest run` passes all `--complete-remaining` tests |
| Structured failure reason works | `cd tugcode && cargo nextest run` passes `StateFailureReason` serde, `classify_state_error`, and `CommitData` serialization tests |
| SKILL.md updated | Manual review of batch construction, recovery loop (uses `state_failure_reason`), and escalation messages |
| coder-agent.md updated | Manual review of "Tool Usage" section and `checklist_status` non-authoritative label |

**Commit after all checkpoints pass.**
