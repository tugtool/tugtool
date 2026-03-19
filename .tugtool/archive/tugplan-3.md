## Phase 3.0: Improve Merge Dirty-File Detection and Local-Mode Support {#phase-merge-dirty-local}

**Purpose:** Refactor `get_dirty_files()` in merge.rs to return structured data that distinguishes tracked-modified files from untracked files, so that only tracked-modified files block merges while untracked files are reported as informational warnings. Additionally, make the integrator agent detect no-remote repos early and fail fast with a clear error, ensuring local-mode workflows are first-class.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | N/A |
| Last updated | 2026-02-14 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The merge command in `crates/tugtool/src/commands/merge.rs` uses `get_dirty_files()` which calls `git status --porcelain -u`. The `-u` flag causes all untracked files to appear in the output, and the current implementation treats every dirty file uniformly -- any non-infrastructure dirty file blocks the merge. This is overly aggressive: untracked files cannot cause merge conflicts and should not prevent merges.

Separately, the integrator agent has no awareness of whether a remote origin exists. In no-remote repos, the integrator blindly attempts `tugtool open-pr` and `git push`, which fail with confusing errors. The merge command already has `has_remote_origin()` and local-mode support, but the implementer skill's integrator phase does not account for this scenario at all.

#### Strategy {#strategy}

- Introduce a `DirtyFiles` struct that partitions results into `tracked_modified` and `untracked` vectors
- Refactor all callers of `get_dirty_files()` to use the new structured return type
- Change merge blocking logic to only block on `tracked_modified` files, reporting `untracked` as warnings
- Update `MergeData` JSON output to include separate `untracked_files` field for informational reporting
- Add early no-remote detection to the integrator agent with a fail-fast error message
- Add unit tests for the new struct and the updated blocking logic

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool users running local-only workflows without a GitHub remote
2. Tugtool users whose working directories contain untracked files during merge

#### Success Criteria (Measurable) {#success-criteria}

- Untracked files in the main worktree no longer block `tugtool merge` (`cargo nextest run` passes with a test demonstrating this)
- Untracked files appear as warnings in both JSON and text output
- Tracked modified non-infrastructure files still block merges (existing behavior preserved)
- The integrator agent returns `ESCALATE` with a clear error message when no remote origin exists
- `cargo build` passes with zero warnings
- All existing merge tests continue to pass

#### Scope {#scope}

1. Refactor `get_dirty_files()` to return `DirtyFiles` struct
2. Update all callers in merge.rs to use the new return type
3. Update `MergeData` to include `untracked_files` warning field
4. Update the integrator agent to detect no-remote and fail fast
5. Add unit tests for new behavior

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the worktree dirty check (`check_worktree_dirty`) -- implementation worktrees should still block on any dirty file
- Modifying `has_remote_origin()` -- it already works correctly
- Changing the merge skill's orchestration logic
- Adding `.gitignore` awareness to the dirty file detection

#### Dependencies / Prerequisites {#dependencies}

- Existing `get_dirty_files()` function in `crates/tugtool/src/commands/merge.rs`
- Existing `has_remote_origin()` function in `crates/tugtool/src/commands/merge.rs`
- Existing integrator agent definition in `agents/integrator-agent.md`

#### Constraints {#constraints}

- `-D warnings` is enforced via `.cargo/config.toml`; all code must compile warning-free
- JSON output schema changes must be backward-compatible (new fields are additive, existing fields unchanged)
- The `MergeData.dirty_files` field semantics change: it will now contain only tracked-modified files. The new `untracked_files` field holds untracked files.

#### Assumptions {#assumptions}

- The `-u` flag in `git status --porcelain -u` is what causes all untracked files to appear; replacing with `git status --porcelain` (no `-u`) and a separate untracked query will produce the correct partitioning
- Only tracked modified files can cause merge conflicts; untracked files are safe to ignore for merge blocking
- The `git status --porcelain` output format uses the first two columns as status codes: `??` for untracked, other codes for tracked changes
- Local-mode workflow (no PR, no remote) is a first-class use case
- Infrastructure files (.tugtool/, .beads/) are already handled separately and this fix will not affect that logic

