## Phase 1.0: Fix infrastructure bugs and eliminate implement-setup-agent {#phase-eliminate-setup-agent}

**Purpose:** Fix three blocking bugs in the tugtool CLI (absolute path join in worktree creation, beads initialization failure, and wrong directory name in doctor command), then remove the implement-setup-agent LLM agent and replace it with a direct `tugtool worktree create` CLI call from the implement orchestrator, eliminating an unnecessary Sonnet spawn and its recurring failure modes.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-14 |
| Beads Root | `tugtool-9jh` |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The implement-setup-agent is an LLM agent that exists solely to run `tugtool worktree create <plan> --json` and parse the output. It performs zero reasoning work — it is a thin wrapper around a single CLI command. Despite this simplicity, it is the source of recurring failures: wrong working directory, git not initialized, the agent improvising extra steps. Replacing it with a direct CLI call from the orchestrator eliminates an entire agent spawn, removes a class of failure modes, and speeds up every implementation session.

Before the agent can be removed, three bugs in the tugtool CLI must be fixed. These bugs prevent `tugtool worktree create` from succeeding and would block both the current agent-based flow and the planned direct CLI call:

1. **Absolute path join bug** — In `worktree.rs`, multiple call sites join `plan_path` (or the raw `plan` String) with `worktree_path` or pass it to `git add`. When `plan_path` is absolute, `PathBuf::join` discards the worktree base, and `git add` tries to stage a path outside the worktree. Affected sites: plan file copy (line 639), `sync_beads_in_worktree` (line 187), `commit_bead_annotations` (line 234), and re-read after sync (line 788).
2. **Beads initialization failure** — The auto-init code in worktree creation calls `beads.init()` without first checking whether `bd` is installed. When `bd` is missing, the error is unclear and does not guide the user to install it. The fix is to add an `is_installed()` check before `init()` and fail with a clear, actionable `TugError::BeadsNotInstalled` error (which already exists with exit code 5).
3. **Doctor command uses wrong directory and filename references** — The `doctor.rs` command hardcodes stale names throughout all five health check functions: `check_initialized()` uses `.tug/` and `plan-skeleton.md`; `check_log_size()` uses `.tug/plan-implementation-log.md`; `check_worktrees()` uses `.tug.worktrees` and `tug__` prefix; `check_orphaned_sessions()` uses `.tug.worktrees/.sessions`; `check_broken_refs()` uses `.tug/` and `plan-` prefix. The correct values are `.tugtool/`, `tugplan-` prefix, `.tugtree`, and `tugtool__` prefix respectively.

The implement orchestrator skill currently uses a PreToolUse hook that blocks all Bash, Write, and Edit calls, enforcing that the orchestrator delegates everything through Task. To allow the orchestrator to run `tugtool` commands directly, the hook must be updated to use a pattern-based allowlist that permits Bash calls starting with `tugtool` while continuing to block all other direct tool usage.

#### Strategy {#strategy}

- Fix the three blocking infrastructure bugs first (Steps 0-2), since they prevent worktree creation from succeeding
- Fix the absolute path join in `worktree.rs` by normalizing the `plan` String to a relative path at the top of `run_worktree_create_with_root()`, so all downstream uses (plan copy, beads sync, bead commit, post-sync re-read) automatically get a relative path
- Fix the beads initialization by adding an `is_installed()` check before `init()` — fail with a clear, actionable error (`TugError::BeadsNotInstalled`, exit code 5) when `bd` is not installed, with proper JSON error output when `--json` is used
- Fix the doctor command by updating all five health check functions: replace `.tug/` with `.tugtool/`, `.tug.worktrees` with `.tugtree`, `plan-` prefixed filenames with `tugplan-` prefixed filenames, and `tug__` prefix with `tugtool__`
- Then proceed with the agent elimination: update the PreToolUse hook, replace the setup agent spawn, delete the agent file and update references
- Default step selection to "all remaining steps" — no interactive step selection, no ambiguity
- On CLI failure (non-zero exit), output the error and HALT immediately — no retries

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool users running `/tugtool:implement` to execute tugplans
2. Tugtool maintainers who debug implementation session failures

#### Success Criteria (Measurable) {#success-criteria}

