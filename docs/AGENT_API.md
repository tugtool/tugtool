# Agent API Reference

This document describes the tug CLI interface for AI coding agents.

## Overview

Tug is a refactoring tool for AI coding agents. It provides verified, deterministic, minimal-diff refactors. Unlike simple find-and-replace, tug understands code semantics: it parses your code, builds a symbol graph, and ensures that all references to a symbol are updated correctly.

Structured output is JSON for easy parsing by LLM agents, with one exception: `emit` defaults to a unified diff (and can optionally wrap the diff in JSON). Every operation goes through a verification pipeline that catches syntax errors before changes are applied, ensuring that the codebase remains valid after refactoring. The tool uses a sandbox-first approach: changes are generated and verified in an isolated copy before being applied to the actual workspace.

The key design principle is "analyze, review, apply": agents first analyze the impact of a change, review the proposed edits, and only then apply them. This workflow prevents accidental breakage and gives agents full visibility into what will change before any files are modified.

## Quick Start

The basic workflow for a rename operation:

```bash
# 1. Analyze impact - see what will change (read-only)
tug analyze-impact rename-symbol --at src/utils.py:42:5 --to transform_data

# 2. Review the output - check references and impact
# The JSON output shows all files and locations that will be modified

# 3. Execute the refactor with verification
tug run --apply --verify syntax rename-symbol --at src/utils.py:42:5 --to transform_data
```

## CLI Reference

### Global Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--workspace <path>` | Workspace root directory | Current directory |
| `--session-dir <path>` | Session directory path | `.tug/` in workspace |
| `--session-name <name>` | Named session | `default` |
| `--fresh` | Delete existing session and start fresh | `false` |
| `--log-level <level>` | Log level (trace, debug, info, warn, error) | `warn` |
| `--toolchain <lang>=<path>` | Explicit toolchain path override | Auto-detect |

### Filter Flags

These flags are available on refactoring commands (`apply`, `emit`, `analyze`) to restrict scope:

