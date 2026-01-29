# /tug-emit-rename

Generate a unified diff for a rename without applying changes.

## Purpose

This command outputs a diff showing what a rename would do. Use this for:
- Reviewing exact line-by-line changes before applying
- Generating patches to apply elsewhere
- Integration with diff viewers or code review tools

## Workflow

1. Determine the location from current file and cursor position
2. Ask for the new name if not provided
3. Run emit and show the diff

### Generate Diff

The default output is a unified diff (compatible with `git apply`):

```bash
tug emit python rename --at <file:line:col> --to <new_name>
```

For JSON envelope with metadata:

```bash
tug emit python rename --at <file:line:col> --to <new_name> --json
```

The JSON envelope includes:
- `format`: Always `"unified"`
- `diff`: The unified diff content
- `files_affected`: List of files that would be modified
- `metadata`: Reserved for future use

Show the diff to the user.

## What This Command Does NOT Do

- Does NOT apply any changes
- Does NOT modify any files
- Does NOT require approval (nothing to approve)

If you want to apply the changes, use `/tug-apply-rename` instead.

## Error Handling

Same as `/tug-apply-rename` - show errors and stop.

## Example

User: "Show me what renaming process_data would look like"

1. Get location (e.g., `src/utils.py:42:5`)
2. Run `tug emit python rename --at src/utils.py:42:5 --to transform_data`
3. Display the unified diff showing all changes
