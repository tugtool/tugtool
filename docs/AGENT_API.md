# Agent API Reference

This document describes the tug CLI interface for AI coding agents.

## Overview

Tug is a refactoring tool for AI coding agents. It provides verified, deterministic, minimal-diff refactors. Unlike simple find-and-replace, tug understands code semantics: it parses your code, builds a symbol graph, and ensures that all references to a symbol are updated correctly.

All output is structured JSON for easy parsing by LLM agents. Every operation goes through a verification pipeline that catches syntax errors before changes are applied, ensuring that the codebase remains valid after refactoring. The tool uses a sandbox-first approach: changes are generated and verified in an isolated copy before being applied to the actual workspace.

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

1. **Always JSON** - All output is valid JSON (no mixed text/JSON)
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

