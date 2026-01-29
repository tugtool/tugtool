# Tug Agent Guide

This document is the single source of truth for integrating tug into AI coding agents.

---

## For Your CLAUDE.md

The section below can be copied directly into a project's `CLAUDE.md` file to enable AI agents to use tug for refactoring.

<!-- BEGIN CLAUDE.md CLIP -->

### Tug Refactoring

Tug is a semantic refactoring tool for Python. It understands code structure, not just text patterns, and updates all references to a symbol atomically.

**Language Support:** Python only. Rust support is planned.

#### When to Use Tug

Use tug when you see requests like:
- "rename X to Y" / "rename the function/class/variable"
- "change the name of" / "refactor the name"
- "update all references to X"

**Use tug when:**
- The symbol appears in multiple files
- Renaming functions, classes, methods, or variables
- User mentions "all references", "across the codebase", "everywhere"

**Skip tug when:**
- Single file, single occurrence (just edit directly)
- String literals or comments only
- Non-Python files

#### Workflow

Always analyze before applying:

```bash
# 1. Analyze impact (read-only)
tug analyze python rename --at src/utils.py:42:5 --to new_name

# 2. Review the JSON output - check files_affected and references

# 3. Apply with verification
tug apply python rename --at src/utils.py:42:5 --to new_name
```

#### Command Quick Reference

```bash
# Analyze - see what will change (read-only)
tug analyze python rename --at <file:line:col> --to <new_name>

# Emit - output diff without modifying files
tug emit python rename --at <file:line:col> --to <new_name>

# Apply - execute the refactor
tug apply python rename --at <file:line:col> --to <new_name>

# With file filter (restrict scope)
tug apply python rename --at <file:line:col> --to <new_name> -- 'src/**/*.py'

# With exclusion filter
tug apply python rename --at <file:line:col> --to <new_name> -- '!tests/**'

# Skip verification (use with caution)
tug apply python rename --at <file:line:col> --to <new_name> --no-verify
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Invalid arguments |
| 3 | Symbol not found |
| 4 | Apply failed |
| 5 | Verification failed |

<!-- END CLAUDE.md CLIP -->

---

## Overview

Tug is a refactoring tool for AI coding agents. It provides verified, deterministic, minimal-diff refactors. Unlike simple find-and-replace, tug understands code semantics: it parses your code, builds a symbol graph, and ensures that all references to a symbol are updated correctly.

Structured output is JSON for easy parsing by LLM agents, with one exception: `emit` defaults to a unified diff (and can optionally wrap the diff in JSON). Every operation goes through a verification pipeline that catches syntax errors before changes are applied, ensuring that the codebase remains valid after refactoring.

The key design principle is "analyze, review, apply": agents first analyze the impact of a change, review the proposed edits, and only then apply them. This workflow prevents accidental breakage and gives agents full visibility into what will change before any files are modified.

---

## CLI Reference

### Global Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--workspace <path>` | Workspace root directory | Current directory |
| `--session-dir <path>` | Session directory path | `.tug/` in workspace |
| `--session-name <name>` | Named session | `default` |
| `--fresh` | Delete existing session and start fresh | `false` |
| `--log-level <level>` | Log level (trace, debug, info, warn, error) | `warn` |

### Commands

| Command | Description | Example |
|---------|-------------|---------|
| `apply <lang> <op>` | Apply refactoring (modifies files) | `tug apply python rename --at f.py:1:5 --to bar` |
| `emit <lang> <op>` | Emit diff without modifying | `tug emit python rename --at f.py:1:5 --to bar` |
| `analyze <lang> <op>` | Analyze impact (read-only) | `tug analyze python rename --at f.py:1:5 --to bar` |
| `session status` | Show session status | `tug session status` |
| `clean` | Clean session resources | `tug clean --cache` |
| `doctor` | Run environment diagnostics | `tug doctor` |
| `fixture fetch` | Fetch test fixtures | `tug fixture fetch` |

### Rename Command Options

**apply python rename:**

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--at` | yes | - | Location: `path:line:col` |
| `--to` | yes | - | New name for the symbol |
| `--verify` | no | `syntax` | Verification mode: `none`, `syntax`, `tests`, `typecheck` |
| `--no-verify` | no | false | Skip verification (shorthand for `--verify=none`) |

**emit python rename:**

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--at` | yes | - | Location: `path:line:col` |
| `--to` | yes | - | New name for the symbol |
| `--json` | no | false | Output JSON envelope instead of plain diff |

