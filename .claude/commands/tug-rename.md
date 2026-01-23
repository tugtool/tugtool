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
