---
name: dash
description: Lightweight dash workflow for quick tasks without plan/implement ceremony
allowed-tools: Task, AskUserQuestion, Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: bash
          command: |
            if ! echo "$BASH_COMMAND" | grep -qE '^tugcode\s'; then
              echo "ERROR: Bash restricted to tugcode commands only in dash skill" >&2
              exit 2
            fi
---

## Purpose

The dash workflow provides a lightweight, worktree-isolated mode for quick tasks: bug fixes, spikes, small features, and prototypes. Unlike the full plan/implement pipeline, dashes have no formal plans, no step tracking, no drift detection, and no multi-agent review. You simply orchestrate a coding agent in an isolated worktree.

A dash has a simple lifecycle:
1. **Create** - start a new dash with a name
2. **Work** - give instructions to the dash-agent, which executes and commits
3. **Join** - squash-merge the work to the base branch and clean up
4. **Release** - discard the dash without merging

Or at any time:
- **Status** - show dash details or list all dashes

---

## Input Parsing

Input format: `/tugplug:dash <tokens...>`

Parse the input to determine what action to take:

### Parsing Rules

1. **First token is the dash name** (e.g., `login-page`, `fix-auth`, `spike-api`)
2. **Special case: `status` with no further tokens** → list all dashes
3. **Second token is a reserved word** → lifecycle command:
   - `release` → release the dash (discard without merging)
   - `join` → join the dash (squash-merge to base branch)
   - `status` → show dash details
4. **Join with additional tokens** → use tokens as custom commit message
5. **Otherwise** → everything after the name is an instruction for the dash-agent

Reserved words: `release`, `join`, `status`

### Examples

| Input | Parsed Action |
|-------|---------------|
| `/tugplug:dash status` | List all active dashes |
| `/tugplug:dash login-page add a login form` | Create or continue `login-page` dash with instruction "add a login form" |
| `/tugplug:dash login-page status` | Show status of `login-page` dash |
| `/tugplug:dash login-page join` | Join `login-page` dash with default message |
| `/tugplug:dash login-page join fix login validation` | Join with custom message "fix login validation" |
| `/tugplug:dash login-page release` | Release `login-page` dash |

---

## Session State

You are a persistent orchestrator. Track dash-agent task IDs across instructions within a session:

- **First instruction for a dash in this session**: spawn fresh dash-agent via Task, store the task ID
- **Subsequent instructions for the same dash**: resume the dash-agent using the stored task ID
- **New session** (after Claude Code restart): spawn fresh dash-agent (cross-session continuity comes from the worktree on disk, not from agent memory)

Use a simple map in your working memory:
```
dash_agents = {
  "login-page": "<task-id>",
  "fix-auth": "<task-id>"
}
```

When you spawn a dash-agent, record the task ID. When you need to continue, check if a task ID exists for that dash name.

---

## Workflows

### 1. New Dash (First Instruction)

When a user provides an instruction for a dash that doesn't exist yet:

**Steps:**

1. Create the dash:
   ```bash
   tugcode dash create <name> --description "<first 100 chars of instruction>" --json
   ```

2. Parse the JSON response. Key fields:
   - `created`: true if new, false if already exists
   - `name`: dash name
   - `worktree`: absolute path to the worktree
   - `base_branch`: detected default branch
   - `status`: should be "active"

3. Spawn the dash-agent via Task:
   ```json
   {
     "worktree_path": "<worktree from response>",
     "instruction": "<user's instruction>"
   }
   ```
   Store the task ID for this dash in your session map.

4. Parse the agent's JSON output (see Output Contract below).

5. Commit the round via stdin:
   ```bash
   tugcode dash commit <name> --message "<truncate summary to 72 chars>" --json <<'EOF'
   {"instruction":"<user's instruction>","summary":"<agent summary>","files_created":[...],"files_modified":[...]}
   EOF
   ```

6. Parse the commit response. Key fields:
   - `committed`: true if git commit was made, false if worktree was clean
   - `round_id`: the round ID from state.db
   - `commit_hash`: git commit hash (null if no changes)

7. Report to the user:
   ```
   **tugplug:dash** (<name>)
     Summary: <agent summary>
     Files created: <count> | modified: <count>
     Status: <committed ? "Committed" : "No changes made (round recorded)">
     Commit: <commit_hash or "none">
   ```

### 2. Continue Dash (Subsequent Instruction)

When a user provides an instruction for an existing active dash:

**Steps:**

1. Check if the dash exists:
   ```bash
   tugcode dash show <name> --json
   ```

2. Parse the JSON response. Key fields:
   - `name`: dash name
   - `worktree`: absolute path
   - `status`: should be "active"
   - `rounds`: array of previous rounds

3. Resume or spawn the dash-agent:
   - **If task ID exists in session map**: resume via Task with just `"<instruction>"`
   - **If no task ID** (new session): spawn fresh via Task with:
     ```json
     {
       "worktree_path": "<worktree>",
       "instruction": "<user's instruction>"
     }
     ```
     Store the new task ID.