**analyze python rename:**

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--at` | yes | - | Location: `path:line:col` |
| `--to` | yes | - | New name for the symbol |
| `--output` | no | `impact` | Output format: `impact`, `references`, `symbol` |

---

## File Filtering

Tug provides a powerful filtering system to restrict which files are included in refactoring operations.

### Filter Flags

| Flag | Type | Description |
|------|------|-------------|
| `--filter <expr>` | Repeatable | Expression filter (multiple are AND'd together) |
| `--filter-json <json>` | Single | JSON filter schema for complex filters |
| `--filter-file <path>` | Single | File containing filter definitions |
| `--filter-file-format <fmt>` | Single | Format for `--filter-file`: `json`, `glob`, or `expr` |
| `--filter-content` | Flag | Enable content predicates (`contains`, `regex`) |
| `--filter-content-max-bytes <n>` | Single | Max file size for content predicates (default: 5MB) |
| `--filter-list` | Flag | Output matched files as JSON and exit (no refactor) |
| `-- <patterns...>` | Positional | Glob patterns (placed at end of command) |

### Glob Patterns

Glob patterns appear after `--` at the end of the command:

```bash
# Include only src/ files
tug apply python rename --at f.py:1:5 --to bar -- 'src/**/*.py'

# Exclude tests
tug apply python rename --at f.py:1:5 --to bar -- '!tests/**'

# Combined
tug apply python rename --at f.py:1:5 --to bar -- 'src/**/*.py' '!**/test_*.py'
```

### Expression Filters

Use `--filter "<expr>"` for human-readable filter expressions:

```bash
# Filter by extension and path
tug apply python rename --at f.py:1:5 --to bar --filter "ext:py and path:src/**"

# Exclude test files
tug apply python rename --at f.py:1:5 --to bar --filter "not name:*_test.py"

# Only modified files
tug apply python rename --at f.py:1:5 --to bar --filter "git_status:modified"
```

**Predicates:**

| Key | Meaning | Example |
|-----|---------|---------|
| `path` | Path glob | `path:src/**` |
| `name` | Basename glob | `name:*_test.py` |
| `ext` | Extension (no dot) | `ext:py` |
| `lang` | Language tag | `lang:python` |
| `kind` | `file` or `dir` | `kind:file` |
| `size` | File size | `size>10k`, `size<=2m` |
| `mtime` | Modified time | `mtime>2025-01-01` |
| `contains` | Content substring (requires `--filter-content`) | `contains:"TODO"` |
| `regex` | Content regex (requires `--filter-content`) | `regex:TODO` |
| `git_status` | Git status | `git_status:modified` |
| `git_tracked` | Tracked by git | `git_tracked:true` |
| `git_ignored` | Ignored by git | `git_ignored:true` |
| `git_stage` | Staging state | `git_stage:staged` |

**Operators:** `:` (glob/eq), `~` (regex), `=`, `!=`, `>`, `>=`, `<`, `<=`

**Combinators:** `and`, `or`, `not`, `(...)`

**Precedence:** `not` > `and` > `or`

### JSON Filters

Use `--filter-json` for programmatic filter construction:

```bash
tug apply python rename --at f.py:1:5 --to bar --filter-json '{
  "predicates": [
    {"key": "ext", "op": "eq", "value": "py"},
    {"key": "path", "op": "glob", "value": "src/**"}
  ]
}'
```

**Schema:**
```json
{
  "all": [ <filter>, ... ],   // AND
  "any": [ <filter>, ... ],   // OR
  "not": <filter>,            // NOT
  "predicates": [...]         // AND-combined predicate list
}
```

**Operations:** `eq`, `glob`, `match`, `gt`, `gte`, `lt`, `lte`

### Filter Combination Order

Filters are combined with AND in this order:
1. Language-appropriate files (`**/*.py` for Python)
2. Default exclusions (`.git`, `__pycache__`, `venv`, etc.)
3. Glob patterns (`-- <patterns...>`)
4. Expression filters (`--filter`)
5. JSON filter (`--filter-json`)
6. Filter file content (`--filter-file`)

### Filter Introspection

Use `--filter-list` to see matched files without running the refactor:

```bash
tug apply python rename --at f.py:1:5 --to bar --filter "path:src/**" --filter-list
```

**Output:**
```json
{
  "files": ["src/a.py", "src/b.py"],
  "count": 2,
  "filter_summary": {
    "glob_patterns": [],
    "expressions": ["path:src/**"],
    "json_filter": null,
    "content_enabled": false
  }
}
```

---

## JSON Output Schema

All CLI output follows the JSON output schema. Key principles:

1. **Structured JSON** - All structured output is valid JSON; `emit` may output plain unified diff by default
2. **Status first** - Every response has `status` as the first field
3. **Deterministic** - Same input produces same output
4. **Versioned** - `schema_version` enables forward compatibility

### Common Types

**Location:**
```json
{
  "file": "src/utils.py",
  "line": 42,
  "col": 8,
  "byte_start": 1234,
  "byte_end": 1245
}
```

**Symbol:**
```json
{
  "id": "sym_abc123",
  "name": "process_data",
  "kind": "function",
  "location": { ... }
}
```

Symbol kinds: `function`, `class`, `method`, `variable`, `parameter`, `module`, `import`

**Reference:**
```json
{
  "location": { ... },
  "kind": "call"
}
```

Reference kinds: `definition`, `call`, `reference`, `import`, `attribute`

### Response Envelope

Success:
```json
{
  "status": "ok",
  "schema_version": "1",
  "snapshot_id": "snap_abc123",
  ...
}
```

Error:
```json
{
  "status": "error",
  "schema_version": "1",
  "error": {
    "code": "SymbolNotFound",
    "message": "No symbol found at specified location"
  }
}
```

---

## Error Codes

Tug uses stable error codes for programmatic error handling:

| Exit Code | Error Code | Description | Recovery |
|-----------|------------|-------------|----------|
| 0 | - | Success | - |
| 2 | `InvalidArguments` | Bad input (malformed location, invalid identifier) | Fix arguments and retry |
| 3 | `ResolutionError` | Symbol not found, ambiguous, or file not found | Check location is correct |
| 4 | `ApplyError` | Failed to apply changes (snapshot mismatch, write error) | Re-analyze and retry |
| 5 | `VerificationFailed` | Syntax/type/test errors after changes | Fix issues or revert |
| 10 | `InternalError` | Bug or unexpected state | Report issue |

### Resolution Errors (Exit Code 3)

| Code | Meaning | Details |
|------|---------|---------|
| `SymbolNotFound` | No symbol at specified location | Check line/column numbers |
| `AmbiguousSymbol` | Multiple symbols match | Use more specific location |
| `FileNotFound` | Specified file doesn't exist | Check file path |
| `InvalidPosition` | Line/col out of bounds | Check file hasn't changed |

### Apply Errors (Exit Code 4)

| Code | Meaning | Details |
|------|---------|---------|
| `SnapshotMismatch` | Files changed since analysis | Re-run analyze |
| `AnchorMismatch` | Edit anchor doesn't match | File was modified |
| `WriteError` | Failed to write file | Check permissions |

### Verification Errors (Exit Code 5)

| Code | Meaning | Details |
|------|---------|---------|
| `SyntaxError` | Code has syntax errors | Review changes |
| `TestsFailed` | Tests failed after changes | Fix tests or revert |
| `TypecheckFailed` | Type checker found errors | Fix type errors |

---

## Error Handling Patterns

### Shell Exit Code Handling

```bash
tug apply python rename --at file.py:1:5 --to new_name
exit_code=$?

