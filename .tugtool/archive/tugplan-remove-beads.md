## Phase 2.0: Remove Beads (Tugstate as Sole Coordination Layer) {#phase-remove-beads}

**Purpose:** Remove the entire beads dependency from tugtool, making Tugstate the sole coordination mechanism for multi-worktree plan implementations. After this phase, no `bd` binary, `.beads/` directory, beads CLI commands, or bead-related types exist in the codebase.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-23 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 1 ("Add Tugstate") shipped an embedded SQLite state management system alongside the existing beads infrastructure. All 11 tugstate CLI commands are functional and tested: init, claim, start, heartbeat, update, artifact, complete, show, ready, reset, and reconcile. The schema has 6 tables with lease-based claiming, dependency-aware step ordering, and git trailer support. Worktree create calls `state init` and commit appends `Tug-Step`/`Tug-Plan` trailers.

Beads remains in the codebase but is no longer needed. It adds complexity (1369 lines in `beads.rs` alone, 8 command files, a mock `bd-fake` binary for testing, `BeadsConfig` in config, bead-related error variants, bead fields in types and output structs), requires an external `bd` binary that refuses to run in worktrees, causes merge conflicts, and demands a painful temp-file dance for agent data passing. The orchestrator (implement skill) still references beads in its Bead Write Protocol, and agents still receive `bead_id` in their input contracts.

Phase 2 removes all of this. The orchestrator will use `tugcode state heartbeat`, `tugcode state update`, and `tugcode state artifact` instead of the Bead Write Protocol. Agents will no longer receive `bead_id`. The `tugcode commit` command drops bead close. Worktree create drops beads sync/init. The `tugcode status --full` bead enrichment is replaced by `tugcode state show`.

#### Strategy {#strategy}

- Remove all beads Rust code in a single atomic commit: delete `beads.rs`, `commands/beads/` directory, and `beads_tests.rs`; simultaneously remove beads types/fields from types.rs, config.rs, error.rs, parser.rs, validator.rs; remove beads output types and status --full mode; remove beads from worktree.rs, commit.rs, log.rs, merge.rs, init.rs, status.rs, cli.rs, main.rs, output.rs; remove bead assertions from integration_tests.rs. This must be one commit because removing bead fields from types immediately breaks all downstream consumers -- splitting across steps creates un-compilable intermediate states.
- Delete remaining beads test infrastructure (integration tests, bd-fake mock, golden fixtures) in a follow-up commit after the main code removal.
- Update the orchestrator skill (SKILL.md) and agent markdown files to remove the Bead Write Protocol and bead_id from input contracts, replacing with tugstate commands.
- Update tugplug/CLAUDE.md to replace the Beads Policy with a Tugstate Policy.
- Run a final comprehensive grep to verify zero beads references remain, with explicit exclusion patterns for plan files, the skeleton, and roadmap documents.

#### Stakeholders / Primary Customers {#stakeholders}

1. Tug orchestrator (implement skill) -- transitions from Bead Write Protocol to tugstate commands for step coordination.
2. Tug users -- simplified dependency footprint, no external `bd` binary needed.
3. Agent authors -- cleaner input contracts without bead_id field.

#### Success Criteria (Measurable) {#success-criteria}

- Zero beads references in executable code paths: the canonical grep `grep -ri "bead\|beads\|\.beads\|bd-fake\|bd_path" tugcode/ tugplug/ .gitignore --exclude-dir=.tugtool` returns zero matches. This single command is the source of truth -- it is used verbatim in Step 5 verification and in exit criteria.
- Exclusion rationale: `--exclude-dir=.tugtool` excludes `tugcode/.tugtool/tugplan-skeleton.md` (template containing beads documentation, deferred to follow-on) and any `tugplan-*.md` plan files. No other exclusions are needed because `roadmap/` is not under any search root (`tugcode/`, `tugplug/`, `.gitignore`).
- `cargo build` in `tugcode/` succeeds with zero warnings.
- `cargo nextest run` in `tugcode/` passes all tests (remaining tests after beads test deletion).
- The implement skill (SKILL.md) references only `tugcode state` commands for coordination, with zero beads references.
- Agent markdown files (architect, coder, reviewer, committer) contain no `bead_id` field or `tugcode beads` commands.
- `tugplug/CLAUDE.md` contains a "Tugstate Policy" section, not a "Beads Policy" section.
- `.gitignore` does not contain `.beads/` or `AGENTS.md` entries.

#### Scope {#scope}

1. Delete `tugtool-core/src/beads.rs` (1369 lines).
2. Delete `tugcode/src/commands/beads/` directory (mod.rs, sync.rs, status.rs, close.rs, pull.rs, link.rs, update.rs, inspect.rs).
3. Remove beads-related error variants (E012-E015, E035-E036) and types (InvalidBeadId, BeadsNotInitialized, BeadsRootNotFound, StepBeadNotFound, BeadsSyncFailed, BeadCommitFailed, BeadsNotInstalled, BeadsCommand) from `error.rs`.
4. Remove `BeadsConfig` struct and `beads` field from `config.rs`; remove `[tugtool.beads]` section from `TEMPLATE_CONFIG` in `init.rs`. Existing user `config.toml` files with `[tugtool.beads]` sections are silently ignored by serde (no warning, no error).
5. Remove `bead_id`, `beads_hints`, `BeadsHints`, `beads_root_id` from `types.rs`.
6. Remove `beads_hints` parsing from `parser.rs` (Bead:/Beads: line patterns, `parse_beads_hints` function, Beads Root metadata value extraction). Remove `"beads root"` from `KNOWN_METADATA_FIELDS` and remove `"Beads Root"` from the P004 suggestion string. Old plans with a `| Beads Root |` metadata row will trigger a harmless P004 informational diagnostic (non-blocking).
7. Remove bead ID validation from `validator.rs` (E012 check, W008 check, VALID_BEAD_ID regex).
8. Remove beads re-exports from `tugtool-core/src/lib.rs`.
9. Remove `pub mod beads;` from `commands/mod.rs` and all beads re-exports.
10. Remove `Beads(BeadsCommands)` variant from `cli.rs` Commands enum and match arm from `main.rs`.
11. Remove `bead_mapping`, `root_bead_id` from `CreateData` in `worktree.rs` (keep `all_steps`, `ready_steps` -- these are plan-derived, not beads-derived); remove beads sync/init call; delete `sync_beads_in_worktree()` and `commit_bead_annotations()` functions.
12. Remove bead close from `commit.rs`; remove `bead_closed`, `bead_id`, `bead_close_failed` from `CommitData`; remove `--bead` and `--close-reason` CLI args.
13. Remove `BeadStepStatus`, `BeadsCloseData` from `output.rs`; remove `bead_mapping`, `bead_steps`, `mode` from `StatusData`; remove `bead_id` from `StepInfo`.
14. Remove beads-enriched `--full` mode from `status.rs`.
15. Delete `tugcode/crates/tugtool-core/tests/beads_tests.rs`.
16. Delete `tugcode/crates/tugcode/tests/beads_integration_tests.rs`.
17. Delete `tugcode/tests/bin/bd-fake` and `tugcode/tests/integration/bd-fake-tests.sh`.
18. Delete golden fixture `tests/fixtures/golden/status_beads.json`.
19. Remove `--bead` parameter from log prepend CLI, `bead` parameter from `log_prepend_inner`/`generate_yaml_entry`/`run_log_prepend`, bead print from `run_log_prepend`, and all bead-related log tests.
20. Remove `.beads/` directory creation, beads.jsonl assertion, and 'tug beads status' error message from `merge.rs`.
21. Remove `[tugtool.beads]` section from `TEMPLATE_CONFIG` in `init.rs`; remove `remove_beads_hooks()`, `remove_beads_merge_driver()`, `clean_beads_gitattributes()` functions and their call sites; remove beads-related tests.
22. Remove bead-related assertions from `tugtool-core/tests/integration_tests.rs` (beads_root_id, bead_id field checks).
23. Update ALL cli.rs `long_about` strings containing beads references: Cli struct, Commit, Status, Merge, Log, and Worktree commands.
24. Update SKILL.md to remove Bead Write Protocol and use tugstate commands.
25. Update agent markdown files to remove `bead_id` from input contracts and `tugcode beads inspect` calls.
26. Replace "Beads Policy" in `tugplug/CLAUDE.md` with "Tugstate Policy".
27. Remove `.beads/` and `AGENTS.md` from `.gitignore`.
28. Delete straggler files: `merge.rs.bak`, `merge.rs.backup` (stale backups); update or delete `tugcode/tests/README.md` (contains beads test documentation).

#### Non-goals (Explicitly out of scope) {#non-goals}

- Adding new tugstate features beyond what Phase 1 delivered.
- Modifying the tugstate schema or commands.
- Multi-machine coordination (future tugcast work).
- Adding `tugcode state prune` command (separate future work).
- Changing the plan skill or planning agents (clarifier, author, critic).

#### Dependencies / Prerequisites {#dependencies}

