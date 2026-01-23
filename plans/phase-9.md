## Phase 9: Editor Interop - MCP Removal and Claude Code / Cursor Integration {#phase-9}

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
- **Part 3: Cursor Front Door** - Create `.cursor/rules/tug.mdc` with agent rules (rules-only, no Cursor commands in Phase 9).
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

#### [Q02] Claude Code Hook Feasibility (RESOLVED) {#q02-hook-feasibility}

**Question:** Can Claude Code hooks detect refactoring patterns in user messages and inject tug reminders?

**Why it matters:** Hooks could provide automatic discovery without requiring users to know about tug commands.

**Options considered:**
- `UserPromptSubmit` hook to analyze incoming prompts for refactoring patterns
- `PostToolUse` hook to suggest tug after manual multi-file edits
- No hooks (rely on CLAUDE.md rules and skills only)

**Resolution:** Use `UserPromptSubmit` hook for lightweight discovery. The hook checks for refactoring-related keywords and injects a brief reminder about tug commands when detected. This is low-risk (exit code 0 = no interference) and provides natural discovery without blocking the user's workflow. Marked as experimental - can be removed if too noisy.

**Sources:**
- [Claude Code Hooks Reference](https://docs.anthropic.com/en/docs/claude-code/hooks)

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Claude Code command format changes | med | med | Keep commands simple, document format | Claude Code update |
| Cursor config format changes | low | med | Use new `.mdc` format, document fallback | Cursor update |

**Note:** MCP removal has no risk - this project has zero users. Clean break with no deprecation period.

---

### 9.0 Design Decisions {#design-decisions}

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

**Decision:** Editor commands use `--verify syntax` only. Test verification is out of scope for Phase 9.

**Rationale:**
- Syntax verification is fast and always available
- Test verification can be slow and requires fixture setup
- Keep Phase 9 focused on interop, not verification enhancements

**Implications:**
- All command examples use `--verify syntax`
- No mention of `--verify tests` in Phase 9 commands
- Future phases may add test verification as opt-in

#### [D07] Pattern-Based Discovery Triggers (DECIDED) {#d07-pattern-triggers}

**Decision:** Define explicit trigger patterns that signal when tug should be suggested. These patterns appear in CLAUDE.md rules, Claude Code skills, and Cursor rules.

**Rationale:**
- AI agents need concrete patterns to recognize when a tool is applicable
- Specific phrases like "rename X to Y" or "change the function name" are clearer than vague keywords
- Consistent patterns across all integration points reinforce discovery

**Trigger Patterns (Recognition Phrases):**
- "rename X to Y" / "rename the X"
- "change the name of X" / "change X's name"
- "refactor the name" / "refactor...name"
- "update all references to X"
- "find and replace X with Y" (when discussing symbols)
- "change the function/class/variable/method name"

**When tug is highly recommended:**
- Multi-file symbol renames (functions, classes, variables, methods)
- Cross-reference updates across a codebase
- Refactoring that must preserve semantic correctness
- Changes where manual find/replace would miss shadowed or scoped references

**When tug is NOT needed:**
- Single-file text replacements
- Comment/string changes
- Renaming files (not symbols)
- Simple search/replace of literal text (not identifiers)

**Note:** Tug will support additional refactoring operations beyond rename in the future. These patterns should be extended as new operations are added.

**Implications:**
- CLAUDE.md must include these patterns with "highly recommended" language
- Skills must reference these patterns in their trigger descriptions
- Cursor rules must include the same patterns for consistency

#### [D08] Skills as Proactive Discovery (DECIDED) {#d08-skills-proactive}

**Decision:** Create a `tug-refactor` skill that Claude Code can proactively invoke when it recognizes refactoring patterns.

**Rationale:**
- Skills are the native mechanism for proactive tool suggestion in Claude Code
- A skill provides richer context than CLAUDE.md rules alone
- Skills can be auto-invoked based on description matching

**Implications:**
- Create `.claude/skills/tug-refactor/SKILL.md`
- Skill description must include trigger patterns from [D07]
- Skill should reference available tug commands
- Allow proactive invocation (do not disable model invocation)

#### [D09] Lightweight Hook for Discovery Hints (DECIDED) {#d09-hook-hints}

**Decision:** Implement a `UserPromptSubmit` hook that detects refactoring patterns and injects a brief reminder about tug availability.

**Rationale:**
- Hooks run automatically on every user prompt
- A lightweight pattern check is fast and non-blocking
- Exit code 0 means the hook succeeds silently; output to stdout adds context
- This is a "gentle nudge" not a blocker

**Hook Behavior:**
- Check user prompt for refactoring-related keywords
- If detected: output a one-line reminder to stdout (becomes part of Claude's context)
- If not detected: exit silently (exit 0, no output)
- Never block (always exit 0)

**Implications:**
- Hook script lives at `.claude/hooks/tug-discovery.sh`
- Hook configuration in `.claude/settings.json`
- Hook is experimental; can be removed if noisy

---

### 9.1 Specification {#specification}

#### 9.1.1 Files to Delete (MCP Removal) {#files-to-delete}

**List L01: Files to Delete** {#l01-files-delete}

| File | Reason |
|------|--------|
| `crates/tugtool/src/mcp.rs` | MCP server implementation |

#### 9.1.2 Files to Modify (MCP Removal) {#files-to-modify}

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

#### 9.1.3 Claude Code Commands {#claude-commands}

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

#### 9.1.4 Claude Code Rules {#claude-rules}

**Spec S02: Claude Code Agent Rules** {#s02-claude-rules}

Rules to add to CLAUDE.md or `.claude/rules/`:

1. **Review before apply:** Always run `analyze-impact` and dry-run before any `--apply`
2. **Approval required:** Require explicit user confirmation for apply
3. **Exit-code driven:** If exit code is nonzero, stop and surface the JSON error; do not attempt unrelated retries
4. **No commits:** Do not run `git commit` (project rule, already in CLAUDE.md)
5. **No mutation outside tug:** Avoid manual edits in the same files between analyze and apply
6. **Deterministic reporting:** Present summaries using actual numeric fields from tug output

#### 9.1.5 Cursor Configuration {#cursor-config}

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

**Note:** Cursor commands (`.cursor/commands.json`) are out of scope for Phase 9. Rules-only is sufficient.

#### 9.1.6 Error Handling Playbook {#error-handling}

**Table T01: Exit Code Handling for Front Doors** {#t01-exit-handling}

| Exit | Meaning | Front Door Behavior |
|------|---------|---------------------|
| 0 | Success | Parse stdout JSON, continue workflow |
| 2 | Invalid arguments | Show error; request corrected input (location/name/flags) |
| 3 | Resolution error | Show error; suggest checking location; re-run analyze-impact |
| 4 | Apply error | Advise re-analyzing (snapshot may be stale) |
| 5 | Verification failed | Do not apply; show verification output; suggest fixing code |
| 10 | Internal error | Stop; instruct to file bug with stderr + JSON |

#### 9.1.7 Natural Discovery Mechanisms {#natural-discovery}

This section specifies the mechanisms that help AI agents discover and suggest tug without explicit user requests.

##### Discovery Pattern Table {#discovery-patterns}

**Table T02: Tug Discovery Trigger Patterns** {#t02-trigger-patterns}

| Pattern | Example | Discovery Action |
|---------|---------|------------------|
| "rename X to Y" | "rename process_data to transform_data" | Suggest tug refactoring |
| "change the name of X" | "change the name of the User class" | Suggest tug refactoring |
| "refactor...name" | "refactor the function name" | Suggest tug refactoring |
| "update all references" | "update all references to old_name" | Suggest tug refactoring |
| "change the function/class/method/variable name" | "change the function name to getData" | Suggest tug refactoring |
| "find and replace X with Y" (symbols) | "find and replace getUserId with fetchUserId" | Suggest tug if multi-file |

**When tug is highly recommended:**
- Symbol spans multiple files
- Operation involves functions, classes, methods, or variables
- User mentions "all references", "across the codebase", "everywhere"
- Manual editing would risk missing shadowed or scoped references

**When tug is NOT needed:**
- Single file, single occurrence
- String literals or comments only
- File renaming (not symbol renaming)
- Simple text replacement (not code identifiers)

**Note:** Additional patterns will be added as tug gains new refactoring operations beyond rename.

##### Spec S04: Claude Code Skill Definition {#s04-skill-definition}

**File:** `.claude/skills/tug-refactor/SKILL.md`

**Skill Specification:**

```yaml
---
name: tug-refactor
description: |
  Semantic code refactoring using tug. Use this skill when the user wants to:
  - Rename a function, class, method, or variable across multiple files
  - Change symbol names with automatic reference updates
  - Refactor identifiers while preserving semantic correctness

  Trigger patterns: "rename X to Y", "change the name of", "refactor the name",
  "update all references", "change the function/class/variable name"

  Note: tug currently supports rename operations. Additional refactoring
  operations will be added in future versions.
---

# Tug Refactoring Skill

This skill provides semantic refactoring capabilities through the `tug` CLI tool.

## When to Use This Skill

Use tug when the user requests symbol renaming or reference updates, especially:
- Multi-file renames (function used in many places)
- Class or method renames with inheritance implications
- Variable renames that must preserve scoping rules
- Any rename where manual find/replace would be error-prone

## Available Commands

- `/tug-rename` - Full rename workflow with analyze, review, and apply
- `/tug-rename-plan` - Analyze and preview only (no changes)
- `/tug-fixtures-ensure` - Ensure test fixtures are ready

## Workflow

1. **Identify the symbol**: Determine file, line, and column of the symbol to rename
2. **Get the new name**: Ask user for the desired new name if not provided
3. **Invoke command**: Use `/tug-rename` for the full workflow

## Why Tug Over Manual Editing

- **Scope-aware**: Understands language scoping rules (shadowing, imports, etc.)
- **Verified**: Runs syntax verification before applying changes
- **Deterministic**: Same input always produces same output
- **Safe**: Requires explicit approval before applying changes

## Example

User: "Rename the process_data function to transform_data"

Response: I'll use tug to rename this function safely across all files.
[Invoke /tug-rename]
```

##### Spec S05: UserPromptSubmit Hook {#s05-userprompt-hook}

**File:** `.claude/hooks/tug-discovery.sh`

**Purpose:** Detect refactoring-related patterns in user prompts and inject a brief reminder about tug.

**Script Specification:**

```bash
#!/bin/bash
# tug-discovery.sh - Lightweight hook for tug discovery
#
# This hook checks user prompts for refactoring-related keywords and
# outputs a brief reminder if detected. It never blocks (always exits 0).

# Read the JSON input from stdin
INPUT=$(cat)

# Extract the user prompt from the JSON
# The format is: {"session_id": "...", "prompt": "..."}
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)

# If we couldn't extract the prompt, exit silently
if [ -z "$PROMPT" ]; then
    exit 0
fi

# Check for refactoring-related patterns (case-insensitive)
if echo "$PROMPT" | grep -qi -E \
    'rename[[:space:]]+(the[[:space:]]+)?(function|class|method|variable|symbol)|rename[[:space:]]+[a-zA-Z_]+[[:space:]]+to[[:space:]]|change[[:space:]]+(the[[:space:]]+)?name[[:space:]]+of|refactor.*(name|rename)|update[[:space:]]+all[[:space:]]+references'; then

    # Output a brief reminder (this becomes part of Claude's context)
    echo "[tug hint] For symbol renames across multiple files, consider using /tug-rename for verified, scope-aware refactoring."
fi

# Always exit 0 - never block the user's prompt
exit 0
```

**Hook Configuration in `.claude/settings.json`:**

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "command": ".claude/hooks/tug-discovery.sh",
        "timeout": 1000
      }
    ]
  }
}
```

**Notes:**
- Timeout is 1 second (1000ms) to avoid slowing down prompt submission
- Hook output goes to stdout and becomes part of Claude's context
- Exit code 0 is required; non-zero would show an error to the user
- This is experimental and can be removed if too noisy

##### Spec S06: Enhanced CLAUDE.md Tug Section {#s06-enhanced-claudemd}

**Section to add to CLAUDE.md:**

```markdown
## Tug Refactoring (Highly Recommended for Symbol Renames)

When the user requests symbol renaming or reference updates, **tug is highly recommended**.

### Recognition Patterns

Look for these patterns in user requests:
- "rename X to Y" / "rename the function/class/variable"
- "change the name of X" / "change X's name to Y"
- "refactor the name" / "refactor...name"
- "update all references to X"
- "find and replace X with Y" (when discussing code symbols)

### When to Use Tug

**Use tug when:**
- The symbol appears in multiple files
- Renaming functions, classes, methods, or variables
- User mentions "all references", "across the codebase", "everywhere"
- Manual editing would risk missing shadowed or scoped references

**Skip tug when:**
- Single file, single occurrence
- String literals or comments only
- File renaming (not symbol renaming)

### Why Tug Over Manual Editing

- **Scope-aware**: Understands language scoping rules (won't rename shadowed variables)
- **Verified**: Runs syntax verification before applying
- **Deterministic**: Same input produces same output
- **Safe**: Requires explicit approval before changes

### Quick Reference

```bash
# Full workflow (analyze -> review -> apply)
/tug-rename

# Preview only (no changes)
/tug-rename-plan

# CLI equivalent
tug analyze-impact rename-symbol --at <file:line:col> --to <new_name>
tug run --verify syntax rename-symbol --at <file:line:col> --to <new_name>
tug run --apply --verify syntax rename-symbol --at <file:line:col> --to <new_name>
```

### Agent Rules

1. **Always analyze first**: Run `analyze-impact` before any `run --apply`
2. **Review before apply**: Show dry-run summary before applying
3. **Get explicit approval**: Never apply without user confirmation
4. **Handle errors by exit code**: See Error Codes section
5. **No mutation during workflow**: Don't manually edit files between analyze and apply

##### Spec S07: Enhanced Cursor Rules {#s07-enhanced-cursor}

**File:** `.cursor/rules/tug.mdc`

**Enhanced content with trigger patterns:**

```markdown
---
description: Rules for using tug refactoring tool - semantic symbol renaming
alwaysApply: true
---

# Tug Refactoring Rules

## When to Suggest Tug (Recognition Patterns)

Suggest tug when the user's request matches these patterns:
- "rename X to Y" / "rename the function/class/variable"
- "change the name of X" / "change X's name"
- "refactor the name" / "refactor...name"
- "update all references to X"
- "find and replace X with Y" (for code symbols, not literal text)

## When Tug is Highly Recommended

Use tug when:
- Symbol appears in **multiple files**
- Renaming **functions, classes, methods, or variables**
- User mentions "all references", "across the codebase", "everywhere"
- Manual editing would risk missing **shadowed or scoped references**

## When to Skip Tug

- Single file, single occurrence
- String literals or comments only
- File renaming (not symbol renaming)
- Simple text replacement

## Workflow

1. **Always analyze first:** Run `tug analyze-impact` before any `tug run --apply`
2. **Review patch:** Run dry-run (`tug run` without `--apply`) and review output
3. **Get approval:** Ask user "Apply these changes?" before running `--apply`

## Why Tug Over Manual Editing

- **Scope-aware**: Won't rename shadowed variables or wrong scopes
- **Verified**: Syntax check before apply catches errors
- **Deterministic**: Same input always produces same output
- **Safe**: Explicit approval required

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

---

### 9.2 Symbol Inventory {#symbol-inventory}

#### 9.2.1 New Files {#new-files}

| File | Purpose |
|------|---------|
| `.claude/commands/tug-rename.md` | Full rename workflow command |
| `.claude/commands/tug-rename-plan.md` | Analyze + dry-run only command |
| `.claude/commands/tug-fixtures-ensure.md` | Fixture status/fetch command |
| `.claude/skills/tug-refactor/SKILL.md` | Proactive skill for tug discovery |
| `.claude/hooks/tug-discovery.sh` | UserPromptSubmit hook for pattern detection (experimental) |
| `.claude/settings.json` | Hook configuration |
| `.cursor/rules/tug.mdc` | Cursor agent rules for tug usage (new `.mdc` format) |

#### 9.2.2 Files to Delete {#files-delete}

| File | Reason |
|------|--------|
| `crates/tugtool/src/mcp.rs` | MCP removal |

#### 9.2.3 Symbols to Remove {#symbols-remove}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `mcp` | module | `lib.rs` | Remove feature-gated module |
| `Command::Mcp` | variant | `main.rs` | Remove CLI subcommand |
| `execute_mcp` | fn | `main.rs` | Remove executor function |
| `mcp_parity` | module | `golden_tests.rs` | Remove test module |
| `mcp` | feature | `Cargo.toml` | Remove feature flag |
| `tokio` | dependency | `Cargo.toml` | Remove if audit shows MCP-only (see [D05]) |

---

### 9.3 Documentation Plan {#documentation-plan}

- [ ] Update CLAUDE.md to remove MCP references
- [ ] Update CLAUDE.md to add editor interop section referencing new commands
- [ ] Update README.md to remove MCP feature and commands table entry
- [ ] Update README.md to add Claude Code / Cursor integration section
- [ ] Update docs/AGENT_API.md to remove MCP Server section
- [ ] Update docs/AGENT_PLAYBOOK.md to remove MCP configuration, add Claude Code commands
- [ ] Update Justfile to remove `mcp` recipe

---

### 9.4 Test Plan Concepts {#test-plan-concepts}

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

### 9.5 Execution Steps {#execution-steps}

#### Step 0: Preparation and Audit {#step-0}

**Commit:** N/A (audit only, no changes)

**References:** [D01] MCP Removal, List L01, List L02, (#context, #files-to-delete, #files-to-modify)

**Artifacts:**
- Inventory of all MCP-related code and documentation

**Tasks:**
- [x] Identify all files containing MCP/mcp/rmcp references
- [x] Verify no external consumers of MCP functionality
- [x] Document the exact lines to remove in each file

**Checkpoint:**
- [x] Complete file inventory created (this is documented in L01 and L02)

---

#### Step 1: Delete MCP Module and Update Cargo.toml {#step-1}

**Commit:** `refactor(tugtool): remove MCP server support`

**References:** [D01] MCP Removal, [D02] CLI as Kernel, [D05] Tokio Removal, List L01, List L02, (#files-to-delete, #symbols-remove)

**Artifacts:**
- Delete `crates/tugtool/src/mcp.rs`
- Updated `crates/tugtool/Cargo.toml` without MCP dependencies

**Tasks:**
- [x] Delete `crates/tugtool/src/mcp.rs`
- [x] **Tokio audit:** Search for `tokio` usage outside `mcp.rs`:
  - [x] `grep -r "tokio" --include="*.rs" crates/tugtool/src/ | grep -v mcp.rs`
  - [x] If no results: remove `tokio` dependency entirely
  - [x] If results: keep `tokio`, update comments to reflect actual usage
- [x] Remove from `crates/tugtool/Cargo.toml`:
  - [x] `rmcp = { ... }` dependency
  - [x] `schemars = { ... }` dependency
  - [x] `tokio = { ... }` dependency (if audit confirms MCP-only)
  - [x] `mcp = ["dep:rmcp", "dep:schemars"]` feature
  - [x] `mcp` from `default` features
  - [x] `mcp` from `full` features
- [x] Update package keywords to remove "mcp"

**Tests:**
- [ ] Build: `cargo build -p tugtool`

**Checkpoint:**
- [ ] `cargo build -p tugtool` succeeds
- [x] `grep -r "rmcp" crates/tugtool/Cargo.toml` returns empty
- [x] Tokio audit documented (kept or removed with reason)

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
- [x] In `crates/tugtool/src/lib.rs`:
  - [x] Remove `#[cfg(feature = "mcp")] pub mod mcp;`
  - [x] Update module doc comments to remove MCP references
- [x] In `crates/tugtool/src/main.rs`:
  - [x] Remove `#[cfg(feature = "mcp")] Command::Mcp` variant
  - [x] Remove `#[cfg(feature = "mcp")] Command::Mcp => execute_mcp()` match arm
  - [x] Remove `execute_mcp()` function
  - [x] Remove any MCP-related imports

**Tests:**
- [x] Build: `cargo build -p tugtool`
- [x] Unit: existing CLI parsing tests pass

**Checkpoint:**
- [x] `cargo build -p tugtool` succeeds
- [x] `cargo nextest run -p tugtool -- cli_parsing` passes
- [x] `grep -r "mcp" crates/tugtool/src/` returns only comments or unrelated strings

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
- [x] In `crates/tugtool/tests/golden_tests.rs`:
  - [x] Remove `#[cfg(feature = "mcp")] mod mcp_parity { ... }` block
- [x] In `crates/tugtool/tests/api_surface.rs`:
  - [x] Remove `#[cfg(feature = "mcp")] use tugtool::mcp;`

**Tests:**
- [x] Golden: `cargo nextest run -p tugtool golden`
- [x] API surface: `cargo nextest run -p tugtool api_surface`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool` passes
- [x] No feature = "mcp" references in test files

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
- [x] In `CLAUDE.md`:
  - [x] Remove "MCP Server" section
  - [x] Remove `| mcp | Yes | Model Context Protocol server |` from feature flags table
  - [x] Update `tug mcp` reference if any
  - [x] Remove MCP tools list
- [x] In `README.md`:
  - [x] Remove `- **MCP support** - Native Model Context Protocol server...` from Features
  - [x] Remove `| mcp | Start MCP server |` from Commands table
  - [x] Remove entire "### MCP Configuration" section
  - [x] Remove "- MCP server for direct tool integration" from "For AI Agents" section
- [x] In `docs/AGENT_API.md`:
  - [x] Remove entire "## MCP Server" section
  - [x] Remove `| mcp | Start MCP server on stdio | tug mcp |` from Subcommands table
  - [x] Update Overview to remove MCP mention
- [x] In `docs/AGENT_PLAYBOOK.md`:
  - [x] Remove "### MCP Configuration" section
  - [x] Remove "### Example Tool Calls" section (MCP tool calls)
  - [x] Update "### Agent Instructions Snippet" to use CLI instead of MCP
- [x] In `Justfile`:
  - [x] Remove `mcp:` recipe

**Tests:**
- [x] Grep check: `grep -ri "mcp" CLAUDE.md README.md docs/ Justfile` returns empty or only false positives

**Checkpoint:**
- [x] No MCP references in documentation
- [x] `just --list` shows no `mcp` recipe

**Rollback:**
- Revert commit

---

#### Step 5: Verify Clean Removal {#step-5}

**Commit:** N/A (verification only)

**References:** [D01] MCP Removal, (#success-criteria)

**Tasks:**
- [x] Run comprehensive grep: `grep -ri "mcp\|rmcp" --include="*.rs" --include="*.toml" --include="*.md" .`
- [x] Verify only expected results (plans/extras/editor-interop.md may reference MCP as historical context)
- [x] Run full test suite: `cargo nextest run --workspace`
- [x] Verify Cargo.lock updated (no rmcp entries)

**Checkpoint:**
- [x] `cargo nextest run --workspace` passes
- [x] `grep -r "rmcp" Cargo.lock` returns empty
- [x] Build with all features: `cargo build -p tugtool --features full`

---

#### Step 5 Summary: MCP Removal Complete {#step-5-summary}

After Steps 1-5, the codebase will have:
- No MCP server code
- No rmcp/schemars dependencies
- No MCP feature flag
- No MCP documentation
- Simpler build, fewer dependencies

**Final Part 1 Checkpoint:**
- [x] `cargo build -p tugtool` succeeds
- [x] `cargo nextest run --workspace` passes
- [x] No MCP references except historical context in plan files

---

#### Step 6: Create Claude Code Rename Command {#step-6}

**Commit:** `feat(interop): add /tug-rename Claude Code command`

**References:** [D02] CLI as Kernel, [D03] Decision Gates, [D04] No Apply Without Approval, Spec S01, (#cmd-tug-rename)

**Artifacts:**
- New file: `.claude/commands/tug-rename.md`

**Tasks:**
- [x] Create `.claude/commands/tug-rename.md` with:
  - [x] Command description and purpose
  - [x] Input requirements (new_name from user, location from context)
  - [x] Full workflow algorithm with decision gates
  - [x] Exit code handling per Table T01
  - [x] Example usage

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

**Tests:**
- [ ] Manual: Run `/tug-rename` in Claude Code (requires Claude Code environment)

**Checkpoint:**
- [x] File exists at `.claude/commands/tug-rename.md`
- [x] File content matches spec

**Rollback:**
- Delete file

---

#### Step 7: Create Claude Code Plan Command {#step-7}

**Commit:** `feat(interop): add /tug-rename-plan Claude Code command`

**References:** [D02] CLI as Kernel, Spec S01, (#cmd-tug-rename-plan)

**Artifacts:**
- New file: `.claude/commands/tug-rename-plan.md`

**Tasks:**
- [x] Create `.claude/commands/tug-rename-plan.md` with:
  - [x] Command description (analyze + dry-run only)
  - [x] Workflow stopping at dry-run
  - [x] Clear statement that this does NOT apply changes

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

**Checkpoint:**
- [x] File exists at `.claude/commands/tug-rename-plan.md`

**Rollback:**
- Delete file

---

#### Step 8: Create Claude Code Fixtures Command {#step-8}: DEFERRED

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

**Checkpoint:**
- [ ] File exists at `.claude/commands/tug-fixtures-ensure.md`

**Rollback:**
- Delete file

---

#### Step 9: Update CLAUDE.md with Discovery Patterns {#step-9}

**Commit:** `docs: add tug discovery patterns and recommendations to CLAUDE.md`

**References:** [D02] CLI as Kernel, [D07] Pattern-Based Discovery, Spec S06, Table T02, (#s06-enhanced-claudemd, #discovery-patterns)

**Artifacts:**
- Updated `CLAUDE.md` with comprehensive tug section including discovery patterns

**Tasks:**
- [x] Add new section "## Tug Refactoring (Highly Recommended for Symbol Renames)" to CLAUDE.md
- [x] Include recognition patterns from Table T02
- [x] Include "When to Use Tug" / "When to Skip Tug" guidance
- [x] Include "Why Tug Over Manual Editing" explanation
- [x] Include quick reference commands
- [x] Include agent rules
- [x] Use "highly recommended" language (not "mandatory")

**Content:** See Spec S06 for full section content.

**Content outline:**
1. Recognition patterns (trigger phrases)
2. When to use tug (multi-file, symbols, scoping concerns)
3. When to skip tug (single file, literals, file renames)
4. Why tug over manual editing (scope-aware, verified, deterministic, safe)
5. Quick reference commands
6. Agent rules

**Checkpoint:**
- [x] CLAUDE.md contains "Tug Refactoring" section
- [x] Section includes recognition patterns
- [x] Section includes decision guidance (when to use/skip)
- [x] Section uses "highly recommended" language

**Rollback:**
- Revert changes to CLAUDE.md

---

#### Step 9A: Create Claude Code Skill for Tug Discovery {#step-9a}

**Commit:** `feat(interop): add tug-refactor skill for proactive discovery`

**References:** [D07] Pattern-Based Discovery, [D08] Skills as Proactive Discovery, Spec S04, Table T02, (#s04-skill-definition, #discovery-patterns)

**Artifacts:**
- New directory: `.claude/skills/tug-refactor/`
- New file: `.claude/skills/tug-refactor/SKILL.md`

**Tasks:**
- [x] Create `.claude/skills/tug-refactor/` directory
- [x] Create `.claude/skills/tug-refactor/SKILL.md` with content from Spec S04
- [x] Verify skill description includes trigger patterns from Table T02
- [x] Do NOT set `disable-model-invocation: true` (allow proactive invocation)

**Tests:**
- [ ] Manual: Verify skill appears in Claude Code skill list
- [ ] Manual: Test that Claude suggests tug when given a refactoring request

**Checkpoint:**
- [x] `.claude/skills/tug-refactor/SKILL.md` exists
- [x] File contains required YAML frontmatter (name, description)
- [x] Description includes trigger patterns

**Rollback:**
- Delete `.claude/skills/tug-refactor/` directory

---

#### Step 9B: Create UserPromptSubmit Hook (Experimental) {#step-9b}

**Commit:** `feat(interop): add experimental tug-discovery hook`

**References:** [D09] Lightweight Hook for Discovery, [Q02] Hook Feasibility (RESOLVED), Spec S05, (#s05-userprompt-hook)

**Artifacts:**
- New file: `.claude/hooks/tug-discovery.sh`
- New/updated: `.claude/settings.json`

**Tasks:**
- [x] Create `.claude/hooks/` directory if not exists
- [x] Create `.claude/hooks/tug-discovery.sh` with content from Spec S05
- [x] Make script executable: `chmod +x .claude/hooks/tug-discovery.sh`
- [x] Create/update `.claude/settings.json` to add hook configuration
- [x] Test hook locally with sample JSON input

**Hook Test:**
```bash
# Test the hook with a refactoring-related prompt
echo '{"session_id": "test", "prompt": "rename the function process_data to transform_data"}' | .claude/hooks/tug-discovery.sh
# Should output: [tug hint] For symbol renames...

# Test with non-refactoring prompt
echo '{"session_id": "test", "prompt": "explain how this code works"}' | .claude/hooks/tug-discovery.sh
# Should output nothing
```

**Tests:**
- [x] Script test: Refactoring pattern detection works
- [x] Script test: Non-refactoring prompts produce no output
- [x] Script test: Script always exits 0
- [ ] Manual: Hook triggers in Claude Code on refactoring prompts

**Checkpoint:**
- [x] `.claude/hooks/tug-discovery.sh` exists and is executable
- [x] Hook produces hint output for refactoring patterns
- [x] Hook produces no output for non-refactoring patterns
- [x] Hook always exits 0

**Rollback:**
- Delete `.claude/hooks/tug-discovery.sh`
- Remove hook entry from settings.json

**Note:** This step is experimental. If the hook proves too noisy or interferes with normal workflow, it can be removed without affecting other discovery mechanisms.

---

#### Step 10: Create Cursor Configuration with Discovery Patterns {#step-10}: DEFERRED

**Commit:** `feat(interop): add Cursor rules with discovery patterns`

**References:** [D07] Pattern-Based Discovery, [Q01] Cursor rules format (RESOLVED), Spec S07, Table T02, (#s07-enhanced-cursor, #discovery-patterns)

**Artifacts:**
- New file: `.cursor/rules/tug.mdc` (enhanced version with trigger patterns)

**Tasks:**
- [ ] Create `.cursor/rules/` directory
- [ ] Create `.cursor/rules/tug.mdc` with enhanced content from Spec S07
- [ ] Include "When to Suggest Tug" section with recognition patterns
- [ ] Include "When Tug is Highly Recommended" section
- [ ] Include "When to Skip Tug" section
- [ ] Include "Why Tug Over Manual Editing" section
- [ ] Set `alwaysApply: true` in frontmatter (language-agnostic)

**Content:** See Spec S07 for full file content.

**Key sections to include:**
1. Recognition patterns (same as CLAUDE.md for consistency)
2. When tug is highly recommended
3. When to skip tug
4. Workflow rules
5. Why tug over manual editing
6. Error handling
7. Commands reference

**Checkpoint:**
- [ ] `.cursor/rules/tug.mdc` file exists
- [ ] File contains recognition patterns matching Table T02
- [ ] File has valid `.mdc` frontmatter with `alwaysApply: true`
- [ ] File includes decision guidance (when to use/skip)

**Rollback:**
- Delete `.cursor/rules/` directory

---

#### Step 11: Update Agent Playbook {#step-11}

**Commit:** `docs: update AGENT_PLAYBOOK with Claude Code integration`

**References:** [D02] CLI as Kernel, (#documentation-plan)

**Artifacts:**
- Updated `docs/AGENT_PLAYBOOK.md`

**Tasks:**
- [x] Replace MCP configuration section with Claude Code commands section
- [x] Update example snippets to show command usage
- [x] Add Cursor section

**Checkpoint:**
- [x] No MCP references in AGENT_PLAYBOOK.md
- [x] Claude Code section documents commands
- [x] Cursor section documents rules file

**Rollback:**
- Revert changes

---

#### Step 12: Final Verification {#step-12}

**Commit:** N/A (verification only)

**References:** (#success-criteria)

**Tasks:**
- [x] Full build: `cargo build --workspace`
- [x] Full test suite: `cargo nextest run --workspace`
- [x] Grep verification: no unexpected MCP references
- [x] Documentation review: all docs updated
- [ ] Claude Code command test: manually test in Claude Code environment

**Checkpoint:**
- [x] All tests pass
- [x] All documentation updated
- [ ] Commands work in Claude Code (manual verification)
- [ ] `.cursor/rules/tug.mdc` present (DEFERRED - Step 10 was deferred)

---

### 9.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tugtool without MCP, with Claude Code commands and Cursor rules for editor integration.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [x] `cargo build -p tugtool` succeeds with no MCP code
- [x] `cargo nextest run --workspace` passes
- [x] No MCP references in code or user-facing documentation (except historical context in `plans/`)
- [x] `.claude/commands/tug-rename.md` exists and follows spec
- [x] `.claude/commands/tug-rename-plan.md` exists and follows spec
- [ ] `.claude/commands/tug-fixtures-ensure.md` exists and follows spec (DEFERRED - Step 8)
- [x] `.claude/skills/tug-refactor/SKILL.md` exists and follows spec
- [x] `.claude/hooks/tug-discovery.sh` exists and is executable (experimental)
- [ ] `.cursor/rules/tug.mdc` exists and includes discovery patterns (DEFERRED - Step 10)
- [x] CLAUDE.md updated with tug refactoring section including recognition patterns

**Acceptance tests:**
- [x] Build: `cargo build -p tugtool`
- [x] Tests: `cargo nextest run --workspace`
- [x] Grep: `grep -r "rmcp" --include="*.rs" --include="*.toml" crates/` returns empty

#### Milestones (Within Phase) {#milestones}

**Milestone M01: MCP Removed** {#m01-mcp-removed}
- [x] All MCP code deleted
- [x] All dependencies removed
- [x] Build succeeds

**Milestone M02: Claude Code Integration Complete** {#m02-claude-code}
- [x] All three commands created (tug-rename, tug-rename-plan; tug-fixtures-ensure DEFERRED)
- [x] `tug-refactor` skill created
- [x] Discovery hook created (experimental)
- [x] CLAUDE.md updated with discovery patterns

**Milestone M03: Cursor Integration Complete** {#m03-cursor}
- [ ] `.cursor/rules/tug.mdc` created with trigger patterns (DEFERRED - Step 10)
- [x] Documentation updated

**Milestone M04: Natural Discovery Complete** {#m04-discovery}
- [x] Recognition patterns documented in CLAUDE.md
- [x] Skill enables proactive tug suggestion
- [x] Hook detects refactoring patterns (experimental)
- [ ] Cursor rules include trigger patterns (DEFERRED - Step 10)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Test commands in production Claude Code environment
- [ ] Add more refactoring operations to commands as they're implemented
- [ ] Extend discovery patterns as new operations are added
- [ ] Consider VS Code extension for non-AI editor users
- [ ] Add `tug doctor` command for environment verification

| Checkpoint | Verification |
|------------|--------------|
| MCP removed | `grep -r "rmcp" Cargo.lock` returns empty |
| Tests pass | `cargo nextest run --workspace` |
| Commands exist | `ls .claude/commands/tug-*.md` shows 3 files |
| Skill exists | `cat .claude/skills/tug-refactor/SKILL.md` shows content |
| Hook exists | `test -x .claude/hooks/tug-discovery.sh` |
| Rules exist | `cat .cursor/rules/tug.mdc` shows content with patterns |

---

### Implementation Log {#implementation-log}

| Step | Status | Date | Notes |
|------|--------|------|-------|
| Step 0 | complete | 2026-01-22 | Audit complete - inventory of MCP references documented |
| Step 1 | complete | 2026-01-22 | Deleted mcp.rs, removed rmcp/schemars/tokio deps, removed mcp feature |
| Step 2 | complete | 2026-01-22 | Removed MCP from lib.rs, main.rs, Command::Mcp, execute_mcp() |
| Step 3 | complete | 2026-01-22 | Removed mcp_parity tests and MCP imports from test files |
| Step 4 | complete | 2026-01-22 | Removed MCP from CLAUDE.md, README.md, docs/, Justfile |
| Step 5 | complete | 2026-01-22 | Verified clean removal - 1205 tests pass, no MCP references |
| Step 6 | pending | | |
| Step 7 | pending | | |
| Step 8 | pending | | |
| Step 9 | pending | | Discovery patterns in CLAUDE.md |
| Step 9A | pending | | Skill creation |
| Step 9B | pending | | Hook creation (experimental) |
| Step 10 | pending | | Cursor rules with patterns |
| Step 11 | pending | | |
| Step 12 | pending | | |