case $exit_code in
  0)
    echo "Rename successful"
    ;;
  2)
    echo "Invalid arguments - check location format (file:line:col)"
    ;;
  3)
    echo "Symbol not found - verify the location is correct"
    # Re-search for the symbol definition
    grep -rn "def old_name" src/
    ;;
  4)
    echo "Apply failed - files may have changed since analysis"
    # Re-run analyze and try again
    tug analyze python rename --at file.py:1:5 --to new_name
    ;;
  5)
    echo "Verification failed - syntax errors in result"
    ;;
  10)
    echo "Internal error - report to maintainers"
    ;;
esac
```

### JSON Error Parsing

```bash
output=$(tug analyze python rename --at file.py:1:5 --to bar 2>&1)
status=$(echo "$output" | jq -r '.status')

if [ "$status" = "error" ]; then
  error_code=$(echo "$output" | jq -r '.error.code')
  error_message=$(echo "$output" | jq -r '.error.message')
  echo "Error ($error_code): $error_message"
fi
```

---

## Agent Contract

Agents can expect the following guarantees from tug:

### Prerequisites

- `tug` binary in PATH
- Running in project root directory

### Workflow

1. `analyze` - See what will change (read-only, fast)
2. `emit` - Generate diff for review (read-only)
3. `apply` - Execute with verification

### Output Format

- All commands output JSON to stdout (except `emit` which outputs plain diff by default)
- Tracing/debug output goes to stderr
- Exit codes match the Error Codes table above

### When NOT to Use tug

Tug is not the right tool for:

- **External packages** - You can't edit code in site-packages or node_modules
- **Dynamic code patterns** - `getattr()`, `eval()`, `exec()` can't be statically analyzed. Tug will warn about these but may miss references.
- **Simple string replacement** - If you're just replacing a string literal (not a symbol), use `sed` or your editor's find-and-replace
- **Non-Python files** - Currently only Python is supported. Rust support is planned.

When in doubt, use `analyze` first to see what tug can find. If references are missing, you may need to handle those manually.

---

## Tool Integration

### Claude Code

Claude Code provides built-in slash commands for tug integration.

**Available Commands:**
- `/tug-apply-rename` - Full rename workflow: analyze impact, preview, and apply with approval
- `/tug-emit-rename` - Generate unified diff without applying changes
- `/tug-analyze-rename` - Analyze impact only (read-only JSON output)

**Using the Commands:**

When the user requests a symbol rename:

1. **Identify the location**: Determine file, line, and column of the symbol
2. **Run `/tug-apply-rename`**: The command handles the full workflow:
   - Analyzes impact and shows affected files/references
   - Asks for approval before applying changes
   - Applies with syntax verification

For cautious workflows:
- Use `/tug-analyze-rename` to see impact without any changes
- Use `/tug-emit-rename` to see the exact diff without applying

**Skill-Based Discovery:**

The `tug-refactor` skill enables proactive tug suggestions when Claude detects refactoring-related requests like:
- "rename X to Y"
- "change the name of"
- "update all references"

### Cursor

Cursor can use tug through its AI rules system and CLI integration.

**Cursor Rules:**

The `.cursor/rules/tug.mdc` file provides Cursor AI with context about when and how to use tug. This enables Cursor to automatically suggest tug for refactoring requests.

**CLI via Tasks:**

Add to `.cursor/tasks.json`:

```json
{
  "tasks": [
    {
      "name": "Rename Symbol",
      "command": "tug apply python rename --at ${file}:${line}:${column} --to ${input:newName}"
    },
    {
      "name": "Analyze Rename Impact",
      "command": "tug analyze python rename --at ${file}:${line}:${column} --to ${input:newName}"
    }
  ]
}
```

---

## Common Recipes

### Rename a Function

```bash
# Step 1: Find the function definition
grep -rn "def process_data" src/