- Phase 1 ("Add Tugstate") must be fully complete and merged -- all 11 tugstate commands are functional and tested.
- The `tugcode state` commands are the verified replacement for all beads functionality.

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` via `.cargo/config.toml`). Every commit must compile clean.
- Each step must leave the codebase in a compilable state (`cargo build` + `cargo clippy` pass). Full test suite (`cargo nextest run`) is required from Step 1 onward (Step 0 is compile-only because beads test files reference deleted types until Step 1 removes them).
- Agent contract version bumps to 2.0 (in-place modification, not new files).
- Orchestrator must never call `tugcode state reconcile` -- it is a manual recovery tool only.
- Tugstate failures during implementation are fatal (halt the implementation loop).
- The `tugcode/.tugtool/tugplan-skeleton.md` file contains "Beads Root" in its metadata table and "Bead:"/"Beads:" documentation. These are deferred to a follow-on task (not part of this phase) since the skeleton is a template, not executable code. Final grep verification uses `--exclude-dir=.tugtool` to skip this file and any plan files.

#### Assumptions {#assumptions}

- Phase 1 is fully complete and merged. All 11 tugstate commands are functional and tested.
- The orchestrator will replace beads sync/close/inspect calls with: `state claim` to get next step, `state start` to begin, heartbeat/artifact/update during step loop, `state complete` at commit time. Step identity comes from the claim response (`step_anchor`), not from a pre-built bead mapping.
- The tugstate `artifact` command will record architect strategy and reviewer verdict summaries (truncated to 500 chars) for audit trail.
- The worktree create command will call only `tugcode state init` (beads sync/init removed entirely).
- The commit command will call only `tugcode state complete` (bead close removed entirely); trailers already implemented in Phase 1.
- All beads tests (beads_integration_tests.rs) and the bd-fake mock will be deleted, no migration to tugstate equivalents needed.
- The `.beads/` directory pattern in .gitignore will be removed (no longer created).
- Error codes E012-E015, E035-E036 and beads-specific TugError variants will be removed.
- The BeadsConfig struct in config.rs will be removed; the `[tugtool.beads]` section in TEMPLATE_CONFIG (init.rs) will be removed. Existing user config.toml files with `[tugtool.beads]` are silently ignored by serde.
- The tugplug/CLAUDE.md "Beads Policy" section will be replaced with a "Tugstate Policy" stating that agents do not call tugstate commands directly (orchestrator-only).
- Heartbeats are synchronous: call `tugcode state heartbeat` after each agent completes (architect, coder, reviewer).
- Checklist updates happen after reviewer approves: mark tasks/checkpoints completed based on reviewer's conformance report.
- Tugstate failures are treated as fatal -- halt the implementation loop.
- Orchestrator never calls reconcile -- it is a manual recovery tool.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Cascade of compilation errors from removing beads types | med | high | Step 0 removes all beads Rust code atomically in one commit, preventing un-compilable intermediate states | Compilation errors still present after Step 0 completes |
| Agent markdown changes break orchestrator flow | high | med | Update SKILL.md and agents in the same step; test manually with a dry-run implementation | Orchestrator fails to parse agent output after update |
| Tests that indirectly depend on beads types break | med | med | Step 0 is compile-only; full test suite gated from Step 1 onward after beads test files are deleted | Test failures in non-beads test files |
| Old worktrees with .beads/ state become orphaned | low | high | .beads/ directories are per-worktree and gitignored; old worktrees can be cleaned up with `tugcode worktree cleanup` | User reports about stale .beads/ directories |

**Risk R01: Missing beads reference in obscure location** {#r01-missing-reference}

- **Risk:** A beads reference exists in a file not covered by the plan (e.g., documentation, build scripts, CI config).
- **Mitigation:** Final step runs the canonical grep (`grep -ri "bead\|beads\|\.beads\|bd-fake\|bd_path" tugcode/ tugplug/ .gitignore --exclude-dir=.tugtool`) to verify zero beads references remain. The success criteria are machine-verifiable.
- **Residual risk:** External documentation (outside the repo) may still reference beads workflows.

**Risk R02: Status command regression** {#r02-status-regression}

- **Risk:** Removing the `--full` beads-enriched mode from `tugcode status` loses functionality that users rely on.
- **Mitigation:** `tugcode state show` provides richer progress display than the old beads mode. The `--full` flag is removed, not replaced -- `tugcode state show` is the canonical progress view.
- **Residual risk:** Users who scripted against the old `--full` JSON output format will need to migrate to `state show` JSON.

---

### 2.0.0 Design Decisions {#design-decisions}

#### [D01] Delete beads.rs and commands/beads/ entirely (DECIDED) {#d01-delete-beads-module}

**Decision:** Delete the entire `tugtool-core/src/beads.rs` module (1369 lines) and the `tugcode/src/commands/beads/` directory (8 files) rather than deprecating or feature-gating them.

**Rationale:**
- Beads is not used by tugstate. There is no gradual deprecation path needed.
- Dead code increases maintenance burden and confuses new contributors.
- The `bd` binary dependency is the primary motivation for removal.

**Implications:**
- All beads re-exports from `lib.rs` must be removed.
- All beads command imports from `commands/mod.rs` must be removed.
- The `Beads(BeadsCommands)` variant in `cli.rs` must be removed.

#### [D02] Remove bead fields from types in-place (DECIDED) {#d02-remove-bead-fields}

**Decision:** Remove `bead_id`, `beads_hints`, and `BeadsHints` from `Step` and `Substep` types, and `beads_root_id` from `TugPlanMetadata`, rather than making them optional with deprecation warnings.

**Rationale:**
- These fields are never populated by tugstate. Keeping them creates confusion.
- After removing bead fields from types and the `Bead:`/`Beads:` regex patterns from parser.rs, old plan files with `**Bead:** \`bd-xxx\`` lines are silently ignored: the line does not match any strict pattern and does not trigger any near-miss diagnostic. For `Beads Root` metadata rows, `"beads root"` is removed from `KNOWN_METADATA_FIELDS`, so old plans with a `| Beads Root |` row will trigger a harmless P004 informational diagnostic (non-blocking for validation); the `_ => {}` catch-all in the metadata match block discards the value. A required parser compatibility test in Step 0 verifies both cases: silent pass-through for `Bead:` lines, expected P004 for `Beads Root` metadata rows.

**Implications:**
- Parser code that populates these fields must be removed.
- The `BEAD_LINE_RE`, `BEADS_HINTS_RE`, `BEADS_ROOT_RE` regex patterns are deleted. `"beads root"` is removed from `KNOWN_METADATA_FIELDS` and `"Beads Root"` is removed from the P004 suggestion string, ensuring the canonical grep finds zero matches in `parser.rs`.
- Any code that reads these fields (status.rs, beads commands) will fail to compile, forcing complete removal.
- Serialized JSON output contracts change (fields disappear); agent contract version bumps to 2.0.

#### [D03] Remove BeadsConfig from config.rs entirely (DECIDED) {#d03-remove-beads-config}

**Decision:** Remove the `BeadsConfig` struct, the `beads` field from `TugConfig`, and all beads-related default functions from `config.rs`.

**Rationale:**
- No code will reference beads configuration after removal.
- Existing `config.toml` files that contain a `[tugtool.beads]` section will be silently ignored by serde (unknown fields are skipped with `#[serde(default)]`).

**Implications:**
- Users with existing `config.toml` files do not need to manually edit them; the `[tugtool.beads]` section is harmlessly ignored.
- The `ValidationConfig.beads_enabled` and `validate_bead_ids` fields must also be removed.
- The `TEMPLATE_CONFIG` constant in `init.rs` must have its `[tugtool.beads]` section removed so newly-initialized projects do not write dead configuration.

#### [D04] Remove beads error variants and error codes (DECIDED) {#d04-remove-error-variants}

**Decision:** Remove TugError variants `InvalidBeadId` (E012), `BeadsNotInitialized` (E013), `BeadsRootNotFound` (E014), `StepBeadNotFound` (E015), `BeadsSyncFailed` (E035), `BeadCommitFailed` (E036), `BeadsNotInstalled`, and `BeadsCommand`. Leave the error code numbers as gaps (never reuse).

**Rationale:**
- These error variants are only used by beads code. No other code references them.
- Leaving gaps in error code numbering prevents confusion if old error messages appear in logs.

**Implications:**
- All `code()`, `exit_code()`, and `line()` match arms for these variants must be removed.
- Tests that reference these error variants must be removed or updated.

#### [D05] Replace Bead Write Protocol with tugstate commands in SKILL.md (DECIDED) {#d05-replace-bead-protocol}

**Decision:** Remove the entire Bead Write Protocol section from SKILL.md. Replace bead-related orchestrator steps with tugstate commands: `tugcode state heartbeat` after each agent completes, `tugcode state artifact` to record strategy/verdict summaries, `tugcode state update` to mark checklist items after reviewer approval.

**Rationale:**
- The Bead Write Protocol involves temp files, `tugcode beads append-design/update-notes/append-notes`, and cleanup. This is replaced by three simpler tugstate CLI calls.
- Agents no longer write temp files for the orchestrator. Data flow is orchestrator-managed via tugstate.

