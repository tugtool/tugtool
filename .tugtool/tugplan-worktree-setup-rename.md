## Phase 1.0: Rename `worktree create` to `worktree setup` {#phase-worktree-setup}

**Purpose:** Rename the `tugcode worktree create` CLI subcommand to `tugcode worktree setup` across the entire codebase — CLI parsing, implementation, tests, docs, and agent prompts — so the command name accurately reflects its idempotent semantics.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-25 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The `tugcode worktree create` command is idempotent: it creates a worktree if one does not yet exist for the given plan, and reuses an existing worktree if one is already present. The name "create" implies a one-shot operation that would fail or duplicate on re-invocation. "Setup" better describes the actual semantics — prepare the worktree environment, creating it only if necessary.

This is a pure rename/refactor. No behavioral changes, no new features, no API surface changes beyond the subcommand name itself.

#### Strategy {#strategy}

- Ship the entire rename in a single atomic commit to avoid broken intermediate states (two non-ignored integration tests pass `"create"` as a CLI arg and would break if tests were not updated alongside the Rust changes).
- Use explicit `#[command(name = "setup")]` on the clap enum variant so the CLI surface is `setup` regardless of internal enum naming.
- Rename `WorktreeCommands::Create` to `WorktreeCommands::Setup`, `CreateData` to `SetupData`, and `run_worktree_create` / `run_worktree_create_with_root` to `run_worktree_setup` / `run_worktree_setup_with_root` for internal consistency.
- Update all integration test function names, `#[ignore]` annotation strings, and assertion messages that reference "worktree create".
- Update agent prompts and skill definitions in `tugplug/` that instruct agents to run `tugcode worktree create`, including the `CreateData` type name in SKILL.md.
- Update `CLAUDE.md` and `README.md` references.
- Leave archived/historical files (`.tugtool/` tugplan archives, `roadmap/`, `aside/`) untouched — they are historical records.
- Leave user-facing print messages that say "creating" or "Created" unchanged — these describe the filesystem operation (creating a worktree directory), not the CLI subcommand name.

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool developers who invoke `tugcode worktree setup` from the CLI
2. The implement skill orchestrator which calls `tugcode worktree setup` via Bash as its first action

#### Success Criteria (Measurable) {#success-criteria}

- `tugcode worktree setup .tugtool/tugplan-foo.md --json` succeeds (exit 0) and produces identical JSON output to the old `worktree create` command (verify via integration test)
- `tugcode worktree create` is no longer a recognized subcommand (verify via `tugcode worktree create --help` returning an error)
- `cargo nextest run` passes with zero warnings
- `cargo fmt --check` passes
- No occurrence of `worktree create` remains in any active source file (Rust code, SKILL.md, CLAUDE.md, README.md)

#### Scope {#scope}

1. Rename the clap subcommand from `create` to `setup`
2. Rename `WorktreeCommands::Create` enum variant to `WorktreeCommands::Setup`
3. Rename `CreateData` struct to `SetupData` (and its doc comment)
4. Rename `run_worktree_create` to `run_worktree_setup` and `run_worktree_create_with_root` to `run_worktree_setup_with_root`
5. Update `commands/mod.rs` re-exports
6. Update `main.rs` match arm
7. Update `cli.rs` `long_about` text for the `Worktree` command group
8. Update `worktree.rs` doc comments and the `Create` variant's doc comment
9. Update all integration tests in `worktree_integration_tests.rs`
10. Update `tugplug/skills/implement/SKILL.md` (FIRST ACTION, orchestration diagram, execute sequence, `CreateData` type name)
11. Update `CLAUDE.md` and `README.md`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing any behavior of the worktree command (this is a pure rename)
- Adding a deprecation period or alias for `create` (clean break)
- Updating archived tugplan files in `.tugtool/` (historical records)
- Updating roadmap discussion documents in `roadmap/` (historical records)
- Changing the JSON output schema or field names (the struct rename `CreateData` -> `SetupData` is internal; serialized field names are unchanged)
- Changing user-facing print messages that say "creating" or "Created" (these describe the filesystem operation, not the CLI subcommand name)

#### Dependencies / Prerequisites {#dependencies}

