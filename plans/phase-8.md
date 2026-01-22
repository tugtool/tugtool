## Phase 8: Editor Interop - MCP Removal and Claude Code / Cursor Integration {#phase-8}

**Purpose:** Remove all MCP support from tugtool (clean break) and implement the "one kernel, many front doors" editor interop strategy via Claude Code commands/rules and Cursor configuration.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-01-22 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

MCP (Model Context Protocol) was originally designed as a generic RPC layer for AI agent integration. However, the reality is that editor-native workflows (Claude Code commands, Cursor rules) provide a more direct, simpler integration path. MCP adds complexity without proportional benefit:

- Requires running a separate server process
- Adds async runtime overhead
- Introduces dependency on the `rmcp` crate and its transitive dependencies
- The CLI already provides all needed functionality with stable JSON output and exit codes

The CLI is the "kernel" - stable, well-tested, feature-complete. Editor-specific commands and rules are the "front doors" that orchestrate the kernel for specific workflows.

#### Strategy {#strategy}

- **Part 1: Clean MCP Removal** - Delete all MCP code, dependencies, and documentation references. No deprecation period, no stub commands - complete removal.
- **Part 2: Claude Code Front Door** - Create `.claude/commands/` for tug workflows (`/tug-rename`, `/tug-rename-plan`, `/tug-fixtures-ensure`). Agent behavior rules are documented in CLAUDE.md.
- **Part 3: Cursor Front Door** - Create `.cursor/rules/tug.mdc` with agent rules (rules-only, no Cursor commands in Phase 8).
- **Part 4: Documentation Updates** - Update CLAUDE.md, README.md, and docs/ to reflect the new interop strategy.

#### Stakeholders / Primary Customers {#stakeholders}

1. Developers using Claude Code with tug
2. Developers using Cursor with tug
3. Maintainers of the tugtool codebase (simpler build, fewer dependencies)

#### Success Criteria (Measurable) {#success-criteria}

- `cargo build -p tugtool` succeeds without any MCP-related code or dependencies
- `grep -r "mcp\|MCP\|rmcp" --include="*.rs" crates/` returns no matches
- `/tug-rename` command in Claude Code successfully executes the analyze -> dry-run -> apply workflow
- All existing tests pass (`cargo nextest run --workspace`)
- User-facing documentation (`CLAUDE.md`, `README.md`, `docs/`) contains no references to MCP server
  - Note: `plans/` may retain historical MCP references and is excluded from this criterion

#### Scope {#scope}

1. Delete `crates/tugtool/src/mcp.rs` and all MCP-related code
2. Remove `mcp` feature flag and dependencies from Cargo.toml (including `tokio` if MCP-only)
3. Update all user-facing documentation to remove MCP references
4. Create Claude Code commands in `.claude/commands/`
5. Document agent rules in CLAUDE.md
6. Create Cursor rules in `.cursor/rules/tug.mdc` (rules-only, no Cursor commands)
7. Update CLAUDE.md with new editor integration strategy

#### Non-goals (Explicitly out of scope) {#non-goals}

- Providing MCP as an optional feature for other editors
- Building a generic plugin system
- Supporting editors other than Claude Code and Cursor
- Implementing new tug CLI features (this phase is interop only)

#### Dependencies / Prerequisites {#dependencies}

- Stable CLI with JSON output (already complete)
- Exit codes per Table T26 (already implemented)
- All refactoring operations working via CLI (already complete)

#### Constraints {#constraints}

- Must not break existing CLI functionality
- Must maintain backward compatibility for all existing JSON output schemas
- Claude Code commands must work with the current command system

#### Assumptions {#assumptions}