---

### 3.0.0 Design Decisions {#design-decisions}

#### [D01] Return a DirtyFiles struct from get_dirty_files (DECIDED) {#d01-dirty-files-struct}

**Decision:** Replace the `Vec<String>` return type of `get_dirty_files()` with a `DirtyFiles` struct containing `tracked_modified: Vec<String>` and `untracked: Vec<String>`.

**Rationale:**
- A flat list conflates two semantically different categories of dirty files
- Callers need to make different decisions based on whether files are tracked-modified vs untracked
- A struct makes the API self-documenting and eliminates re-parsing at each call site

**Implications:**
- All callers of `get_dirty_files()` must be updated to destructure the new return type
- The `check_worktree_dirty` function will use `tracked_modified` + `untracked` (all files) since implementation worktrees should be fully clean
- The main-worktree merge blocking logic will only check `tracked_modified`

#### [D02] Parse porcelain status codes to classify files (DECIDED) {#d02-porcelain-parsing}

**Decision:** Keep the single `git status --porcelain -u` call but parse the two-character status prefix to classify files: lines starting with `??` are untracked, all other lines are tracked-modified.

**Rationale:**
- A single git command is more efficient than two separate commands
- The porcelain format guarantees stable output: the first two characters are always the status code, followed by a space, then the path
- The `??` status code is the only code used for untracked files

**Implications:**
- The existing `line[3..]` path extraction remains correct (status code is 2 chars + 1 space)
- Classification logic is simple pattern matching on `line.starts_with("??")`

#### [D03] Only tracked-modified files block main-worktree merge (DECIDED) {#d03-tracked-blocks-merge}

**Decision:** In the main worktree merge flow, only tracked-modified non-infrastructure files block the merge. Untracked files are reported as informational warnings but never block.

**Rationale:**
- Untracked files cannot cause merge conflicts
- Users commonly have scratch files, editor temp files, or build artifacts that are untracked
- Blocking on these files creates unnecessary friction in the merge workflow

**Implications:**
- `MergeData.dirty_files` will contain only tracked-modified files (semantic change, but field name becomes more accurate)
- A new `MergeData.untracked_files` field will be added for informational reporting
- The `prepare_main_for_merge` function will continue to handle both types (infrastructure partitioning still applies to both)

#### [D04] Integrator agent detects no-remote and returns ESCALATE (DECIDED) {#d04-integrator-no-remote}

**Decision:** The integrator agent will check for a remote origin before attempting to push or create a PR. If no remote exists, it will return an ESCALATE recommendation with a clear error message explaining that the repository has no remote and suggesting the user use `tugtool merge` for local-mode merges.

**Rationale:**
- The integrator agent currently blindly attempts `tugtool open-pr` which fails confusingly when there is no remote
- Fail-fast with a clear message is better than a cryptic git error
- ESCALATE (not REVISE) is correct because this is not a code issue the coder can fix

**Implications:**
- The integrator agent's prompt template will include a pre-check step
- The ESCALATE response will include a helpful message pointing to `tugtool merge`
- The implementer skill does not need changes; it already handles ESCALATE by asking the user

#### [D05] Preserve backward compatibility in MergeData JSON (DECIDED) {#d05-backward-compat}

**Decision:** The `dirty_files` field in `MergeData` JSON output retains its name but now contains only tracked-modified files. A new `untracked_files` field is added. Both fields use `skip_serializing_if` so they are omitted when empty.

**Rationale:**
- Existing consumers of the JSON output expect `dirty_files` to mean "files that block the merge"
- The semantic refinement (tracked-modified only) makes the field more accurate, not less
- Adding a new field is additive and backward-compatible

**Implications:**
- Consumers that check `dirty_files.is_some()` to determine if merge is blocked will continue to work correctly
- New consumers can also inspect `untracked_files` for informational purposes

---

### 3.0.1 Symbol Inventory {#symbol-inventory}

#### 3.0.1.1 New files (if any) {#new-files}

None. All changes are in existing files.

#### 3.0.1.2 Symbols to add / modify {#symbols}