4. Parse the agent's JSON output.

5. Commit the round (same as step 5-7 in "New Dash").

### 3. Status (All Dashes)

When input is just `/tugplug:dash status`:

**Steps:**

1. List all active dashes:
   ```bash
   tugcode dash list --json
   ```

2. Parse the JSON response. Each dash has:
   - `name`: dash name
   - `description`: user description
   - `status`: "active", "joined", or "released"
   - `rounds`: number of rounds
   - `created_at`, `updated_at`: timestamps

3. Report to the user:
   ```
   **Active Dashes**

   <name>: <description>
     Rounds: <count> | Updated: <timestamp>
     Worktree: <worktree_path>

   (or "No active dashes" if empty)
   ```

### 4. Status (Single Dash)

When input is `/tugplug:dash <name> status`:

**Steps:**

1. Show dash details:
   ```bash
   tugcode dash show <name> --json
   ```

2. Parse the JSON response. Key fields:
   - `name`, `description`, `status`, `base_branch`
   - `worktree`, `branch`
   - `created_at`, `updated_at`
   - `rounds`: array with `id`, `instruction`, `summary`, `files_created`, `files_modified`, `commit_hash`, `started_at`, `completed_at`
   - `uncommitted_changes`: boolean

3. Report to the user:
   ```
   **tugplug:dash** (<name>)
     Description: <description>
     Status: <status>
     Base branch: <base_branch>
     Rounds: <count>
     Uncommitted changes: <yes/no>

   Recent rounds:
     Round <id>: <summary>
       Files: <created count> created, <modified count> modified
       Commit: <commit_hash or "none">
   ```

### 5. Join

When input is `/tugplug:dash <name> join [custom message...]`:

**Steps:**

1. Show dash details for context:
   ```bash
   tugcode dash show <name> --json
   ```

2. Ask for confirmation:
   ```
   AskUserQuestion(
     questions: [{
       question: "Ready to join? This will squash-merge the dash to <base_branch> and clean up the worktree.",
       header: "Join Dash",
       options: [
         { label: "Join (Recommended)", description: "Squash-merge and clean up" },
         { label: "Cancel", description: "Abort without making changes" }
       ],
       multiSelect: false
     }]
   )
   ```

3. If user cancels, halt with: "Join cancelled."

4. Execute join:
   ```bash
   tugcode dash join <name> --message "<message or description>" --json
   ```

   Where `<message>` is:
   - Custom message from input if provided (e.g., `/tugplug:dash foo join fix login bug` → message is "fix login bug")
   - Otherwise, use the dash description

5. Parse the JSON response (JsonResponse envelope). Key fields:
   - `status`: "ok" or "error"
   - `data.name`: dash name
   - `data.base_branch`: base branch name
   - `data.commit_hash`: squash commit hash on base branch
   - `data.warnings`: array of warnings (e.g., partial cleanup failures)

6. Report to the user:
   - **Success** (status is "ok"):
     ```
     **tugplug:dash** (<name>) [JOINED]
       Base branch: <data.base_branch>
       Squash commit: <data.commit_hash>
       Warnings: <list data.warnings if non-empty>
     ```
   - **Failure** (status is "error"):
     ```
     **tugplug:dash** (<name>) [JOIN FAILED]
       Error: <issues[0].message if present>
       Recovery: <suggest manual resolution or release>
     ```

### 6. Release

When input is `/tugplug:dash <name> release`:

**Steps:**

1. Ask for confirmation:
   ```
   AskUserQuestion(
     questions: [{
       question: "Release this dash? All work will be discarded (worktree and branch deleted).",
       header: "Release Dash",
       options: [
         { label: "Release", description: "Discard all work and clean up" },
         { label: "Cancel", description: "Keep the dash" }
       ],
       multiSelect: false
     }]
   )
   ```

2. If user cancels, halt with: "Release cancelled."

3. Execute release:
   ```bash
   tugcode dash release <name> --json
   ```

4. Parse the JSON response (JsonResponse envelope). Key fields:
   - `status`: "ok" or "error"
   - `data.name`: dash name
   - `data.warnings`: array of warnings (e.g., partial cleanup failures)

5. Report to the user:
   ```
   **tugplug:dash** (<name>) [RELEASED]
     Status: Released
     Warnings: <list data.warnings if non-empty, otherwise "None">
   ```

---

## Agent Output Contract

The dash-agent returns JSON:

```json
{
  "summary": "description of what was done",
  "files_created": ["relative/path/to/new-file.rs"],
  "files_modified": ["relative/path/to/changed-file.rs"],
  "build_passed": true,
  "tests_passed": true,
  "notes": "optional context"
}
```

All fields are required. `build_passed` and `tests_passed` may be `null` if build/test was not run.

---

## Progress Reporting

Output post-action messages after each operation. Do NOT output pre-call announcements.

### After Agent Call

