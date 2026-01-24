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

The default format is unified diff (compatible with `git apply`):

```bash
tug analyze rename --at <file:line:col> --to <new_name>
```

For a brief text summary:

```bash
tug analyze rename --at <file:line:col> --to <new_name> --format summary
```

For full JSON output:

```bash
tug analyze rename --at <file:line:col> --to <new_name> --format json
```

Show:
- Files that would change
- Number of edits
- The unified diff showing all changes

## What This Command Does NOT Do

- Does NOT apply any changes
- Does NOT modify any files
- Does NOT require approval (nothing to approve)

If you want to apply the changes, use `/tug-rename` instead.

## Error Handling

Same as `/tug-rename` - show errors and stop.
