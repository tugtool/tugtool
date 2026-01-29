# /tug-analyze-rename

Analyze and preview a rename without applying changes.

## Purpose

This command shows what a rename would do without making any changes. Use this for:
- Reviewing impact before deciding to rename
- Understanding scope of a refactor
- Cautious workflows where you want to review before committing to changes

## Workflow

1. Determine the location from current file and cursor position
2. Ask for the new name if not provided
3. Run analyze and show the preview
4. **Stop here** - do not apply

### Analyze and Preview

The default output is full impact analysis JSON:

```bash
tug analyze python rename --at <file:line:col> --to <new_name>
```

For just the references:

```bash
tug analyze python rename --at <file:line:col> --to <new_name> --output references
```

For just the symbol info:

```bash
tug analyze python rename --at <file:line:col> --to <new_name> --output symbol
```

Show:
- Symbol being renamed (name, kind, location)
- Files that would change
- Number of references
- All reference locations

## What This Command Does NOT Do

- Does NOT apply any changes
- Does NOT modify any files
- Does NOT require approval (nothing to approve)

If you want to apply the changes, use `/tug-apply-rename` instead.
If you want to see the actual diff, use `/tug-emit-rename`.

## Error Handling

Same as `/tug-apply-rename` - show errors and stop.

## Example

User: "How many places use the process_data function?"

1. Get location (e.g., `src/utils.py:42:5`)
2. Run `tug analyze python rename --at src/utils.py:42:5 --to transform_data`
3. Show: "Symbol 'process_data' (function) has 4 references across 2 files"
