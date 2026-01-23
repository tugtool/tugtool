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