- Claude Code supports `.claude/commands/` directory for custom commands
- Cursor supports `.cursor/rules/*.mdc` format for project rules (confirmed via documentation)
- Users have `tug` binary in PATH or will configure it

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Cursor rules file format (RESOLVED) {#q01-cursor-rules}

**Question:** What is the exact file format and location for Cursor rules?

**Why it matters:** Need to create valid Cursor configuration that actually works.

**Options considered:**
- `.cursor/rules/*.mdc` files (new format, recommended)
- `.cursorrules` file in project root (legacy, deprecated but still supported)

**Resolution:** Use `.cursor/rules/tug.mdc` (the new `.mdc` format). This is the current recommended approach per Cursor documentation. The legacy `.cursorrules` format is deprecated and will be removed in future Cursor versions.

**Sources:**
- [awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules)
- [dotcursorrules.com](https://dotcursorrules.com/)
- [Cursor Community Forum](https://forum.cursor.com/t/good-examples-of-cursorrules-file/4346)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Claude Code command format changes | med | med | Keep commands simple, document format | Claude Code update |
| Cursor config format changes | low | med | Use new `.mdc` format, document fallback | Cursor update |

**Note:** MCP removal has no risk - this project has zero users. Clean break with no deprecation period.

---

### 8.0 Design Decisions {#design-decisions}

#### [D01] Complete MCP Removal (DECIDED) {#d01-mcp-removal}

**Decision:** Remove all MCP code, dependencies, and documentation in a clean break. No deprecation period, no stub commands, no migration path.

**Rationale:**
- MCP adds significant complexity (async runtime, extra dependencies)
- CLI provides all functionality with simpler integration
- Project has zero users - no backwards compatibility concerns
- Clean removal is simpler than maintenance burden

**Implications:**
- Delete `mcp.rs` and all conditional compilation
- Remove `rmcp` and `schemars` dependencies
- Remove `tokio` if audit confirms it's MCP-only (see [D05])
- Update feature flags to remove `mcp`
- Update all documentation

#### [D02] CLI as Kernel, Editors as Front Doors (DECIDED) {#d02-one-kernel}

**Decision:** The tug CLI with stable JSON + exit codes is the integration kernel. Editor-specific commands/rules are front doors that orchestrate the kernel.

**Rationale:**
- CLI is already stable and well-tested
- JSON output is deterministic and versioned
- Exit codes provide error handling contract
- No need for additional RPC layer

**Implications:**
- Claude Code commands call CLI via Bash tool
- Cursor commands call CLI via terminal
- All front doors share the same contract (Table T26)

#### [D03] Three Decision Gates (DECIDED) {#d03-decision-gates}

**Decision:** All rename workflows must pass through three decision gates: Gate A (risk threshold), Gate B (patch review), Gate C (verification).

**Rationale:**
- Prevents accidental large-scale changes
- Ensures human review before apply
- Verification catches syntax errors before they reach the workspace

**Implications:**
- Commands must implement gate logic
- Approval required before apply
- Clear thresholds defined (files > 50 or edits > 500 requires explicit approval)

#### [D04] No Apply Without Approval (DECIDED) {#d04-no-apply-without-approval}

**Decision:** Claude Code commands must never call `tug run --apply` without explicit user approval after showing the patch summary.

**Rationale:**
- Safety: changes should be reviewed before application
- Trust: users must opt-in to modifications
- Reversibility: easier to prevent than to undo

**Implications:**
- Commands must pause and wait for approval
- Summary must show files/edits count
- Apply is separate step from dry-run

#### [D05] Remove Tokio If MCP-Only (DECIDED) {#d05-tokio-removal}

**Decision:** Audit `tokio` usage during MCP removal. If `tokio` is only used by MCP code, remove it entirely.

**Rationale:**
- Simpler build with fewer dependencies
- Faster compile times
- If the async runtime is only for MCP, it's dead weight

**Implications:**
- Step 1 includes tokio audit task
- If tokio is used elsewhere, keep it with updated comments
- If tokio is MCP-only, remove dependency entirely

#### [D06] Syntax Verification Only (DECIDED) {#d06-syntax-verify}

**Decision:** Editor commands use `--verify syntax` only. Test verification is out of scope for Phase 8.

**Rationale:**
- Syntax verification is fast and always available
- Test verification can be slow and requires fixture setup
- Keep Phase 8 focused on interop, not verification enhancements

**Implications:**
- All command examples use `--verify syntax`
- No mention of `--verify tests` in Phase 8 commands
- Future phases may add test verification as opt-in

---

### 8.1 Specification {#specification}

#### 8.1.1 Files to Delete (MCP Removal) {#files-to-delete}

**List L01: Files to Delete** {#l01-files-delete}

| File | Reason |
|------|--------|
| `crates/tugtool/src/mcp.rs` | MCP server implementation |

#### 8.1.2 Files to Modify (MCP Removal) {#files-to-modify}

**List L02: Files to Modify for MCP Removal** {#l02-files-modify}

| File | Changes |
|------|---------|
| `crates/tugtool/Cargo.toml` | Remove `rmcp`, `schemars` deps; remove `mcp` feature |
| `crates/tugtool/src/lib.rs` | Remove `#[cfg(feature = "mcp")] pub mod mcp;` |
| `crates/tugtool/src/main.rs` | Remove `Command::Mcp` variant and `execute_mcp()` |
| `crates/tugtool/tests/golden_tests.rs` | Remove `#[cfg(feature = "mcp")] mod mcp_parity` |
| `crates/tugtool/tests/api_surface.rs` | Remove `#[cfg(feature = "mcp")] use tugtool::mcp;` |
| `CLAUDE.md` | Remove MCP references |
| `README.md` | Remove MCP section and commands table entry |
| `docs/AGENT_API.md` | Remove MCP Server section |
| `docs/AGENT_PLAYBOOK.md` | Remove MCP configuration section |
| `Justfile` | Remove `mcp` recipe |

#### 8.1.3 Claude Code Commands {#claude-commands}

**Spec S01: Claude Code Command Specifications** {#s01-claude-commands}

##### Command: `/tug-rename` {#cmd-tug-rename}

**Purpose:** Full analyze -> dry-run -> review -> apply workflow for symbol rename.

**File:** `.claude/commands/tug-rename.md`

**Inputs (prompted or inferred):**
- `new_name` (required): New name for the symbol
- Location inferred from current file and cursor position

**Workflow:**
1. Determine `<file:line:col>` from editor context
2. Run `tug analyze-impact rename-symbol --at <loc> --to <new_name>`
3. Parse JSON, apply Gate A (risk threshold)
4. Run `tug run --verify syntax rename-symbol --at <loc> --to <new_name>` (dry-run)
5. Parse JSON, show summary, apply Gate B (patch review) and Gate C (verification)
6. If approved: run `tug run --apply --verify syntax rename-symbol --at <loc> --to <new_name>`
7. Show final result

**Decision Gates:**
- **Gate A:** If `files_affected > 50` OR `edits_estimated > 500`, require explicit approval
- **Gate A:** If `references_count == 0`, stop and request new location
- **Gate B:** Show files changed count, edits count, top N files; require explicit "apply" decision
- **Gate C:** If verification status is not "passed", do not proceed to apply

##### Command: `/tug-rename-plan` {#cmd-tug-rename-plan}

**Purpose:** Analyze + dry-run only (no apply), for cautious review workflows.

**File:** `.claude/commands/tug-rename-plan.md`

**Workflow:**
1. Same as `/tug-rename` steps 1-5
2. Stop after showing summary (do not offer apply)

##### Command: `/tug-fixtures-ensure` {#cmd-tug-fixtures-ensure}

**Purpose:** Ensure test fixtures are fetched and ready.

**File:** `.claude/commands/tug-fixtures-ensure.md`

**Workflow:**
1. Run `tug fixture status`
2. Parse JSON, identify missing or sha-mismatch fixtures
3. If any need fetching: run `tug fixture fetch`
4. Report final status

#### 8.1.4 Claude Code Rules {#claude-rules}

**Spec S02: Claude Code Agent Rules** {#s02-claude-rules}

Rules to add to CLAUDE.md or `.claude/rules/`:

1. **Review before apply:** Always run `analyze-impact` and dry-run before any `--apply`
2. **Approval required:** Require explicit user confirmation for apply
3. **Exit-code driven:** If exit code is nonzero, stop and surface the JSON error; do not attempt unrelated retries
4. **No commits:** Do not run `git commit` (project rule, already in CLAUDE.md)
5. **No mutation outside tug:** Avoid manual edits in the same files between analyze and apply
6. **Deterministic reporting:** Present summaries using actual numeric fields from tug output

#### 8.1.5 Cursor Configuration {#cursor-config}

**Spec S03: Cursor Configuration** {#s03-cursor-config}

##### File: `.cursor/rules/tug.mdc`

Cursor now uses `.mdc` files in `.cursor/rules/` for project-specific rules. This is the recommended format (legacy `.cursorrules` is deprecated).

```markdown
---
description: Rules for using tug refactoring tool
alwaysApply: true
---

# Tug Refactoring Rules

When using the `tug` command for refactoring:

## Workflow

1. **Always analyze first:** Run `tug analyze-impact` before any `tug run --apply`
2. **Review patch:** Run dry-run (`tug run` without `--apply`) and review output before applying
3. **Get approval:** Ask user "Apply these changes?" before running `--apply`

## Error Handling

Handle errors by exit code:
- Exit 0: Success, continue
- Exit 2: Invalid arguments, fix and retry
- Exit 3: Symbol not found, check location
- Exit 4: Apply failed, re-analyze
- Exit 5: Verification failed, do not apply
- Exit 10: Internal error, report issue

## Safety

- Never guess: If uncertain, show the JSON error and ask for guidance
- Never run `git commit` (project policy)
- Never apply changes without showing summary first

## Commands Reference

```bash
# Analyze impact (read-only)
tug analyze-impact rename-symbol --at <file:line:col> --to <new_name>

# Dry run with verification (read-only)
tug run --verify syntax rename-symbol --at <file:line:col> --to <new_name>

# Apply with verification (modifies files)
tug run --apply --verify syntax rename-symbol --at <file:line:col> --to <new_name>

# Check fixture status
tug fixture status

# Fetch missing fixtures
tug fixture fetch
```
```

**Note:** Cursor commands (`.cursor/commands.json`) are out of scope for Phase 8. Rules-only is sufficient.

#### 8.1.6 Error Handling Playbook {#error-handling}

**Table T01: Exit Code Handling for Front Doors** {#t01-exit-handling}

| Exit | Meaning | Front Door Behavior |
|------|---------|---------------------|
| 0 | Success | Parse stdout JSON, continue workflow |
| 2 | Invalid arguments | Show error; request corrected input (location/name/flags) |
| 3 | Resolution error | Show error; suggest checking location; re-run analyze-impact |
| 4 | Apply error | Advise re-analyzing (snapshot may be stale) |
| 5 | Verification failed | Do not apply; show verification output; suggest fixing code |
| 10 | Internal error | Stop; instruct to file bug with stderr + JSON |

---

### 8.2 Symbol Inventory {#symbol-inventory}

#### 8.2.1 New Files {#new-files}

| File | Purpose |
|------|---------|
| `.claude/commands/tug-rename.md` | Full rename workflow command |
| `.claude/commands/tug-rename-plan.md` | Analyze + dry-run only command |
| `.claude/commands/tug-fixtures-ensure.md` | Fixture status/fetch command |
| `.cursor/rules/tug.mdc` | Cursor agent rules for tug usage (new `.mdc` format) |

#### 8.2.2 Files to Delete {#files-delete}

| File | Reason |
|------|--------|
| `crates/tugtool/src/mcp.rs` | MCP removal |

#### 8.2.3 Symbols to Remove {#symbols-remove}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `mcp` | module | `lib.rs` | Remove feature-gated module |
| `Command::Mcp` | variant | `main.rs` | Remove CLI subcommand |
| `execute_mcp` | fn | `main.rs` | Remove executor function |
| `mcp_parity` | module | `golden_tests.rs` | Remove test module |
| `mcp` | feature | `Cargo.toml` | Remove feature flag |
| `tokio` | dependency | `Cargo.toml` | Remove if audit shows MCP-only (see [D05]) |

---

### 8.3 Documentation Plan {#documentation-plan}

- [ ] Update CLAUDE.md to remove MCP references
- [ ] Update CLAUDE.md to add editor interop section referencing new commands
- [ ] Update README.md to remove MCP feature and commands table entry
- [ ] Update README.md to add Claude Code / Cursor integration section
- [ ] Update docs/AGENT_API.md to remove MCP Server section
- [ ] Update docs/AGENT_PLAYBOOK.md to remove MCP configuration, add Claude Code commands
- [ ] Update Justfile to remove `mcp` recipe

---

### 8.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Build** | Verify compilation without MCP | After removal |
| **Integration** | Verify CLI still works | After removal |
| **Golden** | Verify output schemas unchanged | After removal |
| **Manual** | Verify editor commands work | After command creation |

#### Verification Strategy {#verification-strategy}

1. **Compilation check:** `cargo build -p tugtool` succeeds with default features
2. **No MCP references:** `grep -r "mcp\|MCP\|rmcp" --include="*.rs" crates/` returns empty
3. **Tests pass:** `cargo nextest run --workspace`
4. **Feature flags:** `cargo build -p tugtool --features full` succeeds (full no longer includes mcp)

#### Testing Boundaries {#testing-boundaries}

**What can be CI-tested:**
- tug CLI functionality (existing tests)
- File existence (commands, rules)
- Documentation content (grep checks)

**What requires manual testing:**
- Claude Code command UX (requires Claude Code environment)
- Cursor rules behavior (requires Cursor environment)

The CLI is the testable "kernel" - editor integrations are prompt templates that instruct agents to call the CLI. The best CI can do is verify "files exist + documented workflow + tug CLI remains correct."

---

### 8.5 Execution Steps {#execution-steps}

#### Step 0: Preparation and Audit {#step-0}

**Commit:** N/A (audit only, no changes)

**References:** [D01] MCP Removal, List L01, List L02, (#context, #files-to-delete, #files-to-modify)

**Artifacts:**
- Inventory of all MCP-related code and documentation

**Tasks:**
- [ ] Identify all files containing MCP/mcp/rmcp references
- [ ] Verify no external consumers of MCP functionality
- [ ] Document the exact lines to remove in each file

**Checkpoint:**
- [ ] Complete file inventory created (this is documented in L01 and L02)

---

#### Step 1: Delete MCP Module and Update Cargo.toml {#step-1}

**Commit:** `refactor(tugtool): remove MCP server support`

**References:** [D01] MCP Removal, [D02] CLI as Kernel, [D05] Tokio Removal, List L01, List L02, (#files-to-delete, #symbols-remove)

**Artifacts:**
- Delete `crates/tugtool/src/mcp.rs`
- Updated `crates/tugtool/Cargo.toml` without MCP dependencies

**Tasks:**
- [ ] Delete `crates/tugtool/src/mcp.rs`
- [ ] **Tokio audit:** Search for `tokio` usage outside `mcp.rs`:
  - [ ] `grep -r "tokio" --include="*.rs" crates/tugtool/src/ | grep -v mcp.rs`
  - [ ] If no results: remove `tokio` dependency entirely
  - [ ] If results: keep `tokio`, update comments to reflect actual usage
- [ ] Remove from `crates/tugtool/Cargo.toml`:
  - [ ] `rmcp = { ... }` dependency
  - [ ] `schemars = { ... }` dependency
  - [ ] `tokio = { ... }` dependency (if audit confirms MCP-only)
  - [ ] `mcp = ["dep:rmcp", "dep:schemars"]` feature
  - [ ] `mcp` from `default` features
  - [ ] `mcp` from `full` features
- [ ] Update package keywords to remove "mcp"

**Tests:**
- [ ] Build: `cargo build -p tugtool`

**Checkpoint:**
- [ ] `cargo build -p tugtool` succeeds
- [ ] `grep -r "rmcp" crates/tugtool/Cargo.toml` returns empty
- [ ] Tokio audit documented (kept or removed with reason)

**Rollback:**
- Revert commit

---

#### Step 2: Update Rust Source Files {#step-2}

**Commit:** `refactor(tugtool): remove MCP from lib and main`

**References:** [D01] MCP Removal, List L02, (#symbols-remove)

**Artifacts:**
- Updated `crates/tugtool/src/lib.rs`
- Updated `crates/tugtool/src/main.rs`

**Tasks:**
- [ ] In `crates/tugtool/src/lib.rs`:
  - [ ] Remove `#[cfg(feature = "mcp")] pub mod mcp;`
  - [ ] Update module doc comments to remove MCP references
- [ ] In `crates/tugtool/src/main.rs`:
  - [ ] Remove `#[cfg(feature = "mcp")] Command::Mcp` variant
  - [ ] Remove `#[cfg(feature = "mcp")] Command::Mcp => execute_mcp()` match arm
  - [ ] Remove `execute_mcp()` function
  - [ ] Remove any MCP-related imports

**Tests:**
- [ ] Build: `cargo build -p tugtool`
- [ ] Unit: existing CLI parsing tests pass

**Checkpoint:**
- [ ] `cargo build -p tugtool` succeeds
- [ ] `cargo nextest run -p tugtool -- cli_parsing` passes
- [ ] `grep -r "mcp" crates/tugtool/src/` returns only comments or unrelated strings

**Rollback:**
- Revert commit

---

#### Step 3: Update Test Files {#step-3}

**Commit:** `test(tugtool): remove MCP-related tests`

**References:** [D01] MCP Removal, List L02, (#symbols-remove)

**Artifacts:**
- Updated `crates/tugtool/tests/golden_tests.rs`
- Updated `crates/tugtool/tests/api_surface.rs`

**Tasks:**
- [ ] In `crates/tugtool/tests/golden_tests.rs`:
  - [ ] Remove `#[cfg(feature = "mcp")] mod mcp_parity { ... }` block
- [ ] In `crates/tugtool/tests/api_surface.rs`:
  - [ ] Remove `#[cfg(feature = "mcp")] use tugtool::mcp;`

**Tests:**
- [ ] Golden: `cargo nextest run -p tugtool golden`
- [ ] API surface: `cargo nextest run -p tugtool api_surface`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool` passes
- [ ] No feature = "mcp" references in test files

**Rollback:**
- Revert commit

---

#### Step 4: Update Documentation {#step-4}

**Commit:** `docs: remove MCP references from all documentation`

**References:** [D01] MCP Removal, [D02] CLI as Kernel, List L02, (#documentation-plan)

**Artifacts:**
- Updated `CLAUDE.md`
- Updated `README.md`
- Updated `docs/AGENT_API.md`
- Updated `docs/AGENT_PLAYBOOK.md`
- Updated `Justfile`

**Tasks:**
- [ ] In `CLAUDE.md`:
  - [ ] Remove "MCP Server" section
  - [ ] Remove `| mcp | Yes | Model Context Protocol server |` from feature flags table
  - [ ] Update `tug mcp` reference if any
  - [ ] Remove MCP tools list
- [ ] In `README.md`:
  - [ ] Remove `- **MCP support** - Native Model Context Protocol server...` from Features
  - [ ] Remove `| mcp | Start MCP server |` from Commands table
  - [ ] Remove entire "### MCP Configuration" section
  - [ ] Remove "- MCP server for direct tool integration" from "For AI Agents" section
- [ ] In `docs/AGENT_API.md`:
  - [ ] Remove entire "## MCP Server" section
  - [ ] Remove `| mcp | Start MCP server on stdio | tug mcp |` from Subcommands table
  - [ ] Update Overview to remove MCP mention
- [ ] In `docs/AGENT_PLAYBOOK.md`:
  - [ ] Remove "### MCP Configuration" section
  - [ ] Remove "### Example Tool Calls" section (MCP tool calls)
  - [ ] Update "### Agent Instructions Snippet" to use CLI instead of MCP
- [ ] In `Justfile`:
  - [ ] Remove `mcp:` recipe

**Tests:**
- [ ] Grep check: `grep -ri "mcp" CLAUDE.md README.md docs/ Justfile` returns empty or only false positives

**Checkpoint:**
- [ ] No MCP references in documentation
- [ ] `just --list` shows no `mcp` recipe

**Rollback:**
- Revert commit

---

#### Step 5: Verify Clean Removal {#step-5}

**Commit:** N/A (verification only)

**References:** [D01] MCP Removal, (#success-criteria)

**Tasks:**
- [ ] Run comprehensive grep: `grep -ri "mcp\|rmcp" --include="*.rs" --include="*.toml" --include="*.md" .`
- [ ] Verify only expected results (plans/extras/editor-interop.md may reference MCP as historical context)
- [ ] Run full test suite: `cargo nextest run --workspace`
- [ ] Verify Cargo.lock updated (no rmcp entries)

**Checkpoint:**
- [ ] `cargo nextest run --workspace` passes
- [ ] `grep -r "rmcp" Cargo.lock` returns empty
- [ ] Build with all features: `cargo build -p tugtool --features full`

---

#### Step 5 Summary: MCP Removal Complete {#step-5-summary}

After Steps 1-5, the codebase will have:
- No MCP server code
- No rmcp/schemars dependencies
- No MCP feature flag
- No MCP documentation
- Simpler build, fewer dependencies

**Final Part 1 Checkpoint:**
- [ ] `cargo build -p tugtool` succeeds
- [ ] `cargo nextest run --workspace` passes
- [ ] No MCP references except historical context in plan files

---

#### Step 6: Create Claude Code Rename Command {#step-6}

**Commit:** `feat(interop): add /tug-rename Claude Code command`

**References:** [D02] CLI as Kernel, [D03] Decision Gates, [D04] No Apply Without Approval, Spec S01, (#cmd-tug-rename)

**Artifacts:**
- New file: `.claude/commands/tug-rename.md`

**Tasks:**
- [ ] Create `.claude/commands/tug-rename.md` with:
  - [ ] Command description and purpose
  - [ ] Input requirements (new_name from user, location from context)
  - [ ] Full workflow algorithm with decision gates
  - [ ] Exit code handling per Table T01
  - [ ] Example usage

**File content:**
```markdown
# /tug-rename

Rename a symbol using tug with full verification workflow.

## Workflow

This command performs a safe rename operation with three decision gates:

1. **Analyze Impact** - Identify all references and assess risk
2. **Dry Run** - Generate patch and verify syntax
3. **Apply** - Write changes after explicit approval

## Usage

When the user wants to rename a symbol:

1. Determine the location from current file and cursor position as `<file>:<line>:<col>` (1-indexed)
2. Ask for the new name if not provided

### Step 1: Analyze Impact

```bash
tug analyze-impact rename-symbol --at <file:line:col> --to <new_name>
```

Parse the JSON output. Check:
- If `references_count == 0`: Stop and inform user "No references found at this location. Please position cursor on the symbol definition or a reference."
- If `files_affected > 50` OR `edits_estimated > 500`: Warn user this is a large refactor and ask for explicit confirmation before proceeding.

### Step 2: Dry Run with Verification

```bash
tug run --verify syntax rename-symbol --at <file:line:col> --to <new_name>
```

Parse the JSON output. Present summary:
- Files to change: N
- Total edits: M
- Verification: passed/failed

If verification failed: Stop and show the verification output. Do not proceed.

### Step 3: Apply (with approval)

Show the summary and ask: "Apply these changes? (yes/no)"

Only if user approves:

```bash
tug run --apply --verify syntax rename-symbol --at <file:line:col> --to <new_name>
```

Report the result.

## Error Handling

| Exit Code | Action |
|-----------|--------|
| 0 | Success - continue workflow |
| 2 | Invalid arguments - show error, ask for corrected input |
| 3 | Symbol not found - suggest different location |
| 4 | Apply failed - suggest re-analyzing |
| 5 | Verification failed - do not apply, show errors |
| 10 | Internal error - report bug |

## Example

User: "Rename the function process_data to transform_data"

1. Get location from cursor (e.g., `src/utils.py:42:5`)
2. Run analyze-impact
3. Show: "Found 3 references across 2 files"
4. Run dry-run
5. Show: "Changes: 2 files, 4 edits. Verification: passed"
6. Ask: "Apply these changes?"
7. If yes: Apply and report success
```

**Tests:**
- [ ] Manual: Run `/tug-rename` in Claude Code (requires Claude Code environment)

**Checkpoint:**
- [ ] File exists at `.claude/commands/tug-rename.md`
- [ ] File content matches spec

**Rollback:**
- Delete file

---

#### Step 7: Create Claude Code Plan Command {#step-7}

**Commit:** `feat(interop): add /tug-rename-plan Claude Code command`

**References:** [D02] CLI as Kernel, Spec S01, (#cmd-tug-rename-plan)

**Artifacts:**
- New file: `.claude/commands/tug-rename-plan.md`

**Tasks:**
- [ ] Create `.claude/commands/tug-rename-plan.md` with:
  - [ ] Command description (analyze + dry-run only)
  - [ ] Workflow stopping at dry-run
  - [ ] Clear statement that this does NOT apply changes

**File content:**
```markdown
# /tug-rename-plan

Analyze and preview a rename without applying changes.

## Purpose

This command shows what a rename would do without making any changes. Use this for:
- Reviewing impact before deciding to rename
- Understanding scope of a refactor
- Cautious workflows where you want to review before committing to changes

## Workflow

1. Determine the location from current file and cursor position
2. Ask for the new name if not provided
3. Run analyze-impact and show references
4. Run dry-run and show patch preview
5. **Stop here** - do not apply

### Step 1: Analyze Impact

```bash
tug analyze-impact rename-symbol --at <file:line:col> --to <new_name>
```

Show:
- Symbol name and kind
- Number of references found
- Files affected

### Step 2: Dry Run Preview

```bash
tug run --verify syntax rename-symbol --at <file:line:col> --to <new_name>
```

Show:
- Files that would change
- Number of edits
- Verification status
- (Optional) First few edits as preview

## What This Command Does NOT Do

- Does NOT apply any changes
- Does NOT modify any files
- Does NOT require approval (nothing to approve)

If you want to apply the changes, use `/tug-rename` instead.

## Error Handling

Same as `/tug-rename` - show errors and stop.
```

**Checkpoint:**
- [ ] File exists at `.claude/commands/tug-rename-plan.md`

**Rollback:**
- Delete file

---

#### Step 8: Create Claude Code Fixtures Command {#step-8}

**Commit:** `feat(interop): add /tug-fixtures-ensure Claude Code command`

**References:** Spec S01, (#cmd-tug-fixtures-ensure)

**Artifacts:**
- New file: `.claude/commands/tug-fixtures-ensure.md`

**Tasks:**
- [ ] Create `.claude/commands/tug-fixtures-ensure.md`

**File content:**
```markdown
# /tug-fixtures-ensure

Ensure test fixtures are fetched and ready for use.

## Purpose

Tugtool uses external test fixtures (like Temporale) for integration tests. This command checks fixture status and fetches any missing fixtures.

## Workflow

### Step 1: Check Status

```bash
tug fixture status
```

Parse the JSON output. For each fixture, check the `state` field:
- `fetched` - Fixture is ready
- `missing` - Fixture needs to be fetched
- `sha-mismatch` - Fixture is outdated

### Step 2: Fetch if Needed

If any fixtures are `missing` or `sha-mismatch`:

```bash
tug fixture fetch
```

### Step 3: Report Status

Show final status of all fixtures:
- Name
- State (should all be `fetched`)
- Path

## Example Output

"Fixture status:
- temporale: fetched at .tug/fixtures/temporale/

All fixtures ready."

Or if fetch was needed:

"Fixture status:
- temporale: missing

Fetching fixtures...

Fixture status after fetch:
- temporale: fetched at .tug/fixtures/temporale/

All fixtures ready."

## Error Handling

If fetch fails, show the error and suggest:
- Check network connectivity
- Verify the fixture repository is accessible
- Try `tug fixture fetch --force` to re-fetch
```

**Checkpoint:**
- [ ] File exists at `.claude/commands/tug-fixtures-ensure.md`

**Rollback:**
- Delete file

---

#### Step 9: Update CLAUDE.md with Interop Section {#step-9}

**Commit:** `docs: add editor interop section to CLAUDE.md`

**References:** [D02] CLI as Kernel, Spec S02, (#claude-rules)

**Artifacts:**
- Updated `CLAUDE.md` with editor interop section

**Tasks:**
- [ ] Add new section "## Editor Integration" to CLAUDE.md
- [ ] Document the available commands
- [ ] Add agent rules inline

**Content to add:**
```markdown
## Editor Integration

Tugtool integrates with Claude Code and Cursor via custom commands and rules.

### Claude Code Commands

The following commands are available in `.claude/commands/`:

| Command | Purpose |
|---------|---------|
| `/tug-rename` | Full rename workflow with analyze, review, and apply |
| `/tug-rename-plan` | Analyze and preview only (no apply) |
| `/tug-fixtures-ensure` | Ensure test fixtures are fetched |

### Agent Rules for Tug

When using tug for refactoring, follow these rules:

1. **Always analyze first**: Run `analyze-impact` before any `run --apply`
2. **Review before apply**: Run dry-run and show summary before applying
3. **Get explicit approval**: Never apply changes without user confirmation
4. **Handle errors by exit code**: See Table T26 for exit code meanings
5. **No mutation during workflow**: Don't manually edit files between analyze and apply
6. **Report actual numbers**: Use values from JSON output, don't estimate
```

**Checkpoint:**
- [ ] CLAUDE.md contains "Editor Integration" section
- [ ] Commands table lists all three commands

**Rollback:**
- Revert changes to CLAUDE.md

---

#### Step 10: Create Cursor Configuration {#step-10}

**Commit:** `feat(interop): add Cursor rules configuration`

**References:** Spec S03, [Q01] Cursor rules format (RESOLVED), (#cursor-config)

**Artifacts:**
- New file: `.cursor/rules/tug.mdc`

**Tasks:**
- [ ] Create `.cursor/rules/` directory
- [ ] Create `.cursor/rules/tug.mdc` file with agent rules (see Spec S03 for content)
- [ ] Document cursor integration in docs

**File content for `.cursor/rules/tug.mdc`:**
```markdown
---
description: Rules for using tug refactoring tool
alwaysApply: true
---

# Tug Refactoring Rules

When using the `tug` command for refactoring:

## Workflow

1. **Always analyze first:** Run `tug analyze-impact` before any `tug run --apply`
2. **Review patch:** Run dry-run (`tug run` without `--apply`) and review output before applying
3. **Get approval:** Ask user "Apply these changes?" before running `--apply`

## Error Handling

Handle errors by exit code:
- Exit 0: Success, continue
- Exit 2: Invalid arguments, fix and retry
- Exit 3: Symbol not found, check location
- Exit 4: Apply failed, re-analyze
- Exit 5: Verification failed, do not apply
- Exit 10: Internal error, report issue

## Safety

- Never guess: If uncertain, show the JSON error and ask for guidance
- Never run `git commit` (project policy)
- Never apply changes without showing summary first

## Commands Reference

```bash
# Analyze impact (read-only)
tug analyze-impact rename-symbol --at <file:line:col> --to <new_name>

# Dry run with verification (read-only)
tug run --verify syntax rename-symbol --at <file:line:col> --to <new_name>

# Apply with verification (modifies files)
tug run --apply --verify syntax rename-symbol --at <file:line:col> --to <new_name>

# Check fixture status
tug fixture status

# Fetch missing fixtures
tug fixture fetch
```
```

**Checkpoint:**
- [ ] `.cursor/rules/tug.mdc` file exists
- [ ] File contains workflow rules and error handling
- [ ] File has valid `.mdc` frontmatter

**Rollback:**
- Delete `.cursor/rules/` directory

---

#### Step 11: Update Agent Playbook {#step-11}

**Commit:** `docs: update AGENT_PLAYBOOK with Claude Code integration`

**References:** [D02] CLI as Kernel, (#documentation-plan)

**Artifacts:**
- Updated `docs/AGENT_PLAYBOOK.md`

**Tasks:**
- [ ] Replace MCP configuration section with Claude Code commands section
- [ ] Update example snippets to show command usage
- [ ] Add Cursor section

**Checkpoint:**
- [ ] No MCP references in AGENT_PLAYBOOK.md
- [ ] Claude Code section documents commands
- [ ] Cursor section documents rules file

**Rollback:**
- Revert changes

---

#### Step 12: Final Verification {#step-12}

**Commit:** N/A (verification only)

**References:** (#success-criteria)

**Tasks:**
- [ ] Full build: `cargo build --workspace`
- [ ] Full test suite: `cargo nextest run --workspace`
- [ ] Grep verification: no unexpected MCP references
- [ ] Documentation review: all docs updated
- [ ] Claude Code command test: manually test in Claude Code environment

**Checkpoint:**
- [ ] All tests pass
- [ ] All documentation updated
- [ ] Commands work in Claude Code (manual verification)
- [ ] `.cursor/rules/tug.mdc` present

---

### 8.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tugtool without MCP, with Claude Code commands and Cursor rules for editor integration.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build -p tugtool` succeeds with no MCP code
- [ ] `cargo nextest run --workspace` passes
- [ ] No MCP references in code or user-facing documentation (except historical context in `plans/`)
- [ ] `.claude/commands/tug-rename.md` exists and follows spec
- [ ] `.claude/commands/tug-rename-plan.md` exists and follows spec
- [ ] `.claude/commands/tug-fixtures-ensure.md` exists and follows spec
- [ ] `.cursor/rules/tug.mdc` exists and follows spec
- [ ] CLAUDE.md updated with editor integration section

**Acceptance tests:**
- [ ] Build: `cargo build -p tugtool`
- [ ] Tests: `cargo nextest run --workspace`
- [ ] Grep: `grep -r "rmcp" --include="*.rs" --include="*.toml" crates/` returns empty

#### Milestones (Within Phase) {#milestones}

**Milestone M01: MCP Removed** {#m01-mcp-removed}
- [ ] All MCP code deleted
- [ ] All dependencies removed
- [ ] Build succeeds

**Milestone M02: Claude Code Integration Complete** {#m02-claude-code}
- [ ] All three commands created
- [ ] CLAUDE.md updated

**Milestone M03: Cursor Integration Complete** {#m03-cursor}
- [ ] `.cursor/rules/tug.mdc` created
- [ ] Documentation updated

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Test commands in production Claude Code environment
- [ ] Add more refactoring operations to commands as they're implemented
- [ ] Consider VS Code extension for non-AI editor users
- [ ] Add `tug doctor` command for environment verification

| Checkpoint | Verification |
|------------|--------------|
| MCP removed | `grep -r "rmcp" Cargo.lock` returns empty |
| Tests pass | `cargo nextest run --workspace` |
| Commands exist | `ls .claude/commands/tug-*.md` shows 3 files |
| Rules exist | `cat .cursor/rules/tug.mdc` shows content |

---

### Implementation Log {#implementation-log}

| Step | Status | Date | Notes |
|------|--------|------|-------|
| Step 0 | pending | | |
| Step 1 | pending | | |
| Step 2 | pending | | |
| Step 3 | pending | | |
| Step 4 | pending | | |
| Step 5 | pending | | |
| Step 6 | pending | | |
| Step 7 | pending | | |
| Step 8 | pending | | |
| Step 9 | pending | | |
| Step 10 | pending | | |
| Step 11 | pending | | |
| Step 12 | pending | | |