| Flag | Type | Description |
|------|------|-------------|
| `--filter <expr>` | Repeatable | Expression filter (multiple are AND'd together) |
| `--filter-json <json>` | Single | JSON filter schema for complex filters |
| `--filter-file <path>` | Single | File containing filter definitions |
| `--filter-file-format <fmt>` | Single | Format for `--filter-file`: `json`, `glob`, or `expr` |
| `--filter-content` | Flag | Enable content predicates (`contains`, `regex`) |
| `--filter-content-max-bytes <n>` | Single | Max file size for content predicates |
| `--filter-list` | Flag | Output matched files as JSON and exit (no refactor) |
| `-- <patterns...>` | Positional | Glob patterns (placed at end of command) |

### Subcommands

| Subcommand | Description | Example |
|------------|-------------|---------|
| `snapshot` | Create workspace snapshot | `tug snapshot` |
| `analyze-impact` | Analyze refactoring impact | `tug analyze-impact rename-symbol --at file:1:5 --to bar` |
| `run` | Execute refactoring operation | `tug run --apply rename-symbol --at file:1:5 --to bar` |
| `session status` | Show session status | `tug session status` |
| `verify` | Run verification on workspace | `tug verify syntax` |
| `clean` | Clean session resources | `tug clean --workers --cache` |
| `toolchain <lang> setup` | Set up language toolchain | `tug toolchain python setup` |
| `toolchain <lang> info` | Show toolchain configuration | `tug toolchain python info` |
| `toolchain <lang> check` | Verify toolchain is valid | `tug toolchain python check` |

### File Filtering

Tug provides a powerful filtering system to restrict which files are included in refactoring operations.

#### Expression Filters

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
| `contains` | Content substring | `contains:"TODO"` |
| `regex` | Content regex | `regex:TODO` |
| `git_status` | Git status | `git_status:modified` |
| `git_tracked` | Tracked by git | `git_tracked:true` |
| `git_ignored` | Ignored by git | `git_ignored:true` |
| `git_stage` | Staging state | `git_stage:staged` |

**Operators:** `:` (glob/eq), `~` (regex), `=`, `!=`, `>`, `>=`, `<`, `<=`

**Combinators:** `and`, `or`, `not`, `(...)`

**Precedence:** `not` > `and` > `or`

#### JSON Filters

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

#### Glob Patterns

Glob patterns appear after `--` at the end of the command:

```bash
# Include only src/ files
tug apply python rename --at f.py:1:5 --to bar -- 'src/**/*.py'

# Exclude tests
tug apply python rename --at f.py:1:5 --to bar -- '!tests/**'
```

#### Content Predicates

The `contains` and `regex` predicates require `--filter-content`:

```bash
tug apply python rename --at f.py:1:5 --to bar --filter "contains:TODO" --filter-content
```

Use `--filter-content-max-bytes <n>` to skip large files (default: 5MB when enabled).

#### Filter Introspection

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

#### Filter Combination Order

Filters are combined with AND in this order:
1. Language-appropriate files (`**/*.py` for Python)
2. Default exclusions (`.git`, `__pycache__`, `venv`, etc.)
3. Glob patterns (`-- <patterns...>`)
4. Expression filters (`--filter`)
5. JSON filter (`--filter-json`)
6. Filter file content (`--filter-file`)

### Refactoring Operations

#### `analyze-impact rename-symbol`

Analyze the impact of renaming a symbol without making changes.

```bash
tug analyze-impact rename-symbol --at <file:line:col> --to <new_name>
```

**Arguments:**
- `--at <file:line:col>` - Location of the symbol (1-indexed line and column)
- `--to <new_name>` - New name for the symbol

**Output:** `AnalyzeImpactResponse` with symbol info, references, and impact summary.

#### `run rename-symbol`

Execute a rename operation with optional verification and apply.

```bash
tug run [--apply] [--verify <mode>] rename-symbol --at <file:line:col> --to <new_name>
```

**Arguments:**
- `--apply` - Apply changes to files (default: dry-run)
- `--verify <mode>` - Verification mode: `none`, `syntax`, `tests`, `typecheck` (default: `syntax`)
- `--at <file:line:col>` - Location of the symbol
- `--to <new_name>` - New name for the symbol

**Output:** `RunResponse` with patch, verification result, and summary.

## JSON Output Schema

All CLI output follows the JSON output schema. Key principles:

1. **Structured JSON** - All structured output is valid JSON; `emit` may output plain unified diff by default
2. **Status first** - Every response has `status` as the first field
3. **Deterministic** - Same input produces same output
4. **Versioned** - `schema_version` enables forward compatibility

### Common Types

#### Location

```json
{
  "file": "src/utils.py",
  "line": 42,
  "col": 8,
  "byte_start": 1234,
  "byte_end": 1245
}
```

#### Symbol

```json
{
  "id": "sym_abc123",
  "name": "process_data",
  "kind": "function",
  "location": { ... }
}
```

Symbol kinds: `function`, `class`, `method`, `variable`, `parameter`, `module`, `import`

#### Reference

```json
{
  "location": { ... },
  "kind": "call"
}
```

Reference kinds: `definition`, `call`, `reference`, `import`, `attribute`

### Response Envelope

Every response follows this envelope:

```json
{
  "status": "ok",
  "schema_version": "1",
  "snapshot_id": "snap_abc123",
  ...
}
```

Or for errors:

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
| `SnapshotMismatch` | Files changed since analysis | Re-run analyze-impact |
| `AnchorMismatch` | Edit anchor doesn't match | File was modified |
| `WriteError` | Failed to write file | Check permissions |

### Verification Errors (Exit Code 5)

| Code | Meaning | Details |
|------|---------|---------|
| `SyntaxError` | Code has syntax errors | Review changes |
| `TestsFailed` | Tests failed after changes | Fix tests or revert |
| `TypecheckFailed` | Type checker found errors | Fix type errors |

## Exit Codes

Exit codes match error codes for shell scripting:

```bash
tug analyze-impact rename-symbol --at file.py:1:1 --to bar
exit_code=$?

case $exit_code in
  0) echo "Success" ;;
  2) echo "Invalid arguments" ;;
  3) echo "Symbol not found" ;;
  4) echo "Apply failed" ;;
  5) echo "Verification failed" ;;
  10) echo "Internal error" ;;
esac
```

## Agent Contract

Agents can expect the following guarantees from tug:

### Prerequisites

- `tug` binary in PATH
- Running in project root directory
- Python environment activated (for Python refactors)

### Workflow

1. `analyze-impact` - See what will change (read-only, fast)
2. `run` - Generate patches and verify (read-only unless `--apply`)
3. `run --apply` - Verify then write to filesystem

### Output Format

- All commands output JSON to stdout
- Tracing/debug output goes to stderr
- Exit codes match Table T26 (see Error Codes above)

### When NOT to Use tug

Tug may not be appropriate for:

- Refactoring code in external packages (you can't edit them)
- Dynamic code patterns (`getattr`, `eval`, etc.) - the tool will warn
- Simple string replacement - just use `sed` or find-and-replace

