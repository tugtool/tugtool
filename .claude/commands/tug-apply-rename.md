# /tug-apply-rename

Rename a symbol using tug with full verification workflow.

## Workflow

This command performs a safe rename operation with two decision gates:

1. **Preview** - Analyze and show what changes will be made
2. **Apply** - Write changes after explicit approval

## Usage

When the user wants to rename a symbol:

1. Determine the location from current file and cursor position as `<file>:<line>:<col>` (1-indexed)
2. Ask for the new name if not provided

### Step 1: Preview Changes

```bash
tug analyze python rename --at <file:line:col> --to <new_name>
```

Show the impact summary to the user. The JSON output includes:
- `symbol`: The symbol being renamed (name, kind, location)
- `references`: All references that will be updated
- `impact`: Summary with `files_affected` and `references_count`

If you need a diff preview:

```bash
tug emit python rename --at <file:line:col> --to <new_name>
```

Check:
- If no changes needed: Stop and inform user "No references found at this location. Please position cursor on the symbol definition or a reference."
- If large refactor (many files): Warn user and ask for explicit confirmation before proceeding.

### Step 2: Apply (with approval)

Show the summary and ask: "Apply these changes? (yes/no)"

Only if user approves:

```bash
tug apply python rename --at <file:line:col> --to <new_name>
```

This applies the changes with syntax verification by default (`--verify=syntax`).

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
2. Run `tug analyze python rename --at src/utils.py:42:5 --to transform_data`
3. Show: "Would rename 'process_data': 2 file(s), 4 reference(s)"
4. Ask: "Apply these changes?"
5. If yes: Run `tug apply python rename --at src/utils.py:42:5 --to transform_data`
6. Report success