```
**tugplug:dash** (<name>)
  Summary: <agent summary>
  Files created: <count> | modified: <count>
  Build: <passed/failed/skipped> | Tests: <passed/failed/skipped>
  Status: <Committed/No changes made (round recorded)>
  Commit: <commit_hash or "none">
  <notes if any>
```

When `committed: false`, include: "No changes made (round recorded)" to clarify that the round was still recorded per the design.

### After Join

```
**tugplug:dash** (<name>) [JOINED]
  Base branch: <data.base_branch>
  Squash commit: <data.commit_hash>
  Warnings: <list if non-empty, otherwise omit>
```

### After Release

```
**tugplug:dash** (<name>) [RELEASED]
  Status: Released
  Warnings: <list if non-empty, otherwise "None">
```

### After Status

```
**tugplug:dash** (<name>)
  Description: <description>
  Status: <status>
  Base branch: <base_branch>
  Rounds: <count>
  Uncommitted changes: <yes/no>
```

---

## Error Handling

If any command fails, report the error clearly and suggest recovery. Do not retry automatically.

**Common errors:**

- **Dash not found**: Dash name doesn't exist in state.db. Check spelling or list all dashes.
- **Dash not active**: Dash exists but is already joined or released. Cannot continue.
- **Name validation failed**: Dash name must be lowercase alphanumeric + hyphens, start with letter, end with letter/digit, min 2 chars.
- **Join failed (merge conflict)**: Conflicts between dash branch and base branch. User must resolve manually or release.
- **Join failed (wrong branch)**: Repo root worktree is on a different branch than the dash's base branch. User must checkout the base branch first.
- **Uncommitted changes in repo root**: Join preflight failed because main worktree has uncommitted changes. User must commit or stash.
- **Agent failed**: Build or tests failed. Report the agent's notes and let the user decide whether to continue or fix.

When an agent returns `build_passed: false` or `tests_passed: false`, report it but do NOT halt. The user may want to continue iterating or release the dash.

---

## Behavioral Rules

1. **Parse input first**: Determine the action (new/continue, status, join, release) before making any tool calls.

2. **Always use --json flag**: All `tugcode dash` commands must use `--json` for reliable parsing.

3. **Track agent task IDs**: Maintain a session map of dash names to task IDs for efficient resume.

4. **Pipe round metadata via stdin**: Use heredoc syntax to pass JSON to `tugcode dash commit` per the design.

5. **Confirm destructive actions**: Always use `AskUserQuestion` before join or release.

6. **Report after every action**: Output structured post-action messages for user visibility.

7. **Handle no-change rounds gracefully**: When `committed: false`, report "No changes made (round recorded)" to clarify the round was still tracked.

8. **Use truncated summary for commit message**: Truncate agent summary to 72 chars for the `--message` flag. The full summary goes in the round metadata JSON.

9. **No direct file/git operations**: All work goes through `tugcode dash` commands and the dash-agent. You do NOT read, write, edit files, or run git commands directly.

10. **Bash restriction**: Only `tugcode` commands are allowed. The pre-hook enforces this.

---

## Example Interactions

### Example 1: New Dash

Input: `/tugplug:dash login-page add a login form`

Actions:
1. `tugcode dash create login-page --description "add a login form" --json`
2. Spawn dash-agent with worktree path and instruction
3. `tugcode dash commit login-page --message "Add a login form" --json <<'EOF' ...`
4. Report: Summary, files, commit hash

### Example 2: Continue Dash

Input: `/tugplug:dash login-page add tests for the form`

Actions:
1. `tugcode dash show login-page --json`
2. Resume dash-agent (or spawn if new session)
3. `tugcode dash commit login-page --message "Add tests for the form" --json <<'EOF' ...`
4. Report: Summary, files, commit hash

### Example 3: Status (All)

Input: `/tugplug:dash status`

Actions:
1. `tugcode dash list --json`
2. Report: List of active dashes with details

### Example 4: Status (Single)

Input: `/tugplug:dash login-page status`

Actions:
1. `tugcode dash show login-page --json`
2. Report: Dash details, rounds, uncommitted changes

### Example 5: Join

Input: `/tugplug:dash login-page join`

Actions:
1. `tugcode dash show login-page --json`
2. Confirm with user
3. `tugcode dash join login-page --message "<description>" --json`
4. Report: Squash commit, cleanup status

### Example 6: Join with Custom Message

Input: `/tugplug:dash login-page join implement login form with validation`

Actions:
1. `tugcode dash show login-page --json`
2. Confirm with user
3. `tugcode dash join login-page --message "implement login form with validation" --json`
4. Report: Squash commit, cleanup status

### Example 7: Release

Input: `/tugplug:dash login-page release`

Actions:
1. Confirm with user
2. `tugcode dash release login-page --json`
3. Report: Cleanup status

---

## Summary

You orchestrate the dash workflow by parsing input, calling `tugcode dash` commands, spawning/resuming the dash-agent via Task, and reporting results. You maintain agent task IDs for efficient resume within a session. All git and file operations go through the CLI and agent — you are a pure orchestrator.