- The codebase must be on `main` with a clean working tree
- `cargo nextest run` must pass before starting

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` in `.cargo/config.toml`) — all doc comments and dead code must be clean
- Must run `cargo fmt --all` after all Rust changes
- The rename must be atomic within a single commit — two non-ignored integration tests (`test_worktree_create_blocks_plan_with_validation_errors`, `test_worktree_create_blocks_plan_with_diagnostics`) pass `"create"` as a CLI arg and will fail if Rust sources are renamed without simultaneously updating tests

#### Assumptions {#assumptions}

- The `#[command(name = "setup")]` clap attribute will control the CLI surface name, decoupled from the Rust enum variant name
- No external consumers depend on `tugcode worktree create` outside this repository (it is an internal CLI tool)
- The `worktree.rs` doc comment `/// Create worktree for implementation` on the enum variant is the user-facing help text via clap derive

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Rename enum variant and functions for internal consistency (DECIDED) {#d01-rename-internals}

**Decision:** Rename `WorktreeCommands::Create` to `WorktreeCommands::Setup`, `CreateData` to `SetupData`, `run_worktree_create` to `run_worktree_setup`, and `run_worktree_create_with_root` to `run_worktree_setup_with_root`. Use `#[command(name = "setup")]` on the variant.

**Rationale:**
- Internal names should match the CLI surface to avoid confusion when reading code
- The user answer explicitly requested this alignment
- `CreateData` is the JSON output struct for this subcommand; renaming it to `SetupData` maintains the naming pattern (`ListData`, `CleanupData`, `RemoveData`, `SetupData`)

**Implications:**
- All call sites in `main.rs`, `mod.rs`, and tests must be updated in the same commit
- All `CreateData` construction sites in `worktree.rs` (5 existing sites) must be updated to `SetupData`
- The `#[command(name = "setup")]` attribute is redundant when the variant is named `Setup` (clap lowercases automatically), but including it makes the CLI name explicit and resilient to future variant renames

#### [D02] Clean break with no deprecation alias (DECIDED) {#d02-clean-break}

**Decision:** Remove `create` entirely. Do not add a hidden alias or deprecation shim.

**Rationale:**
- This is an internal tool; no external consumers need a migration path
- A clean break avoids maintenance burden of supporting two names

**Implications:**
- Any scripts or muscle memory using `create` will break immediately with a clear "unrecognized subcommand" error from clap

#### [D03] Leave archived and roadmap files unchanged (DECIDED) {#d03-leave-archives}

**Decision:** Do not update references to `worktree create` in `.tugtool/tugplan-*.md` archive files, `roadmap/` documents, or `aside/` files.

**Rationale:**
- These are historical records that document what was true at the time of writing
- Updating them risks introducing errors in documents that are no longer actively maintained

**Implications:**
- `grep` for "worktree create" will still find hits in archived files; this is expected and acceptable

#### [D04] Single atomic commit (DECIDED) {#d04-single-commit}

**Decision:** All rename changes ship in a single commit to avoid broken intermediate states.

**Rationale:**
- A partial rename (e.g., enum renamed but call sites not updated) would fail to compile
- A single commit makes the change trivially revertible

**Implications:**
- The execution plan uses a single Step 0 containing all changes (Rust sources, tests, docs, prompts)
- This avoids the risk of broken intermediate states where tests reference a subcommand name that no longer exists

---

### 1.0.1 Symbol Inventory {#symbol-inventory}

#### 1.0.1.1 Symbols to rename {#symbols-rename}

**Table T01: Rust Symbol Renames** {#t01-rust-renames}

| Current Symbol | New Symbol | Kind | Location |
|---------------|-----------|------|----------|
| `WorktreeCommands::Create` | `WorktreeCommands::Setup` | enum variant | `tugcode/crates/tugcode/src/commands/worktree.rs` |
| `CreateData` | `SetupData` | struct | `tugcode/crates/tugcode/src/commands/worktree.rs` |
| `run_worktree_create` | `run_worktree_setup` | fn | `tugcode/crates/tugcode/src/commands/worktree.rs` |
| `run_worktree_create_with_root` | `run_worktree_setup_with_root` | fn | `tugcode/crates/tugcode/src/commands/worktree.rs` |
| `run_worktree_create` (re-export) | `run_worktree_setup` | use | `tugcode/crates/tugcode/src/commands/mod.rs` |
| `WorktreeCommands::Create` (match arm) | `WorktreeCommands::Setup` | match | `tugcode/crates/tugcode/src/main.rs` |
| `commands::run_worktree_create(...)` | `commands::run_worktree_setup(...)` | call | `tugcode/crates/tugcode/src/main.rs` |

#### 1.0.1.2 Doc and prompt references to update {#doc-references}

**Table T02: Documentation and Prompt Updates** {#t02-doc-updates}

| File | What to change |
|------|---------------|
| `tugcode/crates/tugcode/src/commands/worktree.rs` | Variant doc comment: "Create worktree" -> "Set up worktree"; module-level doc comment if applicable |
| `tugcode/crates/tugcode/src/commands/worktree.rs` | `CreateData` struct doc comment: "JSON output for create command" -> "JSON output for setup command" |
| `tugcode/crates/tugcode/src/commands/worktree.rs` | Function doc comment: `/// Run worktree create command` -> `/// Run worktree setup command` |
| `tugcode/crates/tugcode/src/cli.rs` | `long_about` for `Worktree` variant: update subcommand list and typical workflow to say `setup` |
| `tugcode/crates/tugcode/tests/worktree_integration_tests.rs` | Test function names, `#[ignore]` strings, assertion messages, CLI arg `"create"` -> `"setup"` |
| `tugplug/skills/implement/SKILL.md` | FIRST ACTION instruction, section "1. Create Worktree" heading, Bash command, orchestration diagram, "Setup complete" heading context, `CreateData` type name -> `SetupData` |
| `CLAUDE.md` | Exception note about `tugcode worktree create` |
| `README.md` | Worktree And Merge usage example |

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Rename all symbols, tests, docs, and prompts {#step-0}

**Commit:** `refactor(worktree): rename 'create' subcommand to 'setup'`

**References:** [D01] Rename enum variant and functions, [D02] Clean break, [D03] Leave archives unchanged, [D04] Single atomic commit, Table T01, Table T02, (#symbols-rename, #doc-references, #strategy)

**Artifacts:**
- Modified `tugcode/crates/tugcode/src/commands/worktree.rs` — enum variant, struct, functions, doc comments
- Modified `tugcode/crates/tugcode/src/commands/mod.rs` — re-exports
- Modified `tugcode/crates/tugcode/src/main.rs` — match arm and function call
- Modified `tugcode/crates/tugcode/src/cli.rs` — `long_about` text
- Modified `tugcode/crates/tugcode/tests/worktree_integration_tests.rs` — function names, CLI args, annotations, messages
- Modified `tugplug/skills/implement/SKILL.md` — command references and type name
- Modified `CLAUDE.md` — exception note
- Modified `README.md` — usage example

**Tasks:**

*Rust sources (worktree.rs):*
- [ ] Rename `WorktreeCommands::Create` variant to `WorktreeCommands::Setup` and add `#[command(name = "setup")]`
- [ ] Update the variant's doc comment from "Create worktree for implementation" to "Set up worktree for implementation"
- [ ] Update the variant's long doc comment from "Creates a git worktree and branch" to "Sets up a git worktree and branch"
- [ ] Rename `struct CreateData` to `struct SetupData` and update its doc comment from "JSON output for create command" to "JSON output for setup command"
- [ ] Update all 5 `CreateData { ... }` construction sites to `SetupData { ... }` (lines 549, 636, 1069, 1099, 1120 approximately)
- [ ] Rename `pub fn run_worktree_create(...)` to `pub fn run_worktree_setup(...)`
- [ ] Rename `pub fn run_worktree_create_with_root(...)` to `pub fn run_worktree_setup_with_root(...)`
- [ ] Update function doc comments from "Run worktree create command" to "Run worktree setup command"
- [ ] Update internal call from `run_worktree_create_with_root(...)` to `run_worktree_setup_with_root(...)`

*Rust sources (mod.rs, main.rs, cli.rs):*
- [ ] In `mod.rs`: update `pub use worktree::{..., run_worktree_create, ...}` to `run_worktree_setup`
- [ ] In `main.rs`: update `WorktreeCommands::Create` match arm to `WorktreeCommands::Setup`
- [ ] In `main.rs`: update `commands::run_worktree_create(...)` call to `commands::run_worktree_setup(...)`
- [ ] In `cli.rs`: update the `long_about` string for the `Worktree` variant — change "create" to "setup" in subcommand list and typical workflow

*Integration tests (worktree_integration_tests.rs):*
- [ ] Replace all `.arg("create")` calls with `.arg("setup")` in test commands
- [ ] Rename `test_worktree_create_with_valid_plan_succeeds` to `test_worktree_setup_with_valid_plan_succeeds`
- [ ] Rename `test_worktree_create_blocks_plan_with_validation_errors` to `test_worktree_setup_blocks_plan_with_validation_errors`
- [ ] Rename `test_worktree_create_blocks_plan_with_diagnostics` to `test_worktree_setup_blocks_plan_with_diagnostics`
- [ ] Rename `test_worktree_create_skip_validation_bypasses_check` to `test_worktree_setup_skip_validation_bypasses_check`
- [ ] Update all `#[ignore = "requires worktree create (slow integration test)"]` to `#[ignore = "requires worktree setup (slow integration test)"]`
- [ ] Update assertion messages: "worktree create should succeed" -> "worktree setup should succeed", "failed to run tug worktree create" -> "failed to run tug worktree setup", etc.
- [ ] Update code comments: "Step 1: Create worktree" -> "Step 1: Set up worktree", "Create a worktree" -> "Set up a worktree", etc.

*Documentation and agent prompts:*
- [ ] In `SKILL.md`: update FIRST ACTION line from `tugcode worktree create` to `tugcode worktree setup`
- [ ] In `SKILL.md`: update section heading "### Setup complete (after tugcode worktree create)" to "### Setup complete (after tugcode worktree setup)"
- [ ] In `SKILL.md`: update orchestration diagram box from `tugcode worktree create <plan> --json` to `tugcode worktree setup <plan> --json`
- [ ] In `SKILL.md`: update section heading "### 1. Create Worktree" to "### 1. Set Up Worktree"
- [ ] In `SKILL.md`: update "Run the worktree creation command via Bash" to "Run the worktree setup command via Bash"
- [ ] In `SKILL.md`: update the Bash code block from `tugcode worktree create <plan_path> --json` to `tugcode worktree setup <plan_path> --json`
- [ ] In `SKILL.md`: update "The output is a CreateData object" to "The output is a SetupData object"
- [ ] In `SKILL.md`: update "worktree_path: Absolute path to the created worktree" to "worktree_path: Absolute path to the worktree"
- [ ] In `CLAUDE.md`: update the exception note from `tugcode worktree create` to `tugcode worktree setup`
- [ ] In `README.md`: update the usage example from `tugcode worktree create` to `tugcode worktree setup`

*Final verification:*
- [ ] Run `cargo fmt --all` in `tugcode/`
- [ ] Run `cargo build` in `tugcode/` to verify zero errors and zero warnings

**Tests:**
- [ ] Unit test: `cargo nextest run` passes (includes `verify_cli` clap structural validation and non-ignored worktree tests)
- [ ] Integration test: `cargo nextest run -E 'test(worktree)' --include-ignored` passes (all worktree tests green)
- [ ] Drift prevention: `grep -r "worktree create" tugcode/ tugplug/ CLAUDE.md README.md` returns zero matches

**Checkpoint:**
- [ ] `cd tugcode && cargo build` exits 0 with no warnings
- [ ] `cd tugcode && cargo nextest run` exits 0
- [ ] `cd tugcode && cargo fmt --check` exits 0
- [ ] `tugcode worktree --help` shows `setup` (not `create`) in subcommand list
- [ ] `grep -r "worktree create" tugcode/ tugplug/ CLAUDE.md README.md` returns no matches
- [ ] `grep -r "worktree setup" tugplug/skills/implement/SKILL.md` returns at least 3 matches

**Rollback:**
- Revert all changes across all modified files (single commit makes this a single `git revert`)

---

### 1.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** The `tugcode worktree create` subcommand is renamed to `tugcode worktree setup` across all active source files, with no behavioral changes.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugcode worktree setup --help` displays help text (exit 0)
- [ ] `tugcode worktree create` returns an error (unrecognized subcommand)
- [ ] `cd tugcode && cargo nextest run` passes with zero warnings
- [ ] `cd tugcode && cargo fmt --check` passes
- [ ] No occurrence of `worktree create` or `CreateData` in active source files (Rust, SKILL.md, CLAUDE.md, README.md)

**Acceptance tests:**
- [ ] Unit test: `verify_cli` passes (clap structural validation)
- [ ] Integration test: all worktree integration tests pass with `--include-ignored`
- [ ] Drift prevention: `grep -r "worktree create" tugcode/ tugplug/ CLAUDE.md README.md` returns zero matches

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Consider updating archived tugplan files that reference `worktree create` if they are ever revised for other reasons

| Checkpoint | Verification |
|------------|--------------|
| CLI surface renamed | `tugcode worktree setup --help` exits 0; `tugcode worktree create` errors |
| All tests pass | `cd tugcode && cargo nextest run` exits 0 |
| No stale references | `grep -r "worktree create" tugcode/ tugplug/ CLAUDE.md README.md` returns empty |

**Commit after all checkpoints pass.**