**Implications:**
- SKILL.md orchestrator loop control changes entirely: step selection moves from iterating a pre-built `bead_mapping` to calling `tugcode state claim` for the next ready step; step identity changes from `bead_id` to `step_anchor`.
- All "Bead write" blocks (temp file + beads append/update + cleanup) are replaced by single-line `tugcode state heartbeat`/`artifact` calls.
- Agent temp file writing instructions must be removed from agent markdown files.
- The committer-agent input contract loses `bead_id` and `close_reason` fields.

#### [D06] Synchronous heartbeats after each agent completes (DECIDED) {#d06-sync-heartbeats}

**Decision:** The orchestrator calls `tugcode state heartbeat` after each agent call completes (architect, coder, reviewer). This is synchronous -- one heartbeat per agent completion, not periodic background heartbeats.

**Rationale:**
- The orchestrator is a single-threaded skill that calls agents sequentially. Background heartbeats would require a timer mechanism that does not exist in the skill framework.
- Each agent call takes minutes, well within the 2-hour lease. Three heartbeats per step (post-architect, post-coder, post-reviewer) is sufficient.

**Implications:**
- The orchestrator adds one Bash call (`tugcode state heartbeat`) after each agent Task call.
- If an agent call takes more than 2 hours, the lease could expire. This is mitigated by the generous default and the fact that implementation steps are designed to be small.

#### [D07] Halt on tugstate failure (DECIDED) {#d07-halt-on-failure}

**Decision:** During Phase 2, tugstate failures are fatal at the orchestrator level. If any `tugcode state` command fails during the implementation loop, the orchestrator halts immediately. The `tugcode commit` CLI itself remains composable: it exits 0 if the git commit succeeds, regardless of whether `state complete` fails, and reports `state_update_failed: true` in its JSON output. The orchestrator (SKILL.md) treats `state_update_failed: true` in the commit response as fatal and halts.

**Rationale:**
- In Phase 1, state failures were non-fatal because beads was the source of truth. In Phase 2, tugstate IS the source of truth. A state failure means coordination data is lost.
- Halting preserves the git commit (source of truth for code) and allows manual recovery via `tugcode state reconcile`.
- Keeping the CLI at exit 0 on git-commit-success preserves composability for non-orchestrator callers (scripts, manual use). The strict behavior is enforced by the orchestrator, not the CLI.

**Implications:**
- The orchestrator must check the `state_update_failed` field in the commit JSON response and halt if true.
- The orchestrator must also check exit codes from all other `tugcode state` commands (heartbeat, artifact, update).
- The CLI exit code for `tugcode commit` is unchanged from Phase 1: exit 0 if git commit succeeds, nonzero only if git commit fails.

#### [D08] Agent contract version 2.0 (DECIDED) {#d08-agent-contract-v2}

**Decision:** Update agent markdown files in-place to remove `bead_id` from input contracts. Bump contract version to 2.0 by updating the input contract documentation in each agent file.

**Rationale:**
- Agents do not need step identity -- the orchestrator manages that via tugstate.
- In-place modification is simpler than maintaining two contract versions.

**Implications:**
- All four implementation agents (architect, coder, reviewer, committer) have their input contracts updated.
- The orchestrator (SKILL.md) no longer passes `bead_id` in agent spawn data.
- Agent `tugcode beads inspect` calls are removed (agents no longer read bead data).

#### [D09] Remove --full from status, recommend state show (DECIDED) {#d09-remove-full-status}

**Decision:** Remove the `--full` flag from `tugcode status` and the entire beads-enriched status mode. Users should use `tugcode state show` for detailed progress.

**Rationale:**
- `tugcode state show` provides richer progress display (tasks/tests/checkpoints with counts, lease info, force-completion annotations) than the old beads mode.
- Maintaining two progress display paths adds complexity.

**Implications:**
- The `--full` flag is removed from the `Status` CLI variant.
- All beads-related status functions (`classify_steps`, `build_beads_status_data`, `format_beads_text`, `output_beads_text`) are deleted.
- `StatusData` loses `bead_mapping`, `bead_steps`, and `mode` fields.
- `StepInfo` loses `bead_id` field.

#### [D10] Clean up .gitignore beads entries (DECIDED) {#d10-gitignore-cleanup}

**Decision:** Remove the `.beads/` directory pattern and the `AGENTS.md` entry from `.gitignore`.

**Rationale:**
- `.beads/` directories are no longer created by any tug command.
- `AGENTS.md` was an artifact of `bd init` that is no longer run.

**Implications:**
- Old worktrees that still have `.beads/` directories will have them shown as untracked files if they are revisited. This is acceptable -- those worktrees should be cleaned up.

---

### 2.0.1 Symbol Inventory {#symbol-inventory}

#### 2.0.1.1 Files to delete {#files-to-delete}

