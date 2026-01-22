## Editor interop: Claude Code + Cursor (post-MCP) {#editor-interop}

**Purpose:** Define the *actual* interoperability surface for tugtool in the likely future: editor-native **rules**, **commands**, and **agent orchestration** (Claude Code + Cursor), built on top of tug’s **CLI + stable JSON contract**.

This doc sketches:
- A shared mental model (“one kernel, many front doors”).
- A flagship workflow: **rename symbol with review + apply + verify**.
- Concrete **command designs** for Claude Code and Cursor.
- Concrete **rule sets** to keep agents safe/deterministic.
- A deterministic **decision tree** based on tug’s **JSON** + **exit codes**.

---

### Core premise: one kernel, many front doors {#one-kernel-many-front-doors}

**Kernel:** tug CLI subcommands that emit strict JSON on stdout and stable exit codes.

**Front doors:** editor-specific workflows that:
- gather context (cursor location, selected symbol, workspace root),
- call tug commands in the right order,
- interpret JSON + exit codes deterministically,
- present concise summaries,
- enforce safety rails (review-before-apply, thresholds, etc.).

This keeps tug portable without betting on a cross-assistant RPC spec.

---

## Shared contract: how the front door interprets tug {#shared-contract}

### Exit codes (Table T26 / stable) {#exit-codes}

Front doors MUST branch on exit code first:

| Exit | Meaning | Front door behavior |
|------|---------|---------------------|
| 0 | Success | Parse stdout JSON, continue |
| 2 | Invalid arguments | Show error; request corrected input (location/name/flags) |
| 3 | Resolution error | Show error; refine location/symbol selection; re-run analyze-impact |
| 4 | Apply error | Treat as “nothing applied or partial?” (see below); advise retry after refresh |
| 5 | Verification failed | Treat as “do not apply / do not proceed”; show verification output |
| 10 | Internal error | Stop; instruct to file bug and include stderr + JSON |

**Non-negotiable:** front doors do *not* guess. They either proceed deterministically or stop with a clear next action.

### JSON envelope basics {#json-envelope}

Front doors assume:
- stdout is valid JSON
- has `"status": "ok"` or `"status": "error"`
- has `"schema_version": "1"`

Errors follow the standard error shape:

```json
{
  "status": "error",
  "schema_version": "1",
  "error": {
    "code": "InvalidArguments|FileNotFound|SymbolNotFound|...",
    "message": "..."
  }
}
```

**Agent UX rule:** show `error.code` + `error.message` verbatim; do not rephrase unless adding a *short* suggested fix.

### Rename workflow “happy path” outputs {#rename-outputs}

Front doors should rely on these fields (conceptually):

- **Analyze-impact response**
  - Key fields (typical): symbol info, `impact.files_affected`, `impact.references_count`, `impact.edits_estimated`
  - Gatekeeper for “is this safe to apply?”

- **Run response (dry-run)**
  - Key fields: patch edits / summary; verification info for sandbox run
  - Gatekeeper for “review patch before apply”

- **Run response (apply)**
  - Key fields: verification + summary; confirms applied changes

If the exact field names evolve, front doors should follow the schema version and only depend on stable semantics (status, schema_version, error envelope, exit codes, and summary/verification concepts).

---

## Flagship workflow: Rename symbol with review + apply + verify {#flagship-rename}

### Workflow goal {#flagship-goal}

Given a symbol location (file:line:col) and a new name:

1. **Analyze**: enumerate impact (read-only).
2. **Review**: generate a patch and show summary (read-only dry-run).
3. **Apply**: run verified apply.
4. **Verify**: confirm verification passed and summarize.

### Workflow inputs {#workflow-inputs}

Front doors should populate these automatically when possible:
- **workspace root**: current project root in editor
- **location**: from cursor position or selected symbol
  - file: current file path relative to workspace
  - line/col: cursor location (1-based)
- **new name**: from user prompt

### Workflow calls (canonical sequence) {#workflow-calls}

1) Analyze:

```bash
tug analyze-impact rename-symbol --at <file:line:col> --to <new_name>
```

2) Dry run (review patch + verify in sandbox):

```bash
tug run --verify syntax rename-symbol --at <file:line:col> --to <new_name>
```

3) Apply (verified):

```bash
tug run --apply --verify syntax rename-symbol --at <file:line:col> --to <new_name>
```

4) Optional explicit verify (if desired / for “tests” mode):

```bash
tug verify <syntax|tests|typecheck>
```

### Decision gates (must be deterministic) {#decision-gates}

**Gate A: analyze-impact risk threshold**

Front door computes a “risk class” from analyze-impact:
- If `files_affected` > 50 OR `edits_estimated` > 500 → require explicit human approval to proceed to dry-run/apply.
- If `references_count` is 0 → likely wrong location; stop and request new location.

**Gate B: patch review**

Before apply, front door must show:
- files changed count
- edits count
- a short list of top N files changed (or first N edits)

Then require an explicit “apply” decision (button/confirmation phrase).

**Gate C: verification**

If verification status is not “passed”:
- Do not proceed to apply (if still in dry-run), and stop with clear instructions.
- If apply already happened (should be rare if tug is sandbox-first), treat as urgent: instruct immediate rollback strategy (git restore / revert) and rerun analyze.

---

## Claude Code front door design {#claude-code}

### Claude Code command set (minimal) {#claude-commands}

These should live as Claude Code commands (e.g., `.claude/commands/`), with consistent naming and minimal arguments.

#### Command: `/tug-rename` {#claude-tug-rename}

