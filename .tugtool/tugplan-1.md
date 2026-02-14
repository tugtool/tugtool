## Phase 1.0: Eliminate implement-setup-agent {#phase-eliminate-setup-agent}

**Purpose:** Remove the implement-setup-agent LLM agent and replace it with a direct `tugtool worktree create` CLI call from the implement orchestrator, eliminating an unnecessary Sonnet spawn and its recurring failure modes.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-02-14 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The implement-setup-agent is an LLM agent that exists solely to run `tugtool worktree create <plan> --json` and parse the output. It performs zero reasoning work — it is a thin wrapper around a single CLI command. Despite this simplicity, it is the source of recurring failures: wrong working directory, git not initialized, the agent improvising extra steps. Replacing it with a direct CLI call from the orchestrator eliminates an entire agent spawn, removes a class of failure modes, and speeds up every implementation session.

The implement orchestrator skill currently uses a PreToolUse hook that blocks all Bash, Write, and Edit calls, enforcing that the orchestrator delegates everything through Task. To allow the orchestrator to run `tugtool` commands directly, the hook must be updated to use a pattern-based allowlist that permits Bash calls starting with `tugtool` while continuing to block all other direct tool usage.

#### Strategy {#strategy}

- Update the PreToolUse hook in `skills/implement/SKILL.md` to allow `tugtool`-prefixed Bash commands while blocking all other Bash/Write/Edit usage
- Replace the setup agent Task spawn (sections 1-2 of the orchestration loop) with a direct `tugtool worktree create --json` Bash call, parsing JSON output inline
- Default step selection to "all remaining steps" — no interactive step selection, no ambiguity
- On CLI failure (non-zero exit), output the error and HALT immediately — no retries
- Delete `agents/implement-setup-agent.md` and update all references (CLAUDE.md, agent_integration_tests.rs)
- Keep the post-call progress message format unchanged; just change where the data comes from

#### Stakeholders / Primary Customers {#stakeholders}

1. Tugtool users running `/tugtool:implement` to execute tugplans
2. Tugtool maintainers who debug implementation session failures

#### Success Criteria (Measurable) {#success-criteria}

- `agents/implement-setup-agent.md` does not exist after implementation
- `cargo nextest run` passes with zero warnings (all tests updated to reflect 9 agents)
- The implement orchestrator SKILL.md runs `tugtool worktree create` directly via Bash without spawning a setup agent
- The PreToolUse hook blocks non-`tugtool` Bash commands while allowing `tugtool` commands

#### Scope {#scope}

1. PreToolUse hook update in `skills/implement/SKILL.md`
2. Orchestration loop rewrite (sections 1-2) in `skills/implement/SKILL.md`
3. Deletion of `agents/implement-setup-agent.md`
4. Update CLAUDE.md agent tables and counts
5. Update `agent_integration_tests.rs` to reflect reduced agent count

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the `tugtool worktree create` CLI behavior or output format
- Modifying any other agents (architect, coder, reviewer, committer, auditor, integrator)
- Adding retry logic for worktree creation failures
- Adding interactive step selection (we default to all remaining)
- Changing the planner skill's PreToolUse hook (only implement skill changes)

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

---

### 1.0.1 Execution Steps {#execution-steps}

#### Step 0: Update PreToolUse hook to allow tugtool Bash commands {#step-0}

**Commit:** `feat(implement): allow tugtool CLI calls in orchestrator PreToolUse hook`

**References:** [D01] Pattern-based Bash allowlist in PreToolUse hook, (#context, #strategy)

**Artifacts:**
- Modified `skills/implement/SKILL.md` — PreToolUse hook section in YAML frontmatter
- Modified `skills/implement/SKILL.md` — "CRITICAL: You Are a Pure Orchestrator" section updated to reflect new Bash permissions

**Tasks:**
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
  The Bash hook inspects `$MCP_TOOL_INPUT` (the JSON tool input) for the `command` field starting with `tugtool`. If the environment variable or inspection mechanism differs, adapt the pattern match accordingly while preserving the intent: allow only `tugtool`-prefixed commands.
- [ ] Update the "CRITICAL: You Are a Pure Orchestrator" prose to state that Bash is allowed for `tugtool` CLI commands only
- [ ] Update the FORBIDDEN list to say "Running ANY shell commands other than `tugtool` CLI commands"

**Tests:**
- [ ] Manual: verify the hook YAML is syntactically valid
- [ ] Manual: confirm the orchestrator prose is internally consistent with the hook behavior

**Checkpoint:**
- [ ] The YAML frontmatter in `skills/implement/SKILL.md` contains two hook matchers: one for `Write|Edit` (always blocks) and one for `Bash` (allows tugtool-prefixed commands, blocks all others)
- [ ] The body text accurately describes the new permissions

**Rollback:**
- Revert the YAML frontmatter and body text changes in `skills/implement/SKILL.md`

**Commit after all checkpoints pass.**

---

#### Step 1: Replace setup agent spawn with direct CLI call in orchestration loop {#step-1}

**Depends on:** #step-0

**Commit:** `feat(implement): replace setup agent with direct tugtool worktree create call`

**References:** [D01] Pattern-based Bash allowlist, [D02] Default to all remaining steps, [D03] HALT on CLI failure, [D04] Orchestrator parses CLI JSON directly, (#context, #strategy)

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

#### Step 2: Delete setup agent and update cross-references {#step-2}

**Depends on:** #step-1

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

**Deliverable:** The implement orchestrator runs `tugtool worktree create` directly via Bash instead of spawning a setup agent, with the setup agent deleted and all references updated.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

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

| Checkpoint | Verification |
|------------|--------------|
| Agent deleted | `! test -f agents/implement-setup-agent.md` |
| Tests pass | `cargo nextest run` exit code 0 |
| No stale references | `grep -r "implement-setup-agent" --include="*.md" --include="*.rs" .` returns empty |

**Commit after all checkpoints pass.**