- `tugtool worktree create .tugtool/tugplan-1.md` succeeds when invoked with an absolute plan path (no path-join bug)
- `tugtool worktree create` fails with a clear, actionable error message when `bd` is not installed (exit code 5, proper JSON error when `--json` is used)
- `tugtool doctor` correctly detects `.tugtool/` directory, `tugplan-` prefixed files, `.tugtree` worktree directory, and `tugtool__` worktree prefix
- `agents/implement-setup-agent.md` does not exist after implementation
- `cargo nextest run` passes with zero warnings (all tests updated to reflect 9 agents)
- The implement orchestrator SKILL.md runs `tugtool worktree create` directly via Bash without spawning a setup agent
- The PreToolUse hook blocks non-`tugtool` Bash commands while allowing `tugtool` commands

#### Scope {#scope}

1. Fix absolute path join bug in `crates/tugtool/src/commands/worktree.rs`
2. Fix beads initialization failure handling in `crates/tugtool/src/commands/worktree.rs`
3. Fix directory/filename references in `crates/tugtool/src/commands/doctor.rs`
4. PreToolUse hook update in `skills/implement/SKILL.md`
5. Orchestration loop rewrite (sections 1-2) in `skills/implement/SKILL.md`
6. Deletion of `agents/implement-setup-agent.md`
7. Update CLAUDE.md agent tables and counts
8. Update `agent_integration_tests.rs` to reflect reduced agent count

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the `tugtool worktree create` CLI output format (beyond bug fixes)
- Modifying any other agents (architect, coder, reviewer, committer, auditor, integrator)
- Adding retry logic for worktree creation failures
- Adding interactive step selection (we default to all remaining)
- Changing the planner skill's PreToolUse hook (only implement skill changes)
- Rewriting the doctor command beyond fixing the directory/filename references

#### Dependencies / Prerequisites {#dependencies}

- `tugtool worktree create --json` already emits comprehensive JSON output with proper exit codes for all failure modes
- The PreToolUse hook system supports pattern-based matching

#### Constraints {#constraints}

- Must not break any existing tests (`cargo nextest run` clean)
- Must maintain `-D warnings` compliance
- Must preserve the orchestrator's progress reporting format so downstream agents see the same data shape

#### Assumptions {#assumptions}

- The PreToolUse hook can distinguish commands by prefix pattern matching (the hook inspects the Bash command string)
- The `worktree create` JSON output contains all fields the orchestrator needs: `worktree_path`, `branch_name`, `base_branch`, `all_steps`, `ready_steps`, `bead_mapping`, `root_bead_id`
- Step selection defaults to "all remaining" without user interaction
- The `bd` CLI is a hard requirement for the implementer workflow; worktree creation must fail with a clear error if `bd` is not installed

---

### Risks and Mitigations {#risks}