**List L01: Deleted files** {#l01-deleted-files}

- tugtool-core/src/beads.rs -- Core beads module (~1369 lines)
- commands/beads/mod.rs -- Beads command enum and re-exports
- commands/beads/sync.rs -- Beads sync command
- commands/beads/status.rs -- Beads status command
- commands/beads/close.rs -- Beads close command
- commands/beads/pull.rs -- Beads pull command
- commands/beads/link.rs -- Beads link command
- commands/beads/update.rs -- Beads update/append-notes/append-design commands
- commands/beads/inspect.rs -- Beads inspect command
- tugtool-core/tests/beads_tests.rs -- Beads unit tests (imports from beads.rs)
- tests/beads_integration_tests.rs -- Beads integration tests
- tests/bin/bd-fake -- Mock bd binary for testing
- tests/integration/bd-fake-tests.sh -- bd-fake test runner
- tests/.bd-fake-state/ -- bd-fake state directory (deps.json, issues.json)
- commands/merge.rs.bak -- Stale backup file containing beads references
- commands/merge.rs.backup -- Stale backup file containing beads references
- tests/README.md -- Contains "Beads fake and integration tests" (update or delete)

#### 2.0.1.2 Files to modify {#files-to-modify}

**List L02: Modified files** {#l02-modified-files}

**tugtool-core changes:**
- lib.rs -- Remove `pub mod beads;`, all beads re-exports, remove BeadsHints from types re-export
- types.rs -- Remove bead_id, beads_hints, BeadsHints from Step/Substep, beads_root_id from TugPlanMetadata
- config.rs -- Remove BeadsConfig struct, beads field from TugConfig, all beads default functions
- error.rs -- Remove E012-E015, E035-E036 variants and match arms; remove BeadsNotInstalled, BeadsCommand
- parser.rs -- Remove Bead:/Beads:/Beads Root line parsing, parse_beads_hints() function
- validator.rs -- Remove VALID_BEAD_ID regex, E012/W008 checks, beads_enabled/validate_bead_ids from ValidationConfig

**tugtool-core test changes:**
- tests/integration_tests.rs -- Remove bead-related assertions: beads_root_id check, bead_id field check on steps

**Test fixture changes:**
- tests/fixtures/valid/agent-output-example.md -- Update to remove bead IDs, bead references, Beads Root metadata, and bead-related decision/deliverables; replace with tugstate equivalents
- tests/fixtures/valid/enrichment-test.md -- Update purpose text to remove "bead enrichment" reference
- tests/fixtures/golden/root-description.md -- Update description text to remove "bead enrichment" reference
- tests/fixtures/golden/status_fallback.json -- Remove `bead_mapping` field from JSON

**Integration test changes:**
- tests/worktree_integration_tests.rs -- Update 5 `#[ignore]` annotation strings to remove "requires beads service" / "beads sync is always-on" text
- tests/agent_integration_tests.rs -- Delete or rewrite `test_committer_documents_beads_integration()` test (asserts committer-agent.md contains "bead", which will fail after Step 3 removes bead references from that file)

**tugcode CLI changes:**
- commands/mod.rs -- Remove `pub mod beads;` and all beads re-exports
- commands/init.rs -- Remove `[tugtool.beads]` section from TEMPLATE_CONFIG; remove `remove_beads_hooks()`, `remove_beads_merge_driver()`, `clean_beads_gitattributes()` functions and their call sites; remove beads-related tests
- commands/worktree.rs -- Remove bead_mapping, root_bead_id from CreateData; delete sync_beads_in_worktree() and commit_bead_annotations() functions
- commands/commit.rs -- Remove bead close call; remove --bead/--close-reason handling; simplify to git commit + state complete
- commands/log.rs -- Remove --bead CLI parameter from Prepend variant; remove bead parameter from log_prepend_inner, generate_yaml_entry, and run_log_prepend; remove bead print in run_log_prepend; update/delete bead-related log tests
- commands/merge.rs -- Remove .beads/ directory creation in test helper; remove beads.jsonl assertion; replace 'tug beads status' error message string with tugstate equivalent
- commands/status.rs -- Remove --full beads mode; remove classify_steps(), build_beads_status_data(), format_beads_text(), output_beads_text()
- output.rs -- Remove BeadStepStatus, BeadsCloseData; remove bead_mapping/bead_steps/mode from StatusData; remove bead_id from StepInfo; remove bead_closed/bead_id/bead_close_failed from CommitData
- cli.rs -- Remove Beads(BeadsCommands) variant; remove --bead/--close-reason from Commit; remove --full from Status; update ALL long_about strings containing beads references (Cli struct, Commit, Status, Merge, Log, Worktree commands); update/delete bead-related CLI tests
- main.rs -- Remove Beads match arm; remove bead field from Commit and Log Prepend destructures

**Infrastructure and plugin changes:**
- .gitignore -- Remove .beads/ and AGENTS.md entries
- tugplug/CLAUDE.md -- Replace "Beads Policy" with "Tugstate Policy"
- tugplug/skills/implement/SKILL.md -- Remove Bead Write Protocol; replace bead_mapping with tugstate commands; add heartbeat/update/artifact calls
- tugplug/agents/architect-agent.md -- Remove bead_id from input contract; remove tugcode beads inspect call; remove temp file writing
- tugplug/agents/coder-agent.md -- Remove bead_id from input contract; remove tugcode beads inspect call; remove temp file writing
- tugplug/agents/reviewer-agent.md -- Remove bead_id from input contract; remove tugcode beads inspect call; remove temp file writing
- tugplug/agents/committer-agent.md -- Remove bead_id and close_reason from input contract; update tugcode commit invocation
- tugplug/agents/auditor-agent.md -- Remove references to "bead notes"

---

### 2.0.2 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Compilation** | Verify each step leaves the codebase compilable | Every step |
| **Integration** | Verify existing non-beads tests still pass | Every step |
| **Grep verification** | Confirm zero beads references remain | Final step |

#### Test Strategy {#test-strategy}

This phase is primarily a deletion/removal phase. The key testing concern is ensuring nothing breaks during removal. Step 0 uses a relaxed checkpoint (compile + clippy only) because beads integration test files still reference deleted types and will fail as test binaries. Step 1 deletes those test files and is the first step that gates on the full `cargo nextest run`. All subsequent steps gate on both compilation and full test suite. The final step performs a comprehensive grep to verify zero beads references remain in executable code paths.

Beads-specific tests are deleted, not migrated. The tugstate commands already have their own comprehensive test suite from Phase 1.

---

### 2.0.3 Execution Steps {#execution-steps}

#### Step 0: Remove all beads Rust code atomically {#step-0}

**Commit:** `refactor!: remove all beads code, types, config, errors, and CLI commands`

**References:** [D01] Delete beads module, [D02] Remove bead fields, [D03] Remove BeadsConfig, [D04] Remove error variants, [D09] Remove --full status, List L01, List L02, (#d01-delete-beads-module, #d02-remove-bead-fields, #d03-remove-beads-config, #d04-remove-error-variants, #d09-remove-full-status, #l01-deleted-files, #l02-modified-files)

> This is a large step because removing bead fields from types.rs immediately breaks every file that reads those fields (status.rs, worktree.rs, commit.rs, output.rs, parser.rs, validator.rs, etc.). Splitting into multiple commits creates un-compilable intermediate states that violate the constraint "each step must leave the codebase compilable." All beads Rust code is removed in one atomic commit.
>
> **Checkpoint note:** Step 0 verifies compile + clippy only. Beads integration tests (`beads_integration_tests.rs`) and the `bd-fake` mock still exist after Step 0 and may fail `cargo nextest run` because their imports/linkage to deleted beads types cause test-binary compile failures. The full `cargo nextest run` gate moves to Step 1, which deletes these test files.

**Artifacts:**
- Deleted `tugcode/crates/tugtool-core/src/beads.rs`
- Deleted `tugcode/crates/tugtool-core/tests/beads_tests.rs`
- Deleted directory `tugcode/crates/tugcode/src/commands/beads/` (all 8 files)
- Modified `tugcode/crates/tugtool-core/src/lib.rs`
- Modified `tugcode/crates/tugtool-core/src/types.rs`
- Modified `tugcode/crates/tugtool-core/src/config.rs`
- Modified `tugcode/crates/tugtool-core/src/error.rs`
- Modified `tugcode/crates/tugtool-core/src/parser.rs`
- Modified `tugcode/crates/tugtool-core/src/validator.rs`
- Modified `tugcode/crates/tugtool-core/tests/integration_tests.rs`
- Modified `tugcode/crates/tugcode/src/commands/mod.rs`
- Modified `tugcode/crates/tugcode/src/commands/init.rs`
- Modified `tugcode/crates/tugcode/src/commands/worktree.rs`
- Modified `tugcode/crates/tugcode/src/commands/commit.rs`
- Modified `tugcode/crates/tugcode/src/commands/log.rs`
- Modified `tugcode/crates/tugcode/src/commands/merge.rs`
- Modified `tugcode/crates/tugcode/src/commands/status.rs`
- Modified `tugcode/crates/tugcode/src/output.rs`
- Modified `tugcode/crates/tugcode/src/cli.rs`
- Modified `tugcode/crates/tugcode/src/main.rs`

**Tasks:**

*Delete files:*
- [ ] Delete `tugcode/crates/tugtool-core/src/beads.rs`
- [ ] Delete `tugcode/crates/tugtool-core/tests/beads_tests.rs` (imports `tugtool_core::beads::is_valid_bead_id` -- will fail to compile after beads.rs deletion)
- [ ] Delete the entire `tugcode/crates/tugcode/src/commands/beads/` directory (mod.rs, sync.rs, status.rs, close.rs, pull.rs, link.rs, update.rs, inspect.rs)

*tugtool-core lib.rs:*
- [ ] Remove `pub mod beads;` from lib.rs
- [ ] Remove all beads re-exports: `BeadStatus`, `BeadsCli`, `CloseReasonParsed`, `Issue`, `IssueDetails`, `is_valid_bead_id`, `parse_close_reason`
- [ ] Remove `BeadsConfig` from config re-exports
- [ ] Remove `BeadsHints` from types re-exports

*tugtool-core types.rs:*
- [ ] Remove `bead_id: Option<String>` and `beads_hints: Option<BeadsHints>` fields from the `Step` struct
- [ ] Remove `bead_id: Option<String>` and `beads_hints: Option<BeadsHints>` fields from the `Substep` struct
- [ ] Remove `beads_root_id: Option<String>` field from the `TugPlanMetadata` struct
- [ ] Delete the entire `BeadsHints` struct definition
- [ ] Update doc comments that contain "bead" (lines ~472, ~494, ~508): change "Render the root bead description" to "Render the plan root description", "Render the root bead design" to "Render the plan root design", "Render the root bead acceptance criteria" to "Render the plan root acceptance criteria"

*tugtool-core config.rs:*
- [ ] Delete the entire `BeadsConfig` struct definition
- [ ] Remove the `beads: BeadsConfig` field from `TugConfig`
- [ ] Remove `beads: BeadsConfig::default()` from the `TugConfig` `Default` impl
- [ ] Delete all beads default functions: `default_beads_enabled`, `default_validate_bead_ids`, `default_bd_path`, `default_root_issue_type`, `default_substeps`, `default_pull_checkbox_mode`, `default_pull_warn`
- [ ] Delete the `impl Default for BeadsConfig` block
- [ ] Update the `test_default_config` test to remove the `assert!(config.tugtool.beads.enabled)` assertion

*tugtool-core error.rs:*
- [ ] Remove TugError variants: `InvalidBeadId` (E012), `BeadsNotInitialized` (E013), `BeadsRootNotFound` (E014), `StepBeadNotFound` (E015), `BeadsNotInstalled`, `BeadsCommand`, `BeadsSyncFailed` (E035), `BeadCommitFailed` (E036)
- [ ] Remove all `code()` match arms for the removed variants
- [ ] Remove all `exit_code()` match arms for the removed variants
- [ ] Remove the `InvalidBeadId` match arm from the `line()` method
- [ ] Remove or update tests referencing removed variants (e.g., `test_error_codes` that asserts `BeadsNotInitialized` returns E013)

*tugtool-core parser.rs:*
- [ ] Remove the `BEAD_LINE_RE` static regex, `BEADS_HINTS_RE` static regex, and `BEADS_ROOT_RE` static regex
- [ ] Remove `"beads root"` from the `KNOWN_METADATA_FIELDS` array (old plans with `| Beads Root |` metadata rows will trigger a harmless P004 informational diagnostic, which is non-blocking)
- [ ] Remove `"Beads Root"` from the P004 suggestion string (line ~278: `"Known fields: Owner, Status, Target branch, Tracking issue/PR, Last updated, Beads Root"` becomes `"Known fields: Owner, Status, Target branch, Tracking issue/PR, Last updated"`)
- [ ] Remove the code block that checks for `Beads Root` in metadata and sets `tugplan.metadata.beads_root_id`
- [ ] Remove the code blocks that parse `**Bead:**` lines (setting `step.bead_id`/`substep.bead_id`) and `**Beads:**` hints lines (setting `step.beads_hints`/`substep.beads_hints`)
- [ ] Delete the `parse_beads_hints()` function entirely
- [ ] Remove `BeadsHints` from the `crate::types` import
- [ ] Remove or update tests: `test_parse_bead_line`, `test_parse_beads_hints`
- [ ] Add parser compatibility test `test_historical_bead_lines_parse_without_error`: construct a plan fixture containing `| Beads Root | \`bd-root1\` |` in the metadata table and `**Bead:** \`bd-step0\`` and `**Beads:** type=task, priority=1` inside a step block. Parse it and assert: (a) parsing succeeds (no error), (b) `**Bead:**` and `**Beads:**` lines inside steps produce no diagnostics (silently unmatched), (c) the `| Beads Root |` metadata row produces exactly one P004 diagnostic with code `"P004"` and message containing `"Beads Root"` (harmless informational, non-blocking), (d) the plan's steps are parsed correctly (step title, anchor present). This test is the verification for [D02] backward compatibility.

*tugtool-core validator.rs:*
- [ ] Remove the `VALID_BEAD_ID` static regex
- [ ] Remove `beads_enabled: bool` and `validate_bead_ids: bool` fields from `ValidationConfig`
- [ ] Remove the `check_bead_id_format` function and its call (E012 check)
- [ ] Remove the `check_bead_without_integration` function and its call (W008 check)
- [ ] Remove or update tests: `test_e012_invalid_bead_id`, `test_w008_bead_without_integration`, `test_valid_bead_id_format`

*tugcode commands/mod.rs:*
- [ ] Remove `pub mod beads;` and all beads re-exports: `BeadsCommands`, `run_append_design`, `run_append_notes`, `run_beads_status`, `run_close`, `run_inspect`, `run_link`, `run_pull`, `run_sync`, `run_update_notes`

*tugcode cli.rs:*
- [ ] Remove `BeadsCommands` import
- [ ] Remove the `Beads(BeadsCommands)` variant from the `Commands` enum
- [ ] Remove the `--bead` arg from the `Commit` variant
- [ ] Remove the `--close-reason` arg from the `Commit` variant
- [ ] Remove the `--full` arg from the `Status` variant
- [ ] Update `Cli` struct `long_about` (line ~15): remove "and integrate with beads for execution tracking" -- replace with "and manage state for execution tracking"
- [ ] Update `Status` variant `long_about` (line ~88): remove "Use --full to include bead-enriched status (bead IDs, commit info, block status)." -- replace with "Use 'tugcode state show' for detailed execution state."
- [ ] Update `Worktree` variant `long_about` (line ~117): remove "optionally sync beads" from create description and "--sync-beads" from example workflow
- [ ] Update `Log` variant `long_about` (line ~133): remove "automatic rotation happens via beads close and committer" -- replace with "automatic rotation happens via commit"
- [ ] Update `Merge` variant `long_about` (line ~149): in "Infrastructure files" list, remove ".beads/*, CLAUDE.md" entry
- [ ] Update `Commit` variant `long_about` (line ~191): remove "5. Close bead" from atomic sequence; remove "Partial success: If commit succeeds but bead close fails, exits 0 with bead_close_failed=true." -- replace with "Partial success: If commit succeeds but state complete fails, exits 0 with state_update_failed=true."
- [ ] Update `Commit` variant about (line ~189): remove "and bead close" from "Atomically performs log rotation, prepend, git commit, and bead close."
- [ ] Update tests: `test_commit_command` and `test_commit_with_close_reason` (remove `--bead`/`--close-reason` args); delete `test_status_command_with_full`; delete or update `test_log_prepend_command_with_bead` (remove `--bead` arg and bead assertions)

*tugcode main.rs:*
- [ ] Remove the `Beads` match arm (the entire `Commands::Beads(cmd) => { ... }` block)
- [ ] Remove the `bead` field from the `Commit` match arm destructure and remove `bead` and `close_reason` from the `run_commit` call
- [ ] Remove the `bead` field from the `Log Prepend` match arm destructure and remove `bead` from the `run_log_prepend` call

*tugcode output.rs:*
- [ ] Delete `BeadStepStatus` struct entirely
- [ ] Delete `BeadsCloseData` struct entirely
- [ ] Remove `bead_mapping`, `bead_steps`, `mode` from `StatusData`
- [ ] Remove `bead_id` from `StepInfo`
- [ ] Remove `bead_closed`, `bead_id`, `bead_close_failed` from `CommitData`
- [ ] Update `CommitData` tests to remove bead fields
- [ ] Delete `BeadStepStatus` serialization tests

*tugcode commands/status.rs:*
- [ ] Delete `classify_steps()`, `build_beads_status_data()`, `format_beads_text()`, `output_beads_text()` functions
- [ ] Remove the `if let Some(ref root_id) = plan.metadata.beads_root_id` block
- [ ] Remove `BeadsCli`, `IssueDetails` and other beads imports; remove `BeadStepStatus` import
- [ ] Remove all `bead_mapping: None`, `bead_steps: None`, `mode: None` from StatusData construction sites
- [ ] Remove `bead_id` assignments from StepInfo construction sites (including in `build_checkbox_status_data`)
- [ ] Remove or update all beads tests: `test_golden_beads_status_json` and any test referencing beads types or functions

*tugcode commands/worktree.rs:*
- [ ] Delete the `sync_beads_in_worktree()` function entirely
- [ ] Delete the `commit_bead_annotations()` function entirely
- [ ] Remove `bead_mapping`, `root_bead_id` from `CreateData` (these are pure beads artifacts with no tugstate equivalent)
- [ ] KEEP `all_steps` and `ready_steps` in `CreateData` -- these are plan-derived fields (populated from the parsed plan, not from beads) and are still useful for orchestrator step counting
- [ ] Remove the call to `sync_beads_in_worktree()` and `commit_bead_annotations()` from `run_worktree_create()`
- [ ] Update all `CreateData` construction sites to remove deleted fields
- [ ] Update the `Create` variant `long_about` help text in worktree.rs (if defined there) or cli.rs (if defined there): replace "Beads sync is always-on:\n  - Atomically syncs beads and commits annotations in worktree\n  - Full rollback if sync or commit fails" with text describing tugstate initialization
- [ ] Remove the worktree test that verifies "create help should document always-on beads sync"

*tugcode commands/commit.rs:*
- [ ] Remove the bead close logic (call to close bead after git commit)
- [ ] Remove the `bead` and `close_reason` parameters from `run_commit` function signature
- [ ] Update `run_commit` doc comment to remove "bead close" references
- [ ] In `error_response()` helper: remove `bead_closed`, `bead_id`, `bead_close_failed` from CommitData construction
- [ ] In success path: remove `bead_closed`, `bead_id`, `bead_close_failed` from CommitData construction
- [ ] Update the `log_prepend_inner` call to remove the bead argument

*tugcode commands/log.rs:*
- [ ] Remove the `--bead` (`bead: Option<String>`) CLI parameter from the `Prepend` variant of `LogCommands`
- [ ] Remove `bead: Option<&str>` parameter from `log_prepend_inner()` function signature and all its call sites
- [ ] Remove the `if let Some(bead_id) = bead` block from `generate_yaml_entry()` that writes `bead: {bead_id}` to YAML
- [ ] Remove the `bead` parameter from `generate_yaml_entry()` function signature
- [ ] Remove the `if let Some(bead_id) = bead { println!("  Bead: {}", bead_id); }` block from `run_log_prepend()`
- [ ] Remove the `bead` parameter from `run_log_prepend()` function signature
- [ ] Update `long_about` text for `Prepend` to remove "Optional bead ID" and "\n  - Optional bead ID\n" references
- [ ] Delete test `test_yaml_entry_generation_no_bead` (tests the no-bead case, which becomes the only case)
- [ ] Update test that asserts `entry.contains("bead: bd-123")` -- remove the bead parameter from `generate_yaml_entry` call and remove the bead assertion (line ~730)
- [ ] Update test at line ~808 that asserts `new_content.contains("bead: bd-123")` -- remove the bead assertion

*tugcode commands/merge.rs:*
- [ ] Remove `fs::create_dir_all(temp_path.join(".beads"))` and `fs::write(temp_path.join(".beads/beads.jsonl"), "{}")` from test helper (line ~1785-1786)
- [ ] Remove `assert!(files.untracked.contains(&".beads/beads.jsonl".to_string()))` from test (line ~1792)
- [ ] Replace error message `"tug beads status"` with `"tugcode state show"` (line ~1961)

*tugcode commands/init.rs:*
- [ ] Remove the entire `[tugtool.beads]` section from `TEMPLATE_CONFIG` (lines ~27-52: `[tugtool.beads]` through `pull_warn_on_conflict = true`)
- [ ] Delete the `remove_beads_hooks()` function entirely (scans .git/hooks/ for files containing "bd " or "beads" and removes them)
- [ ] Delete the `remove_beads_merge_driver()` function entirely (removes `merge.beads.driver` and `merge.beads.name` from .git/config)
- [ ] Delete the `clean_beads_gitattributes()` function entirely (removes `merge=beads` lines from .gitattributes)
- [ ] Remove the call to `remove_beads_hooks()` in `run_init()` (line ~132) and `run_init_check()` (line ~205-206)
- [ ] Remove the call to `remove_beads_merge_driver()` in `run_init()` (line ~142-143) and `run_init_check()` (line ~222-223)
- [ ] Remove the call to `clean_beads_gitattributes()` in `run_init()` (line ~147-148) and `run_init_check()` (line ~227-228)
- [ ] Remove the "Remove beads git hooks" and "Remove stale beads merge driver" and "Remove stale beads entries from .gitattributes" comment blocks
- [ ] Delete tests: `test_remove_beads_hooks_removes_bd_hook`, `test_remove_beads_hooks_preserves_non_bd_hook`, `test_remove_beads_hooks_no_git_dir`

*tugtool-core tests/integration_tests.rs:*
- [ ] Remove the assertion `assert!(plan.metadata.beads_root_id.is_some(), "Should have beads root ID")` (line ~213-215). BUILD-BREAKER: this references the `beads_root_id` field removed from `TugPlanMetadata` in types.rs and will fail to compile.
- [ ] Remove the `step_with_bead` assertion block (lines ~217-221): `let step_with_bead = plan.steps.iter().find(|s| s.bead_id.is_some()); assert!(step_with_bead.is_some(), ...)`. BUILD-BREAKER: this references the `bead_id` field removed from `Step` in types.rs.
- [ ] Remove or update the comment `"Check no errors (warnings are OK for bead IDs when beads not enabled)"` (line ~199) to remove the bead reference

**Tests:**
- [ ] Compilation test: `cargo build` succeeds with no warnings
- [ ] Lint test: `cargo clippy` succeeds with no warnings
- [ ] Parser compatibility test: `test_historical_bead_lines_parse_without_error` passes -- verifies old plans with `Bead:`/`Beads Root:` lines parse without error (`Bead:` lines silent, `Beads Root` metadata row emits harmless P004)
- [ ] Note: Full `cargo nextest run` is NOT required here -- beads integration test files still reference deleted types and will fail to compile as test binaries. Run only the tugtool-core tests: `cargo nextest run -p tugtool-core` to verify the parser compatibility test passes. Full test suite gate moves to Step 1.

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo clippy -- -D warnings` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run -p tugtool-core` passes (verifies parser compatibility test and other tugtool-core tests)
- [ ] `grep -r "pub mod beads\|BeadsHints\|BeadsConfig\|BeadStepStatus\|BeadsCloseData\|InvalidBeadId\|BeadsNotInitialized\|bead_mapping\|bead_close\|sync_beads\|commit_bead_annotations\|remove_beads_hooks\|beads_merge_driver\|beads_gitattributes\|tugtool\.beads" tugcode/crates/ --exclude-dir=tests` returns no matches (--exclude-dir=tests skips tugcode/crates/tugcode/tests/ where beads_integration_tests.rs still exists until Step 1; this exclusion is Step 0 only -- the canonical Step 5 grep covers everything)

**Rollback:**
- Revert all changes from git (single commit revert).

**Commit after all checkpoints pass.**

---

#### Step 1: Delete beads tests, bd-fake mock, straggler files, and golden fixtures {#step-1}

**Depends on:** #step-0

**Commit:** `test: delete beads integration tests, bd-fake mock, straggler files, and golden fixtures`

**References:** [D01] Delete beads module, List L01, (#d01-delete-beads-module, #l01-deleted-files)

**Artifacts:**
- Deleted `tugcode/crates/tugcode/tests/beads_integration_tests.rs`
- Deleted `tugcode/tests/bin/bd-fake`
- Deleted `tugcode/tests/integration/bd-fake-tests.sh`
- Deleted `tugcode/tests/.bd-fake-state/` directory (deps.json, issues.json)
- Deleted `tugcode/crates/tugcode/src/commands/merge.rs.bak` (stale backup)
- Deleted `tugcode/crates/tugcode/src/commands/merge.rs.backup` (stale backup)
- Updated or deleted `tugcode/tests/README.md` (contains "Beads fake and integration tests")
- Deleted `tugcode/tests/fixtures/golden/status_beads.json`
- Modified `tugcode/tests/fixtures/valid/agent-output-example.md` (removed bead references)
- Modified `tugcode/tests/fixtures/valid/enrichment-test.md` (removed bead reference in purpose)
- Modified `tugcode/tests/fixtures/golden/root-description.md` (removed bead reference in description)
- Modified `tugcode/tests/fixtures/golden/status_fallback.json` (removed `bead_mapping` field)
- Modified `tugcode/crates/tugcode/tests/worktree_integration_tests.rs` (updated `#[ignore]` annotation strings to remove beads references)

**Tasks:**

*Delete beads test infrastructure:*
- [ ] Delete `tugcode/crates/tugcode/tests/beads_integration_tests.rs`
- [ ] Delete `tugcode/tests/bin/bd-fake`
- [ ] Delete `tugcode/tests/integration/bd-fake-tests.sh`
- [ ] Delete the entire `tugcode/tests/.bd-fake-state/` directory (contains deps.json, issues.json)
- [ ] Delete `tugcode/crates/tugcode/src/commands/merge.rs.bak` (stale backup file containing beads references)
- [ ] Delete `tugcode/crates/tugcode/src/commands/merge.rs.backup` (stale backup file containing beads references)
- [ ] Update `tugcode/tests/README.md`: remove the "Beads fake and integration tests" section and all content describing bd-fake, bead workflows, and beads integration tests. If the file becomes empty or content-free after removal, delete it entirely.
- [ ] Delete `tugcode/tests/fixtures/golden/status_beads.json`

*Clean bead references from test fixtures:*
- [ ] Update `tugcode/tests/fixtures/valid/agent-output-example.md`: remove all bead IDs, `Beads Root` metadata row, `**Bead:**` lines in steps, bead-related decision `[D01] Use Standard Bead Format`, bead references in Purpose/Context/Deliverables; replace with tugstate equivalents where appropriate. The fixture must remain a valid parseable plan after edits.
- [ ] Update `tugcode/tests/fixtures/valid/enrichment-test.md`: change purpose text from "bead enrichment content rendering" to "content rendering" (or similar non-bead phrasing)
- [ ] Update `tugcode/tests/fixtures/golden/root-description.md`: change description text from "bead enrichment content rendering" to "content rendering" (or similar non-bead phrasing)
- [ ] Update `tugcode/tests/fixtures/golden/status_fallback.json`: remove the `"bead_mapping": {}` field from the JSON
- [ ] Update `tugcode/crates/tugcode/tests/worktree_integration_tests.rs`: rewrite the 5 `#[ignore]` annotation strings (lines ~151, ~391, ~447, ~569, ~799) that contain "requires beads service" or "beads sync is always-on" to remove beads references (e.g., change to "requires external service" or a description of the actual precondition without mentioning beads)
- [ ] Run `grep -ri "bead\|beads\|bd-fake\|bd_path\|\.beads" tugcode/tests/` to verify zero bead references remain in test infrastructure and fixtures
- [ ] Verify no remaining test files import beads types or reference beads test fixtures

**Tests:**
- [ ] Compilation test: `cargo build` succeeds with no warnings
- [ ] Full test suite: `cargo nextest run` passes all remaining tests (this is the first step where the full test suite must pass, since beads test files that referenced deleted types are now removed)

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes (full test suite gate -- first step where this is required)
- [ ] `ls tugcode/crates/tugcode/tests/beads_integration_tests.rs` returns "no such file"
- [ ] `ls tugcode/tests/bin/bd-fake` returns "no such file"
- [ ] `ls tugcode/tests/.bd-fake-state/` returns "no such file or directory"
- [ ] `ls tugcode/crates/tugcode/src/commands/merge.rs.bak` returns "no such file"
- [ ] `ls tugcode/crates/tugcode/src/commands/merge.rs.backup` returns "no such file"
- [ ] `grep -ri "bead\|beads\|bd-fake\|bd_path\|\.beads" tugcode/tests/` returns zero matches (all test fixtures cleaned)

**Rollback:**
- Restore deleted test files from git.

**Commit after all checkpoints pass.**

---

#### Step 2: Update orchestrator SKILL.md to use tugstate {#step-2}

**Depends on:** #step-0

**Commit:** `docs(implement): replace Bead Write Protocol with tugstate commands in SKILL.md`

**References:** [D05] Replace Bead Write Protocol, [D06] Synchronous heartbeats, [D07] Halt on failure, [D08] Agent contract v2, (#d05-replace-bead-protocol, #d06-sync-heartbeats, #d07-halt-on-failure, #d08-agent-contract-v2)

> **Orchestrator loop replacement algorithm:**
>
> OLD flow: worktree create returns `bead_mapping` (step anchor -> bead_id) and `root_bead_id` -> orchestrator iterates `steps_to_implement` -> looks up `bead_id` per step from `bead_mapping` -> passes `bead_id` to each agent -> after each agent, writes temp file then calls `tugcode beads append-design`/`update-notes`/`append-notes` + cleanup -> committer closes bead via `tugcode commit --bead <id> --close-reason <reason>`.
>
> NEW flow: worktree create returns `all_steps`/`ready_steps` (no `bead_mapping`) -> orchestrator calls `tugcode state claim` to get next ready step (returns `step_anchor`, `title`) -> calls `tugcode state start` -> passes `step_anchor` to agents (no `bead_id`) -> after each agent, calls `tugcode state heartbeat` (synchronous) -> after architect/reviewer, calls `tugcode state artifact` -> after reviewer approval, calls `tugcode state update --all completed` -> committer calls `tugcode commit` (no `--bead`, no `--close-reason`; commit internally calls `state complete`) -> orchestrator checks `state_update_failed` in commit response, halts if true (per [D07]).
>
> The Bead Write Protocol section is deleted entirely: no temp files, no bead append/update commands, no cleanup steps.

**Artifacts:**
- Modified `tugplug/skills/implement/SKILL.md`

**Tasks:**

*Remove beads infrastructure:*
- [ ] Remove the entire "Bead Write Protocol" section (Section heading + table + cleanup instructions)
- [ ] Remove the "Reference: Beads Integration" section at the end of the file

*Update worktree create data extraction:*
- [ ] In the "Setup complete" progress message: replace `Beads: synced | Root: {root_bead_id}` with `State: initialized`
- [ ] In the "Data extracted from worktree create": remove `bead_mapping` and `root_bead_id` fields; keep `all_steps` and `ready_steps` (plan-derived); add `state_initialized` field
- [ ] In the "Session state" store: remove `bead_mapping` and `root_bead_id`; document that step identity now comes from `tugcode state claim` response (not from a pre-built mapping)

*Replace step loop control:*
- [ ] Replace the orchestrator's step iteration logic: instead of iterating `steps_to_implement` with bead_mapping lookups, the loop now calls `tugcode state claim {plan_path} --worktree {worktree_path} --json` to get the next ready step, then `tugcode state start {plan_path} {step_anchor} --worktree {worktree_path}` to transition to in_progress
- [ ] Document the new loop structure: `state claim` -> `state start` -> agent calls with heartbeats -> `state complete` (via commit) -> repeat until `state claim` returns AllCompleted

*Update per-agent spawn data and post-call blocks:*
- [ ] In the architect-agent spawn data: remove `"bead_id": "<bead_id from bead_mapping>"`; pass `step_anchor` from claim response instead
- [ ] In the architect-agent prompt: remove `Bead: <bead_id from bead_mapping>.`
- [ ] After the architect-agent call: replace the "Bead write" block (tugcode beads append-design + rm) with: `Bash: tugcode state heartbeat {plan_path} {step_anchor} --worktree {worktree_path}` and `Bash: tugcode state artifact {plan_path} {step_anchor} --kind architect_strategy --summary "{first 500 chars of approach}" --worktree {worktree_path}`
- [ ] In the coder-agent spawn data: remove `"bead_id": "<bead_id from bead_mapping>"`; pass `step_anchor` instead
- [ ] In the coder-agent prompt: remove `Bead: <bead_id from bead_mapping>.`
- [ ] After the coder-agent call: replace the "Bead write" block (tugcode beads update-notes + rm) with: `Bash: tugcode state heartbeat {plan_path} {step_anchor} --worktree {worktree_path}`
- [ ] In the coder revision prompt: remove `Bead: <bead_id>.`
- [ ] After coder revision: replace the "Bead write" block with heartbeat call
- [ ] In the reviewer-agent spawn data: remove `"bead_id": "<bead_id from bead_mapping>"`; pass `step_anchor` instead
- [ ] In the reviewer-agent prompt: remove `Bead: <bead_id from bead_mapping>.`
- [ ] After the reviewer-agent call: replace the "Bead write" block (tugcode beads append-notes + rm) with: `Bash: tugcode state heartbeat {plan_path} {step_anchor} --worktree {worktree_path}` and `Bash: tugcode state artifact {plan_path} {step_anchor} --kind reviewer_verdict --summary "{first 500 chars of verdict}" --worktree {worktree_path}`
- [ ] After reviewer approval: add `Bash: tugcode state update {plan_path} {step_anchor} --all completed --worktree {worktree_path}` to mark all checklist items as completed
- [ ] In the reviewer revision flow: remove bead prompts from coder and reviewer re-calls
- [ ] After reviewer revision: replace "Bead write" blocks with heartbeat calls

*Update committer and error handling:*
- [ ] In the committer-agent spawn data: remove `"bead_id": "<bead_id from bead_mapping>"`; remove `"close_reason"` field; pass `step_anchor` instead
- [ ] In the committer post-call: update `tugcode commit` invocation to drop `--bead` and `--close-reason` args
- [ ] In the committer post-call progress message: remove `Bead: {bead_id} closed` line
- [ ] Remove the `bead_close_failed` warning message template
- [ ] If `state_update_failed == true` in commit JSON response: halt immediately (per [D07] -- CLI exits 0 but orchestrator treats this as fatal)
- [ ] In the step-loop flow diagram: replace `commit + close bead` with `commit + state complete`

*Add new protocol documentation:*
- [ ] Add a new "Tugstate Protocol" section explaining the full replacement algorithm: `state claim` to get next step, `state start` to begin, `state heartbeat` after each agent, `state artifact` after architect/reviewer, `state update --all completed` after reviewer approval, `state complete` via commit, halt on any state failure

**Tests:**
- [ ] Manual review: SKILL.md contains zero occurrences of "bead", "beads", "Bead", "Beads", "bd-", "bead_id", "bead_mapping"
- [ ] Manual review: SKILL.md contains tugstate heartbeat/artifact/update commands in the correct positions

**Checkpoint:**
- [ ] `grep -i "bead" tugplug/skills/implement/SKILL.md` returns no matches
- [ ] `grep "tugcode state heartbeat" tugplug/skills/implement/SKILL.md` returns at least 3 matches (post-architect, post-coder, post-reviewer)
- [ ] `grep "tugcode state artifact" tugplug/skills/implement/SKILL.md` returns at least 2 matches (post-architect, post-reviewer)

**Rollback:**
- Revert SKILL.md from git.

**Commit after all checkpoints pass.**

---

#### Step 3: Update agent markdown files to remove bead_id and bead commands {#step-3}

**Depends on:** #step-2

**Commit:** `docs(agents): remove bead_id from agent contracts and bead commands from agent instructions`

**References:** [D08] Agent contract v2, (#d08-agent-contract-v2, #l02-modified-files)

**Artifacts:**
- Modified `tugplug/agents/architect-agent.md`
- Modified `tugplug/agents/coder-agent.md`
- Modified `tugplug/agents/reviewer-agent.md`
- Modified `tugplug/agents/committer-agent.md`
- Modified `tugplug/agents/auditor-agent.md`
- Modified `tugcode/crates/tugcode/tests/agent_integration_tests.rs` (deleted or rewrote `test_committer_documents_beads_integration`)

**Tasks:**
- [ ] In `architect-agent.md`: remove `"bead_id"` from the input contract JSON example and the input fields table
- [ ] In `architect-agent.md`: remove `Bead ID: bd-abc123.1.` from the prompt examples
- [ ] In `architect-agent.md`: remove the `tugcode beads inspect {bead_id} --working-dir {worktree_path} --json` command from the "Read bead data" step
- [ ] In `architect-agent.md`: remove the temp file writing instruction (`file_path: "{worktree_path}/.tugtool/_tmp_{bead_id}_strategy.md"`)
- [ ] In `coder-agent.md`: remove `"bead_id"` from the input contract JSON example and the input fields table
- [ ] In `coder-agent.md`: remove `Bead ID: bd-abc123.1.` and `Bead ID: bd-abc123.N.` from prompt examples
- [ ] In `coder-agent.md`: remove the `tugcode beads inspect {bead_id} --working-dir {worktree_path} --json` command
- [ ] In `coder-agent.md`: remove the temp file writing instruction (`file_path: "{worktree_path}/.tugtool/_tmp_{bead_id}_notes.md"`)
- [ ] In `reviewer-agent.md`: remove `"bead_id"` from the input contract JSON example and the input fields table
- [ ] In `reviewer-agent.md`: remove `Bead ID: bd-abc123.1.` and `Bead ID: bd-abc123.N.` from prompt examples
- [ ] In `reviewer-agent.md`: remove the `tugcode beads inspect {bead_id} --working-dir {worktree_path} --json` command
- [ ] In `reviewer-agent.md`: remove the temp file writing instruction (`file_path: "{worktree_path}/.tugtool/_tmp_{bead_id}_review.md"`)
- [ ] In `reviewer-agent.md`: remove the bead inspect example from the "Full worked example" section
- [ ] In `committer-agent.md`: remove `bead_id` and `close_reason` from the commit mode input fields
- [ ] In `committer-agent.md`: update the `tugcode commit` invocation to drop `--bead "{bead_id}"` and `--close-reason` args
- [ ] In `committer-agent.md`: remove "closes beads" and "no bead tracking" references from commit/fixup mode descriptions
- [ ] In `auditor-agent.md`: replace "per-step bead notes" with "per-step data" (2 occurrences)
- [ ] In `tugcode/crates/tugcode/tests/agent_integration_tests.rs`: delete or rewrite `test_committer_documents_beads_integration()` (line ~413). This test asserts that `committer-agent.md` contains "bead" or "Bead", which will fail now that Step 3 removes bead references from that file. Either delete the test entirely, or rewrite it to assert that `committer-agent.md` contains tugstate-related content (e.g., "state" or "tugcode commit") instead.

**Tests:**
- [ ] Grep verification: `grep -ri "bead" tugplug/agents/` returns no matches
- [ ] Test suite: `cargo nextest run` passes (verifies the deleted/rewritten agent integration test does not fail)

**Checkpoint:**
- [ ] `grep -ri "bead" tugplug/agents/` returns no matches
- [ ] `grep -ri "bead" tugplug/agents/committer-agent.md` returns no matches
- [ ] `grep -ri "bead" tugcode/crates/tugcode/tests/agent_integration_tests.rs` returns no matches
- [ ] `cd tugcode && cargo nextest run` passes
- [ ] Each agent markdown file contains a valid input contract without `bead_id`

**Rollback:**
- Revert agent markdown files from git.

**Commit after all checkpoints pass.**

---

#### Step 4: Update tugplug/CLAUDE.md and .gitignore {#step-4}

**Depends on:** #step-3

**Commit:** `docs(tugplug): replace Beads Policy with Tugstate Policy; clean up .gitignore`

**References:** [D10] Clean up .gitignore, (#d10-gitignore-cleanup, #l02-modified-files)

**Artifacts:**
- Modified `tugplug/CLAUDE.md`
- Modified `.gitignore`

**Tasks:**
- [ ] In `tugplug/CLAUDE.md`: replace the "Beads Policy" section with a "Tugstate Policy" section containing: "Tugstate tracks per-step state in an embedded SQLite database. Agents do not call `tugcode state` commands directly -- all state management is handled by the orchestrator (implement skill). Agents receive step context from the orchestrator and return structured JSON output; the orchestrator is responsible for heartbeats, checklist updates, artifact recording, and step completion."
- [ ] In `tugplug/CLAUDE.md`: remove "Plan files are never modified by beads sync." and "`tugcode init` removes git hooks containing beads references."
- [ ] In `.gitignore`: remove the line `# Beads databases (per-worktree)` and the line `.beads/`
- [ ] In `.gitignore`: remove the line `# Unwanted file dropped by bd init` and the line `AGENTS.md`
- [ ] In `.gitignore`: verify that the `# Tug step artifacts` comment and the three `state.db` entries remain intact

**Tests:**
- [ ] Grep verification: `grep -i "bead" tugplug/CLAUDE.md` returns no matches
- [ ] Grep verification: `grep "\.beads" .gitignore` returns no matches

**Checkpoint:**
- [ ] `grep -i "bead" tugplug/CLAUDE.md` returns no matches
- [ ] `grep "\.beads" .gitignore` returns no matches
- [ ] `grep "AGENTS.md" .gitignore` returns no matches
- [ ] `grep "state.db" .gitignore` returns 3 matches (state.db, state.db-wal, state.db-shm)

**Rollback:**
- Revert CLAUDE.md and .gitignore from git.

**Commit after all checkpoints pass.**

---

#### Step 5: Final verification and cleanup {#step-5}

**Depends on:** #step-1, #step-4

**Commit:** `chore: verify zero beads references remain in codebase`

**References:** [D01] Delete beads module, (#d01-delete-beads-module, #success-criteria, #r01-missing-reference)

**Artifacts:**
- No new files; this step verifies the removal is complete

**Tasks:**
- [ ] Run the canonical grep (single source of truth, used verbatim in checkpoints and exit criteria): `grep -ri "bead\|beads\|\.beads\|bd-fake\|bd_path" tugcode/ tugplug/ .gitignore --exclude-dir=.tugtool` and verify zero matches.
- [ ] Run type-specific grep: `grep -ri "bead_id\|bead_mapping\|root_bead_id\|BeadsCli\|BeadsConfig\|BeadsHints\|BeadStepStatus\|BeadsCloseData\|bead_close" tugcode/ tugplug/ --exclude-dir=.tugtool` and verify zero matches.
- [ ] Confirm expected exclusions contain only historical/template content: `grep -ri "bead" tugcode/.tugtool/` -- matches here are expected and acceptable (skeleton template documentation, deferred to follow-on).
- [ ] Verify `cargo build` succeeds with zero warnings
- [ ] Verify `cargo nextest run` passes all tests
- [ ] Verify `cargo fmt --all --check` passes (formatting is clean)
- [ ] If any stray beads references are found in executable code paths, fix them in this step

**Tests:**
- [ ] Full test suite: `cargo nextest run` passes
- [ ] Grep verification: canonical grep returns zero matches (same command as #success-criteria)

**Checkpoint:**
- [ ] `cd tugcode && cargo build` succeeds with no warnings
- [ ] `cd tugcode && cargo nextest run` passes all tests
- [ ] `cd tugcode && cargo fmt --all --check` passes
- [ ] `grep -ri "bead\|beads\|\.beads\|bd-fake\|bd_path" tugcode/ tugplug/ .gitignore --exclude-dir=.tugtool` returns zero matches (canonical grep, same as #success-criteria)
- [ ] `grep -ri "bead_id\|bead_mapping\|BeadsCli\|BeadsConfig" tugcode/ tugplug/ --exclude-dir=.tugtool` returns zero matches

**Rollback:**
- N/A -- this step only verifies and fixes stragglers.

**Commit after all checkpoints pass.**

---

### 2.0.4 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A tugtool codebase with zero beads dependencies, where Tugstate is the sole coordination mechanism for multi-worktree plan implementations. The orchestrator uses tugstate commands (heartbeat, update, artifact, complete) instead of the Bead Write Protocol. Agents have clean input contracts without bead_id. The `bd` external binary is no longer required.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `grep -ri "bead\|beads\|\.beads\|bd-fake\|bd_path" tugcode/ tugplug/ .gitignore --exclude-dir=.tugtool` returns zero matches (canonical grep -- same command used in Step 5 verification and #success-criteria)
- [ ] `cargo build` in `tugcode/` succeeds with zero warnings
- [ ] `cargo nextest run` in `tugcode/` passes all tests
- [ ] `tugcode beads` command no longer exists (returns "unknown subcommand")
- [ ] `tugcode commit` no longer accepts `--bead` or `--close-reason` args
- [ ] `tugcode status` no longer accepts `--full` arg
- [ ] SKILL.md references only `tugcode state` commands for coordination
- [ ] Agent markdown files contain no `bead_id` or `tugcode beads` references

**Acceptance tests:**
- [ ] Compilation test: `cd tugcode && cargo build` with zero warnings
- [ ] Full test suite: `cd tugcode && cargo nextest run` all tests pass
- [ ] Grep test: canonical grep returns zero matches (`grep -ri "bead\|beads\|\.beads\|bd-fake\|bd_path" tugcode/ tugplug/ .gitignore --exclude-dir=.tugtool`)
- [ ] CLI test: `tugcode beads sync` returns error (command not found)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add `tugcode state prune` for orphaned state cleanup
- [ ] Update `tugcode status` to read from state.db instead of checkboxes
- [ ] Remove Beads Root row from tugplan-skeleton.md metadata table
- [ ] Update skeleton's "Bead:" and "Beads:" line documentation to reference historical usage
- [ ] Wrap state operations behind tugcast WebSocket endpoints for multi-machine coordination

| Checkpoint | Verification |
|------------|--------------|
| Beads module deleted | `beads.rs` and `commands/beads/` do not exist |
| Types cleaned | No bead fields in Step, Substep, TugPlanMetadata |
| Config cleaned | No BeadsConfig in config.rs |
| Errors cleaned | No E012-E015, E035-E036 variants |
| Output cleaned | No BeadStepStatus, BeadsCloseData |
| CLI cleaned | No `--bead`, `--close-reason`, `--full` args |
| Init cleaned | No [tugtool.beads] in TEMPLATE_CONFIG, no remove_beads_hooks/merge_driver/gitattributes functions |
| Worktree cleaned | No beads sync, no commit_bead_annotations(), no sync_beads_in_worktree() in worktree create |
| Commit cleaned | No bead close in commit |
| Log cleaned | No --bead parameter, no bead YAML output, no bead print |
| Merge cleaned | No .beads/ test setup, no 'tug beads status' message |
| CLI long_about cleaned | No beads references in any long_about string (Cli, Commit, Status, Merge, Log, Worktree) |
| Integration tests cleaned | No beads_root_id or bead_id assertions in integration_tests.rs |
| Tests cleaned | No beads test files |
| Stragglers cleaned | No merge.rs.bak, merge.rs.backup; tests/README.md updated or deleted |
| Agents cleaned | No bead_id in agent contracts |
| Skill cleaned | No Bead Write Protocol in SKILL.md |
| .gitignore cleaned | No .beads/ entry |
| Zero grep matches | Canonical grep returns zero matches: `grep -ri "bead\|beads\|\.beads\|bd-fake\|bd_path" tugcode/ tugplug/ .gitignore --exclude-dir=.tugtool` |

**Commit after all checkpoints pass.**