**User experience:**
- Runs the full analyze → dry-run → review → apply workflow.
- Uses editor context (current file + cursor) as default location.
- Prompts only for the new name and final apply confirmation.

**Inputs (prompted or inferred):**
- new name (required)
- verification mode (optional; default: `syntax`)

**Algorithm (Claude agent orchestration):**
- Determine `<file:line:col>` from editor context.
- Run analyze-impact.
- Summarize impact; apply Gate A.
- Run dry-run `tug run` (no apply).
- Summarize patch and verification; apply Gate B and Gate C.
- If approved: run apply `tug run --apply`.
- Summarize final result and next steps.

**Claude-specific rule:** never “helpfully” apply without surfacing the patch summary and receiving approval.

#### Optional command: `/tug-rename-plan` {#claude-tug-rename-plan}

**Purpose:** analyze + dry-run only (no apply), suitable for cautious workflows.

#### Optional command: `/tug-fixtures-ensure` {#claude-tug-fixtures-ensure}

**Purpose:** run `tug fixture fetch` and/or `tug fixture status` and report readiness (important for Temporale tests or other fixtures).

### Claude Code rules (recommended) {#claude-rules}

These are “agent behavior rules” (not shell scripts):

- **Review before apply**: always run analyze-impact and dry-run before any `--apply`.
- **Approval required**: require explicit user confirmation for apply.
- **Exit-code driven**: if exit code is nonzero, stop and surface the JSON error; do not attempt unrelated retries.
- **No commits**: do not run `git commit` (project rule).
- **No mutation outside tug** during workflow: avoid manual edits in the same files between analyze and apply.
- **Deterministic reporting**: present summaries using actual numeric fields from tug output (no invented counts).

### Claude Code error handling playbook {#claude-errors}

On nonzero exit codes:
- **2**: show the bad argument (location/new name) and ask for correction.
- **3**: suggest “try a different location” and, if in an editor context, propose selecting the symbol definition or moving cursor to the declaration.
- **4**: advise `--fresh` session (if that’s part of your session model) or rerun analyze-impact to refresh snapshot.
- **5**: show verification output; recommend either changing verification mode or fixing failing code/tests.
- **10**: ask user to file issue with stderr + JSON.

---

## Cursor front door design {#cursor}

Cursor’s “interop” is best expressed as a combination of:
- **Rules** (agent behavior constraints),
- **Commands / Tasks** (repeatable workflows),
- **Agent prompt templates** (how the agent explains/requests approval).

### Cursor command set (minimal) {#cursor-commands}

Cursor should expose “one-click” or “command palette” actions that call tug.

#### Command: “Tug: Rename symbol (safe)” {#cursor-rename-safe}

**Behavior (same as Claude `/tug-rename`):**
- infer file + cursor position
- prompt for new name
- run analyze-impact → dry-run → show summary → ask approval → apply

**Cursor-specific detail:** Cursor can populate cursor position automatically; the command should not require the user to type `file:line:col`.

#### Command: “Tug: Rename symbol (plan only)” {#cursor-rename-plan}

Analyze + dry-run only.

#### Command: “Tug: Fixture status” {#cursor-fixture-status}

Runs `tug fixture status` and shows fetched/missing/sha-mismatch states.

### Cursor rules (recommended) {#cursor-rules}

These are the rules you want the Cursor agent to follow when invoking tug:

- **No direct edits for rename**: for rename workflows, do not hand-edit; rely on tug to apply patches.
- **Two-phase apply**: must run analyze-impact and dry-run before apply.
- **Approval gate**: must ask “Apply now?” and wait for user approval.
- **Never interpret nonzero exit as “try again”** unless the retry is a deterministic fix (e.g., fetch missing fixture).
- **Always log commands executed** (in the chat transcript) and present the JSON summary fields.

---

## Implementation details that make this robust {#implementation-details}

### Stable location capture {#location-capture}

For editor-native interop, the critical piece is translating editor selection to tug `--at file:line:col`.

Front doors should:
- prefer symbol definition location if available (rename-at-definition is less ambiguous)
- normalize path relative to workspace root
- always use 1-based line/col

### Deterministic “review view” formatting {#review-view}

Front door should show a consistent summary, such as:

- **Impact**: files_affected / references_count / edits_estimated
- **Dry-run result**: files_changed / edits_count / verification status
- **Apply result**: files_changed / edits_count / verification status

Then optionally show a small patch excerpt or top files changed (bounded list).

### Handling fixtures during refactors {#fixtures}

If rename workflow includes verification that depends on fixtures (e.g., Python tests), the front door can:
- run `tug fixture status` first
- if missing: run `tug fixture fetch`
- re-run verification

This should be explicit in the transcript (“fixture missing → fetching → retry verify”).

---

## Roadmap items to support editor interop (kernel-side) {#roadmap}

These are improvements that specifically amplify Claude/Cursor front doors:

- **“Cursor-position aware” helper** (front-door side): standardized way to get `file:line:col`.
- **Better “review payload”**: a compact list of files changed and edit counts in the run response (if not already present).
- **`tug doctor`** (optional): one command that reports toolchain + fixture readiness as JSON.
- **Schema stability policy**: document what’s stable per `schema_version` and what can evolve.

---

### Summary {#summary}

If MCP is removed, tug’s interop strategy becomes:
- A hardened CLI kernel with stable JSON + exit codes.
- First-class “front doors” implemented as Claude Code commands and Cursor commands/rules.
- A single flagship workflow (rename) that is safe by construction: analyze → review → apply → verify, driven entirely by tug outputs.