**Table T01: Symbol Changes** {#t01-symbol-changes}

| Symbol | Kind | Location | Action | Notes |
|--------|------|----------|--------|-------|
| `DirtyFiles` | struct | `merge.rs` | Add | Fields: `tracked_modified: Vec<String>`, `untracked: Vec<String>` |
| `get_dirty_files` | fn | `merge.rs` | Modify | Return type changes from `Result<Vec<String>, String>` to `Result<DirtyFiles, String>` |
| `MergeData.untracked_files` | field | `merge.rs` | Add | `Option<Vec<String>>` with `skip_serializing_if` |
| `check_worktree_dirty` | fn | `merge.rs` | Modify | Use combined tracked+untracked from `DirtyFiles` |
| `prepare_main_for_merge` | fn | `merge.rs` | Modify | Use `DirtyFiles` struct, partition both tracked and untracked |
| `run_merge_in` | fn | `merge.rs` | Modify | Use `DirtyFiles`, block only on `tracked_modified`, warn on `untracked` |

---

### 3.0.2 Execution Steps {#execution-steps}

#### Step 0: Introduce DirtyFiles struct and refactor get_dirty_files {#step-0}

**Commit:** `refactor: return structured DirtyFiles from get_dirty_files()`

**References:** [D01] DirtyFiles struct, [D02] Porcelain parsing, Table T01, (#d01-dirty-files-struct, #d02-porcelain-parsing, #t01-symbol-changes)

**Artifacts:**
- New `DirtyFiles` struct in `merge.rs`
- Refactored `get_dirty_files()` with new return type
- All callers updated to compile with the new type

**Tasks:**
- [ ] Define `DirtyFiles` struct with `tracked_modified: Vec<String>` and `untracked: Vec<String>` fields
- [ ] Refactor `get_dirty_files()` to parse the two-character porcelain status prefix: lines starting with `??` go into `untracked`, all others go into `tracked_modified`
- [ ] Update `check_worktree_dirty()` to combine both vectors (implementation worktrees must be fully clean)
- [ ] Update `prepare_main_for_merge()` to use `DirtyFiles` -- the infrastructure/non-infrastructure partitioning applies to the combined set of all dirty files
- [ ] Update the first `get_dirty_files(&repo_root)` call in `run_merge_in()` (around line 1071) to use the new struct
- [ ] Update the post-merge `get_dirty_files(&repo_root)` call (around line 1422) to use the new struct
- [ ] Ensure all code compiles with zero warnings

**Tests:**
- [ ] Unit test: `get_dirty_files` with only tracked modified files returns empty `untracked`
- [ ] Unit test: `get_dirty_files` with only untracked files returns empty `tracked_modified`
- [ ] Unit test: `get_dirty_files` with mixed tracked and untracked files partitions correctly
- [ ] Unit test: `get_dirty_files` on clean repo returns both vectors empty

**Checkpoint:**
- [ ] `cargo build -p tugtool 2>&1 | head -5` -- compiles with zero warnings
- [ ] `cargo nextest run -p tugtool` -- all existing tests pass

**Rollback:** Revert commit; restore original `Vec<String>` return type.

**Commit after all checkpoints pass.**

---

#### Step 1: Update merge blocking logic and MergeData output {#step-1}

**Depends on:** #step-0

**Commit:** `fix: only block merge on tracked-modified files, warn on untracked`

**References:** [D03] Tracked blocks merge, [D05] Backward compatibility, Table T01, (#d03-tracked-blocks-merge, #d05-backward-compat, #t01-symbol-changes)

**Artifacts:**
- New `untracked_files` field on `MergeData`
- Updated merge blocking logic in `run_merge_in()`
- Updated dry-run and text output to show untracked files as warnings

**Tasks:**
- [ ] Add `untracked_files: Option<Vec<String>>` field to `MergeData` with `#[serde(skip_serializing_if = "Option::is_none")]`
- [ ] In `run_merge_in()`, after calling `get_dirty_files(&repo_root)`, partition using the `DirtyFiles` struct:
  - `tracked_modified` non-infrastructure files block the merge (existing error path)
  - `untracked` non-infrastructure files become a warning in `all_warnings`
  - Infrastructure files from both categories continue through existing infra handling
- [ ] In the dry-run output, populate `dirty_files` with tracked-modified infra files only, and `untracked_files` with untracked files
- [ ] In the text output, show untracked files as a separate informational line: "N untracked file(s) present (not blocking merge)"
- [ ] Update existing serialization tests to account for the new `untracked_files` field
- [ ] Ensure `MergeData::error()` initializes `untracked_files: None`

**Tests:**
- [ ] Unit test: `MergeData` serialization omits `untracked_files` when None
- [ ] Unit test: `MergeData` serialization includes `untracked_files` when present
- [ ] Integration test: merge with only untracked files in main proceeds without blocking
- [ ] Integration test: merge with tracked-modified non-infra files in main still blocks
- [ ] Integration test: merge with both tracked-modified and untracked files blocks (due to tracked-modified) and reports untracked as warning

**Checkpoint:**
- [ ] `cargo build -p tugtool 2>&1 | head -5` -- compiles with zero warnings
- [ ] `cargo nextest run -p tugtool` -- all tests pass including new ones

**Rollback:** Revert commit; `untracked_files` field removed, blocking logic restored.

**Commit after all checkpoints pass.**

---

#### Step 2: Add no-remote detection to integrator agent {#step-2}

**Depends on:** #step-0

**Commit:** `fix: integrator agent detects no-remote and fails fast with ESCALATE`

**References:** [D04] Integrator no-remote, (#d04-integrator-no-remote, #context)

**Artifacts:**
- Updated `agents/integrator-agent.md` with no-remote pre-check step

**Tasks:**
- [ ] Add a pre-check step to the integrator agent's "Mode 1: First Invocation" section: before calling `tugtool open-pr`, run `git -C {worktree_path} remote get-url origin` to check for a remote
- [ ] If the remote check fails (exit code non-zero), return an ESCALATE response immediately with a clear error message: "No remote origin configured. This repository uses local-mode workflow. Use 'tugtool merge <plan>' from the main worktree to merge locally."
- [ ] Add the no-remote check to the "Behavior Rules" section as a numbered rule
- [ ] Add a "No Remote" subsection to the "Error Handling" section with the expected ESCALATE JSON output

**Tests:**
- [ ] Manual verification: read the updated agent markdown and confirm the pre-check is documented in the correct location
- [ ] The integrator agent prompt is declarative (markdown); no compiled tests needed for this step

**Checkpoint:**
- [ ] Verify the updated `agents/integrator-agent.md` contains the no-remote pre-check
- [ ] Verify the ESCALATE JSON template is well-formed

**Rollback:** Revert the agent markdown file to its previous version.

**Commit after all checkpoints pass.**

---

### 3.0.3 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Merge command correctly distinguishes tracked-modified from untracked files, only blocking on tracked-modified files while reporting untracked as warnings. Integrator agent detects no-remote repos and fails fast with a clear ESCALATE error.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build` compiles with zero warnings
- [ ] `cargo nextest run` passes all tests (existing and new)
- [ ] Running `tugtool merge` with untracked files in main does not block the merge
- [ ] Running `tugtool merge --json` with untracked files shows them in `untracked_files` field
- [ ] Running `tugtool merge` with tracked-modified non-infra files still blocks
- [ ] The integrator agent markdown documents the no-remote pre-check

**Acceptance tests:**
- [ ] Unit test: `DirtyFiles` struct correctly partitions porcelain output
- [ ] Unit test: `MergeData` serialization includes `untracked_files` when present, omits when empty
- [ ] Integration test: merge succeeds with untracked-only dirty files
- [ ] Integration test: merge blocks with tracked-modified dirty files

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add `.gitignore`-awareness to filter ignored files from untracked list
- [ ] Update implementer skill to skip integrator phase when no remote is detected (proactive, not reactive)
- [ ] Consider adding a `--allow-dirty` flag to `tugtool merge` for explicit override

| Checkpoint | Verification |
|------------|--------------|
| Build passes | `cargo build 2>&1 \| head -5` |
| Tests pass | `cargo nextest run` |
| No regressions | All existing merge tests still green |

**Commit after all checkpoints pass.**