**Risk R01: PreToolUse hook command inspection mechanism is unverified** {#r01-hook-mechanism}

- **Risk:** The proposed `$MCP_TOOL_INPUT` environment variable (or equivalent) for inspecting Bash command content inside a PreToolUse hook has not been verified to exist in the Claude Code hook runtime. If the mechanism does not work, Steps 3 and 4 cannot be implemented as designed.
- **Mitigation:**
  - Step 3 includes a task to verify the actual mechanism before committing the hook change. If `$MCP_TOOL_INPUT` is not available, the implementer must discover the correct inspection mechanism from Claude Code documentation or experimentation.
  - Fallback: if no command inspection mechanism exists, the hook can allow all Bash commands (remove the Bash matcher entirely) and rely on the orchestrator prose instructions to restrict usage to `tugtool` commands only. This is less safe but functional.
- **Residual risk:** If no hook-based filtering is possible, the orchestrator could theoretically run non-tugtool Bash commands. This is mitigated by the orchestrator's own instructions which explicitly forbid it.

---

### 1.0.0 Design Decisions {#design-decisions}

#### [D01] Pattern-based Bash allowlist in PreToolUse hook (DECIDED) {#d01-pattern-allowlist}

**Decision:** The PreToolUse hook inspects the Bash command string; commands starting with `tugtool` are allowed, all other Bash commands are blocked. Write and Edit remain blocked unconditionally.

**Rationale:**
- The orchestrator needs exactly one type of direct CLI call: `tugtool` commands
- Pattern matching on command prefix is simple, auditable, and safe
- Write/Edit remain fully blocked because the orchestrator should never modify files directly

**Implications:**
- The hook matcher changes from blocking all `Bash|Write|Edit` to: allow Bash if command starts with `tugtool`, block otherwise; always block Write and Edit
- Future `tugtool` CLI commands can be called directly by the orchestrator without additional hook changes

#### [D02] Default to all remaining steps, no interactive selection (DECIDED) {#d02-default-all-remaining}

**Decision:** The orchestrator always implements all remaining steps (from `ready_steps`). There is no interactive step selection prompt.

**Rationale:**
- The setup agent's step selection logic was the source of `needs_clarification` round-trips that added complexity
- "All remaining" is the correct default for nearly every session
- Users who want specific steps can re-run after completion or modify the plan

**Implications:**
- The `needs_clarification` status and `AskUserQuestion` for step selection are removed from the setup flow
- `resolved_steps` is always set to `ready_steps` (or `all_steps` if `ready_steps` is null)

#### [D03] HALT on CLI failure, no retry (DECIDED) {#d03-halt-on-failure}

**Decision:** If `tugtool worktree create` exits non-zero, the orchestrator outputs the error message and HALTs immediately. No automatic retry.

**Rationale:**
- Worktree creation failures (git not initialized, plan not found, bead sync issues) are not transient — retrying does not help
- The setup agent's retry attempts often made things worse by improvising
- Users can fix the underlying issue and re-run `/tugtool:implement`

**Implications:**
- The error path is simple: parse stderr, format failure message, stop
- No `needs_clarification` status in the setup flow

#### [D04] Orchestrator parses CLI JSON directly (DECIDED) {#d04-orchestrator-parses-json}

**Decision:** The orchestrator parses the JSON output of `tugtool worktree create --json` directly and derives session state (completed_steps, remaining_steps, resolved_steps) inline, rather than delegating to an agent.

**Rationale:**
- The JSON parsing is mechanical: extract fields, compute set differences
- An LLM agent adds latency and failure risk for zero reasoning benefit
- The orchestrator already parses JSON from every other agent

**Implications:**
- The orchestrator must include inline logic for deriving `completed_steps = all_steps - ready_steps` and `resolved_steps = ready_steps || all_steps`
- The setup post-call progress message is generated directly from parsed CLI output

#### [D05] Normalize plan path to relative at function entry (DECIDED) {#d05-strip-plan-path-relative}

**Decision:** Normalize the `plan` String to a relative path at the top of `run_worktree_create_with_root()` (around line 464), immediately after constructing `plan_path`. If the path is absolute and starts with `repo_root`, strip the prefix. This single normalization point ensures all downstream uses automatically get a relative path.

**Rationale:**
- `PathBuf::join` with an absolute path discards the left-hand base entirely — this is documented Rust behavior
- The `plan` String flows through four downstream call sites that join it with `worktree_path` or pass it to `git add`: plan file copy (line 639), `sync_beads_in_worktree` (line 719 via line 187), `commit_bead_annotations` (line 722 via line 234), and post-sync re-read (line 788)
- Fixing at the top of the function (single normalization point) is safer than patching each call site individually, because it prevents future call sites from hitting the same bug

**Implications:**
- Both `plan` (String) and `plan_path` (PathBuf) must be normalized — `plan` is passed to `sync_beads_in_worktree` and `commit_bead_annotations` as `&str`, while `plan_path` is used for `PathBuf::join` operations
- After normalization, `repo_root.join(&plan_path)` still works correctly (joining a relative path onto an absolute base is fine)
- The normalization must handle the case where the absolute path does not start with `repo_root` (keep the original path as a fallback)

#### [D06] Fail fast with clear error when bd is not installed (DECIDED) {#d06-fail-fast-beads-not-installed}

**Decision:** When `bd` is not installed, worktree creation fails immediately with `TugError::BeadsNotInstalled` (exit code 5) and a clear, actionable error message. No fallback, no warning-and-continue.

**Rationale:**
- Beads is a hard requirement for the implementer workflow, not an optional enhancement
- The entire bead-mediated agent communication pattern depends on beads: architect reads/writes bead design field, coder reads strategy from beads, reviewer reads notes from beads, committer closes beads, and `bd ready` queries drive the step loop
- There is no viable fallback when `bd` is missing -- proceeding without beads would produce a broken implementation session where agents cannot communicate through the bead protocol
- The existing `TugError::BeadsNotInstalled` variant (error.rs line 99-101) and exit code 5 (error.rs line 280) already exist for this exact purpose

**Implications:**
- The beads auto-init block must call `beads.is_installed()` before `beads.init()` -- the real bug is that current code (lines 576-589) calls `init()` without checking `is_installed()`
- When `bd` is not installed: return `TugError::BeadsNotInstalled` which produces exit code 5 and a clear error message telling the user to install `bd`
- When `--json` is used: the error must produce a proper JSON error object (not just text to stderr)
- When `bd` IS installed but `init()` fails: keep existing error handling (already produces proper exit code)

#### [D07] Fix doctor command directory and filename references (DECIDED) {#d07-fix-doctor-references}

**Decision:** Replace all hardcoded stale references in all five health check functions in `doctor.rs`: `.tug/` becomes `.tugtool/`, `.tug.worktrees` becomes `.tugtree`, `plan-` prefix becomes `tugplan-` prefix, and `tug__` becomes `tugtool__`.

**Rationale:**
- The project was renamed from `tug` to `tugtool` but `doctor.rs` was not updated
- All five health checks (`check_initialized`, `check_log_size`, `check_worktrees`, `check_orphaned_sessions`, `check_broken_refs`) silently produce wrong results because they look in wrong directories with wrong name patterns
- The worktree directory changed from `.tug.worktrees` to `.tugtree` and the worktree name prefix from `tug__` to `tugtool__`

**Implications:**
- Replacements span all five functions, not just three — `check_worktrees()` and `check_orphaned_sessions()` have the same class of stale reference bug
- After the fix, `tugtool doctor` will correctly detect initialization status, find plan files, validate worktree paths, and detect orphaned sessions

---

### 1.0.1 Execution Steps {#execution-steps}

#### Step 0: Fix absolute path join bug in worktree.rs {#step-0}

**Bead:** `tugtool-9jh.1`

**Commit:** `fix(worktree): normalize plan path to relative at function entry`

**References:** [D05] Normalize plan path to relative at function entry, (#context, #strategy)

**Artifacts:**
- Modified `crates/tugtool/src/commands/worktree.rs` — `run_worktree_create_with_root()` function, single normalization point at the top

**Tasks:**
- [ ] In `run_worktree_create_with_root()`, immediately after `let plan_path = PathBuf::from(&plan);` (line 464), add normalization logic that strips the `repo_root` prefix when the path is absolute. Reassign both `plan` (String) and `plan_path` (PathBuf) so all downstream uses automatically get relative paths:
  ```rust
  // Normalize plan path to relative — PathBuf::join discards the base when
  // the right-hand side is absolute, which breaks worktree path construction.
  let (plan, plan_path) = if plan_path.is_absolute() {
      match plan_path.strip_prefix(&repo_root) {
          Ok(rel) => (rel.to_string_lossy().to_string(), rel.to_path_buf()),
          Err(_) => (plan, plan_path), // keep original if prefix doesn't match
      }
  } else {
      (plan, plan_path)
  };
  ```
- [ ] Verify that normalization fixes all four downstream call sites without per-site changes:
  - Line 639: `worktree_path.join(&plan_path)` — plan file copy
  - Line 719: `sync_beads_in_worktree(&worktree_path, &plan)` — passes `&plan` as `plan_path: &str` to line 187 where `worktree_path.join(plan_path)` occurs, and to line 158 where it is passed to `beads sync` as an argument
  - Line 722: `commit_bead_annotations(&worktree_path, &plan, plan_name)` — passes `&plan` as `plan_path: &str` to line 234 where `git add plan_path` stages the file (absolute paths would try to stage outside the worktree)
  - Line 788: `worktree_path.join(&plan)` — re-reads the synced plan after bead sync
- [ ] Confirm that `repo_root.join(&plan_path)` at lines 467 and 482 still works correctly after normalization (joining a relative path onto an absolute base is valid)

**Tests:**
- [ ] Unit test: verify that when `plan` is absolute (e.g., `/abs/path/.tugtool/tugplan-1.md`) and `repo_root` is `/abs/path`, the resulting worktree plan path is `<worktree>/.tugtool/tugplan-1.md`, not `/abs/path/.tugtool/tugplan-1.md`
- [ ] Unit test: verify that when `plan` is relative (e.g., `.tugtool/tugplan-1.md`), behavior is unchanged
- [ ] Unit test: verify that `sync_beads_in_worktree` receives a relative path (not absolute) by checking the plan argument passed to the beads sync command
- [ ] Unit test: verify that `commit_bead_annotations` receives a relative path for `git add`

**Checkpoint:**
- [ ] `cargo build` succeeds with zero warnings
- [ ] `cargo nextest run` passes
- [ ] `grep -n 'worktree_path.join.*plan' crates/tugtool/src/commands/worktree.rs` shows that all join sites use the normalized variable (no raw `&plan` or `&plan_path` before normalization)

**Rollback:**
- Revert the normalization block in `run_worktree_create_with_root()`

**Commit after all checkpoints pass.**

---

#### Step 1: Fix beads initialization failure in worktree creation {#step-1}

**Depends on:** #step-0

**Bead:** `tugtool-9jh.2`

**Commit:** `fix(worktree): fail fast with clear error when bd CLI is not installed`

**References:** [D06] Fail fast with clear error when bd is not installed, (#context, #strategy)

**Artifacts:**
- Modified `crates/tugtool/src/commands/worktree.rs` — beads auto-init block (lines 576-589)

**Tasks:**
- [ ] In the beads auto-init block (lines 576-589 of `worktree.rs`), add a `beads.is_installed()` check **before** calling `beads.init()`. The real bug is that current code calls `init()` without checking `is_installed()`, leading to unclear errors when `bd` is missing:
  ```rust
  {
      use tugtool_core::beads::BeadsCli;
      let beads = BeadsCli::default();
      if !beads.is_installed(None) {
          // bd CLI is not installed — fail fast with a clear, actionable error
          let err = TugError::BeadsNotInstalled;
          if json_output {
              let error_json = serde_json::json!({
                  "status": "error",
                  "error": err.to_string(),
                  "exit_code": err.exit_code()
              });
              eprintln!("{}", error_json);
          } else {
              eprintln!("error: {}", err);
          }
          return Ok(err.exit_code());
      }
      // bd is installed — proceed with init if needed
      if !beads.is_initialized(&repo_root) {
          if let Err(e) = beads.init(&repo_root) {
              // init() failed for a reason other than missing bd — keep existing error handling
              if json_output {
                  eprintln!(r#"{{"error": "{}"}}"#, e);
              }
              return Ok(e.exit_code());
          }
      }
  }
  ```
- [ ] The `TugError::BeadsNotInstalled` variant already exists in `error.rs` (lines 99-101) with exit code 5 (line 280) and a user-facing message — no new error type is needed
- [ ] When `--json` is used and `bd` is not installed, produce a proper JSON error object to stderr with `status`, `error`, and `exit_code` fields, then return exit code 5
- [ ] When `bd` IS installed but `init()` fails for other reasons, keep the existing error handling (already produces proper exit code)

**Tests:**
- [ ] Unit test: verify that when `bd` is not installed, the function returns exit code 5 (`TugError::BeadsNotInstalled`)
- [ ] Unit test: verify that when `--json` is used and `bd` is not installed, the stderr output is valid JSON with `status: "error"` and `exit_code: 5`
- [ ] `cargo build` succeeds with zero warnings
- [ ] `cargo nextest run` passes

**Checkpoint:**
- [ ] `cargo build` succeeds with zero warnings
- [ ] `cargo nextest run` passes
- [ ] The beads auto-init block checks `is_installed()` before calling `init()`
- [ ] When `bd` is not installed, the error path produces exit code 5 and a clear error message
- [ ] When `--json` is used and `bd` is not installed, stderr contains a valid JSON error object

**Rollback:**
- Revert the beads auto-init block changes in `worktree.rs`

**Commit after all checkpoints pass.**

---

#### Step 2: Fix doctor command directory and filename references {#step-2}

**Depends on:** #step-0

**Bead:** `tugtool-9jh.3`

**Commit:** `fix(doctor): update all five health checks to use correct directory and filename references`

**References:** [D07] Fix doctor command directory and filename references, (#context, #strategy)

**Artifacts:**
- Modified `crates/tugtool/src/commands/doctor.rs` — all five health check functions: `check_initialized()`, `check_log_size()`, `check_worktrees()`, `check_orphaned_sessions()`, `check_broken_refs()`

**Tasks:**

*`check_initialized()` function:*
- [ ] Line 165: change `Path::new(".tug")` to `Path::new(".tugtool")`
- [ ] Line 171: change error message from `".tug/ directory missing"` to `".tugtool/ directory missing"`
- [ ] Line 177: change `"plan-skeleton.md"` to `"tugplan-skeleton.md"` in the `required_files` array
- [ ] Line 202: change `"Tug is initialized"` to `"Tugtool is initialized"`

*`check_log_size()` function:*
- [ ] Line 209: change `Path::new(".tug/plan-implementation-log.md")` to `Path::new(".tugtool/tugplan-implementation-log.md")`

*`check_worktrees()` function:*
- [ ] Line 277: change `Path::new(".tug.worktrees")` to `Path::new(".tugtree")`
- [ ] Line 310: change `dir_name.starts_with("tug__")` to `dir_name.starts_with("tugtool__")`
- [ ] Line 307 comment: update from `tug__*` to `tugtool__*` pattern

*`check_orphaned_sessions()` function:*
- [ ] Line 490 doc comment: change `.tug.worktrees/.sessions/` to `.tugtree/.sessions/`
- [ ] Line 493: change `Path::new(".tug.worktrees/.sessions")` to `Path::new(".tugtree/.sessions")`
- [ ] Line 524: change recommendation string from `rm -rf .tug.worktrees/.sessions` to `rm -rf .tugtree/.sessions`
- [ ] Line 543: change recommendation string from `rm -rf .tug.worktrees/.sessions` to `rm -rf .tugtree/.sessions`

*`check_broken_refs()` function:*
- [ ] Line 602: change `Path::new(".tug")` to `Path::new(".tugtool")`
- [ ] Line 607: change message from `"No .tug directory to check"` to `"No .tugtool directory to check"`
- [ ] Line 619: change error message from `".tug directory"` to `".tugtool directory"`
- [ ] Line 632: change `filename.starts_with("plan-")` to `filename.starts_with("tugplan-")`
- [ ] Line 634: change `"plan-skeleton.md"` to `"tugplan-skeleton.md"`
- [ ] Line 635: change `"plan-implementation-log.md"` to `"tugplan-implementation-log.md"`

**Tests:**
- [ ] `cargo build` succeeds with zero warnings
- [ ] `cargo nextest run` passes
- [ ] Integration test (if existing): `tugtool doctor` on an initialized project reports "pass" for initialization check

**Checkpoint:**
- [ ] `cargo build` succeeds with zero warnings
- [ ] `cargo nextest run` passes
- [ ] `grep -n '\.tug["/)]' crates/tugtool/src/commands/doctor.rs` returns no matches (all `.tug/` references updated)
- [ ] `grep -n '"plan-' crates/tugtool/src/commands/doctor.rs` returns no matches (all `plan-` filename prefixes updated)
- [ ] `grep -n '\.tug\.worktrees' crates/tugtool/src/commands/doctor.rs` returns no matches (all `.tug.worktrees` references updated)
- [ ] `grep -n '"tug__"' crates/tugtool/src/commands/doctor.rs` returns no matches (all `tug__` prefixes updated)

**Rollback:**
- Revert all string replacements in `doctor.rs`

**Commit after all checkpoints pass.**

---

#### Step 3: Update PreToolUse hook to allow tugtool Bash commands {#step-3}

**Depends on:** #step-0, #step-1, #step-2

**Bead:** `tugtool-9jh.4`

**Commit:** `feat(implement): allow tugtool CLI calls in orchestrator PreToolUse hook`

**References:** [D01] Pattern-based Bash allowlist in PreToolUse hook, Risk R01, (#context, #strategy, #r01-hook-mechanism)

**Artifacts:**
- Modified `skills/implement/SKILL.md` — PreToolUse hook section in YAML frontmatter
- Modified `skills/implement/SKILL.md` — "CRITICAL: You Are a Pure Orchestrator" section updated to reflect new Bash permissions

**Tasks:**
- [ ] **FIRST: Verify the PreToolUse hook command inspection mechanism.** Before implementing the hook change, determine whether `$MCP_TOOL_INPUT` (or an equivalent environment variable / stdin mechanism) is available in the PreToolUse hook command context. Check Claude Code documentation, the existing hook implementation, or run an experimental hook that logs the available environment variables. See Risk R01 (#r01-hook-mechanism). If no inspection mechanism exists, fall back to the R01 mitigation: allow all Bash commands in the hook and rely on orchestrator prose instructions only.
- [ ] Replace the single `Bash|Write|Edit` matcher with two separate matchers. The target YAML frontmatter hook structure is:
  ```yaml
  hooks:
    PreToolUse:
      - matcher: "Write|Edit"
        hooks:
          - type: command
            command: "echo 'Orchestrator must not use Write/Edit directly' >&2; exit 2"
      - matcher: "Bash"
        hooks:
          - type: command
            command: "case \"$MCP_TOOL_INPUT\" in *'\"command\":\"tugtool '*|*'\"command\": \"tugtool '*) exit 0 ;; *) echo 'Orchestrator Bash restricted to tugtool commands' >&2; exit 2 ;; esac"
  ```
  The Bash hook inspects `$MCP_TOOL_INPUT` (the JSON tool input) for the `command` field starting with `tugtool`. **If the verification step above reveals a different mechanism**, adapt the pattern match accordingly while preserving the intent: allow only `tugtool`-prefixed commands. **If no mechanism exists**, use the fallback from Risk R01: remove the Bash matcher entirely (allow all Bash) and add explicit prose-only restrictions.
- [ ] Update the "CRITICAL: You Are a Pure Orchestrator" prose to state that Bash is allowed for `tugtool` CLI commands only
- [ ] Update the FORBIDDEN list to say "Running ANY shell commands other than `tugtool` CLI commands"

**Tests:**
- [ ] Manual: verify the hook YAML is syntactically valid
- [ ] Manual: confirm the orchestrator prose is internally consistent with the hook behavior
- [ ] Manual: if command inspection is available, verify that running a `tugtool` command succeeds and running a non-`tugtool` command is blocked

**Checkpoint:**
- [ ] The YAML frontmatter in `skills/implement/SKILL.md` contains two hook matchers: one for `Write|Edit` (always blocks) and one for `Bash` (allows tugtool-prefixed commands, blocks all others)
- [ ] The body text accurately describes the new permissions

**Rollback:**
- Revert the YAML frontmatter and body text changes in `skills/implement/SKILL.md`

**Commit after all checkpoints pass.**

---

#### Step 4: Replace setup agent spawn with direct CLI call in orchestration loop {#step-4}

**Depends on:** #step-3

**Bead:** `tugtool-9jh.5`

**Commit:** `feat(implement): replace setup agent with direct tugtool worktree create call`

**References:** [D01] Pattern-based Bash allowlist, [D02] Default to all remaining steps, [D03] HALT on CLI failure, [D04] Orchestrator parses CLI JSON directly, Risk R01, (#context, #strategy, #r01-hook-mechanism)

**Artifacts:**
- Modified `skills/implement/SKILL.md` — sections 1 ("Spawn Setup Agent") and 2 ("Handle Setup Result") replaced with direct CLI call and JSON parsing
- Modified `skills/implement/SKILL.md` — orchestration loop diagram updated to remove setup agent node
- Modified `skills/implement/SKILL.md` — progress reporting section: remove setup agent post-call format, add inline setup progress format
- Modified `skills/implement/SKILL.md` — "All six implementation agents" phrasing unchanged (the persistent agent table already lists only the 6 persistent agents: architect, coder, reviewer, committer, auditor, integrator — setup agent was never in this table)

**Tasks:**
- [ ] Replace section "1. Spawn Setup Agent" with a Bash call: `tugtool worktree create <plan_path> --json` run from the repo root
- [ ] Replace section "2. Handle Setup Result" with inline JSON parsing: extract `worktree_path`, `branch_name`, `base_branch`, `all_steps`, `ready_steps`, `bead_mapping`, `root_bead_id` from CLI stdout
- [ ] Add inline derivation of session state: `completed_steps = all_steps - ready_steps`, `remaining_steps = ready_steps || all_steps`, `resolved_steps = remaining_steps` (per [D02])
- [ ] On non-zero exit: output failure message and HALT (per [D03])
- [ ] On zero exit with empty resolved_steps: output "All steps already complete." and HALT
- [ ] Update the ASCII orchestration loop diagram to remove the `implement-setup-agent` node and replace it with a `Bash: tugtool worktree create` node
- [ ] Update the "implement-setup-agent post-call" progress reporting block to become a "Setup complete" inline message (keeping the same information: worktree, branch, step counts, beads)
- [ ] Remove the `needs_clarification` handling (AskUserQuestion for step selection)
- [ ] Update FIRST ACTION instruction to say the first action is running `tugtool worktree create` via Bash
- [ ] Update the GOAL line (line 29: `**GOAL:** Execute plan steps by orchestrating: setup, architect, coder, reviewer, committer.`) to remove "setup" and reflect that worktree creation is now a direct CLI call, not an agent
- [ ] Verify the persistent agent reference table is unchanged (it already lists only the 6 persistent agents; setup agent was never in it)

**Tests:**
- [ ] Manual: verify the SKILL.md orchestration flow is internally consistent (setup → step loop → auditor → integrator)
- [ ] Manual: verify all JSON field names match the `CreateData` struct in `crates/tugtool/src/commands/worktree.rs`

**Checkpoint:**
- [ ] Sections 1-2 of SKILL.md use Bash(`tugtool worktree create <path> --json`) instead of Task(implement-setup-agent)
- [ ] No references to `implement-setup-agent` remain in SKILL.md
- [ ] The orchestration loop diagram shows `Bash: tugtool worktree create` instead of `Task: implement-setup-agent`
- [ ] The persistent agent table is unchanged at 6 agents (architect, coder, reviewer, committer, auditor, integrator) — setup agent was never in this table
- [ ] The GOAL line no longer references "setup" as an agent

**Rollback:**
- Revert `skills/implement/SKILL.md` to previous version

**Commit after all checkpoints pass.**

---

#### Step 5: Delete setup agent and update cross-references {#step-5}

**Depends on:** #step-4

**Bead:** `tugtool-9jh.6`

**Commit:** `refactor: remove implement-setup-agent, update docs and tests`

**References:** [D01] Pattern-based Bash allowlist, [D02] Default to all remaining steps, (#scope, #success-criteria)

**Artifacts:**
- Deleted `agents/implement-setup-agent.md`
- Modified `CLAUDE.md` — sub-agent table and count updated (10 to 9)
- Modified `crates/tugtool/tests/agent_integration_tests.rs` — agent count and lists updated

**Tasks:**
- [ ] Delete `agents/implement-setup-agent.md`
- [ ] In `CLAUDE.md`: change "Sub-Agents (10)" heading to "Sub-Agents (9)"
- [ ] In `CLAUDE.md`: remove the `implement-setup-agent` row from the "Implementation agents" table
- [ ] In `CLAUDE.md`: update the implement skill description from "setup -> architect -> coder -> reviewer -> committer" to "architect -> coder -> reviewer -> committer" (or similar reflecting the direct CLI call)
- [ ] In `agent_integration_tests.rs`: remove `"implement-setup-agent"` from `ALL_AGENTS` array
- [ ] In `agent_integration_tests.rs`: update comment at line 57 from "8 agents invoked via Task" to "7 agents invoked via Task" (array now has 7 entries)
- [ ] In `agent_integration_tests.rs`: update comment at line 11 from "10 sub-AGENTS" to "9 sub-AGENTS"
- [ ] In `agent_integration_tests.rs`: update `test_only_expected_agents_exist` assertion from 10 to 9 agent files
- [ ] Verify no other files reference `implement-setup-agent` (search the full repo)

**Tests:**
- [ ] `cargo nextest run` passes with zero warnings
- [ ] `agents/implement-setup-agent.md` does not exist
- [ ] `grep -r "implement-setup-agent" .` returns no matches (excluding git history)

**Checkpoint:**
- [ ] `cargo nextest run` — all tests pass, zero warnings
- [ ] `grep -r "implement-setup-agent" --include="*.md" --include="*.rs" .` returns zero results
- [ ] `ls agents/*.md | wc -l` returns 9

**Rollback:**
- Restore `agents/implement-setup-agent.md` from git
- Revert changes to `CLAUDE.md` and `agent_integration_tests.rs`

**Commit after all checkpoints pass.**

---

### 1.0.2 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Three infrastructure bugs fixed (absolute path join, beads fail-fast error handling, doctor directory name) and the implement orchestrator runs `tugtool worktree create` directly via Bash instead of spawning a setup agent, with the setup agent deleted and all references updated.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugtool worktree create` correctly handles absolute plan paths (path join bug fixed)
- [ ] `tugtool worktree create` fails with a clear, actionable error (exit code 5, proper JSON error) when `bd` is not installed (beads fail-fast error handling)
- [ ] `tugtool doctor` checks `.tugtool/` directory, `tugplan-` prefixed files, `.tugtree` worktree directory, and `tugtool__` worktree prefix (all five health check functions fixed)
- [ ] `agents/implement-setup-agent.md` does not exist
- [ ] `cargo nextest run` passes with zero warnings
- [ ] `skills/implement/SKILL.md` calls `tugtool worktree create` via Bash, not via Task(implement-setup-agent)
- [ ] `skills/implement/SKILL.md` PreToolUse hook allows `tugtool` Bash commands while blocking all other Bash/Write/Edit
- [ ] `CLAUDE.md` documents 9 sub-agents, not 10
- [ ] No references to `implement-setup-agent` exist in any `.md` or `.rs` file

**Acceptance tests:**
- [ ] Integration test: `cargo nextest run` passes (verifies agent count = 9, all agent files exist)
- [ ] Manual test: `/tugtool:implement` successfully creates a worktree without spawning a setup agent

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Consider eliminating other thin-wrapper agents if the pattern proves successful
- [ ] Add automated hook validation tests (currently manual)
- [ ] Add integration tests for `tugtool doctor` health checks

| Checkpoint | Verification |
|------------|--------------|
| Path join bug fixed | `cargo nextest run` with absolute path test |
| Beads fail-fast error works | Worktree creation fails with exit code 5 and clear error when `bd` is not installed |
| Doctor references fixed | `grep -rn '\.tug["/)]|\.tug\.worktrees|"tug__"' crates/tugtool/src/commands/doctor.rs` returns empty |
| Agent deleted | `! test -f agents/implement-setup-agent.md` |
| Tests pass | `cargo nextest run` exit code 0 |
| No stale references | `grep -r "implement-setup-agent" --include="*.md" --include="*.rs" .` returns empty |

**Commit after all checkpoints pass.**