# Step 2: Analyze impact
tug analyze python rename --at src/utils.py:42:5 --to transform_data

# Step 3: Review the output (check all references)
# The JSON output shows:
# - symbol: { name: "process_data", kind: "function", ... }
# - references: [ { location: {...}, kind: "call" }, ... ]
# - impact: { files_affected: 2, references_count: 4 }

# Step 4: Apply the rename
tug apply python rename --at src/utils.py:42:5 --to transform_data
```

### Rename a Class

```bash
# Step 1: Find the class definition
grep -rn "class DataProcessor" src/

# Step 2: Analyze impact
tug analyze python rename --at src/processors.py:10:7 --to DataTransformer

# Step 3: Apply (updates constructor calls and type hints too)
tug apply python rename --at src/processors.py:10:7 --to DataTransformer
```

### Multi-File Refactoring

Tug automatically handles cross-file renames:

```bash
# Analyze shows all affected files
tug analyze python rename --at src/utils.py:10:5 --to new_name

# Example output:
# {
#   "impact": {
#     "files_affected": 3,
#     "references_count": 7
#   },
#   "references": [
#     { "location": { "file": "src/utils.py", ... }, "kind": "definition" },
#     { "location": { "file": "src/main.py", ... }, "kind": "import" },
#     { "location": { "file": "src/main.py", ... }, "kind": "call" },
#     { "location": { "file": "tests/test_utils.py", ... }, "kind": "import" },
#     ...
#   ]
# }

# Apply updates all files atomically
tug apply python rename --at src/utils.py:10:5 --to new_name
```

### Verification Options

```bash
# Fast: Syntax check only (default)
tug apply python rename --at file.py:10:5 --to bar

# Thorough: Run tests after rename
tug apply python rename --at file.py:10:5 --to bar --verify tests

# Type-safe: Type check after rename
tug apply python rename --at file.py:10:5 --to bar --verify typecheck

# Skip verification (use with caution)
tug apply python rename --at file.py:10:5 --to bar --no-verify
```

### Filter Recipes

```bash
# Source files only (exclude tests)
tug apply python rename ... --filter "path:src/**" -- '!tests/**'

# Only modified files (useful for incremental refactoring)
tug apply python rename ... --filter "git_status:modified"

# Only tracked files (skip untracked/generated)
tug apply python rename ... --filter "git_tracked:true"

# Files with TODOs (requires --filter-content)
tug apply python rename ... --filter "contains:TODO" --filter-content

# Recently modified files
tug apply python rename ... --filter "mtime>2024-01-01"
```

### Fresh Session

If you encounter issues, start a fresh session:

```bash
tug --fresh analyze python rename --at file.py:10:5 --to bar
```
