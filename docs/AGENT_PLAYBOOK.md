# Agent Playbook

This playbook provides ready-to-use snippets and patterns for integrating tug into AI coding agents.

## Copy-Paste Snippets

The following snippets can be pasted directly into agent prompts or tool definitions.

### Rename a Variable

```bash
# Step 1: Find the variable definition
grep -rn "my_variable = " src/

# Step 2: Analyze impact
tug analyze-impact rename-symbol --at src/utils.py:15:1 --to better_name

# Step 3: Apply the rename
tug run --apply --verify syntax rename-symbol --at src/utils.py:15:1 --to better_name
```

### Rename a Function

```bash
# Step 1: Find the function definition
grep -rn "def process_data" src/

# Step 2: Analyze impact
tug analyze-impact rename-symbol --at src/utils.py:42:5 --to transform_data

# Step 3: Review the output (check all references)
# The JSON output shows:
# - symbol: { name: "process_data", kind: "function", ... }
# - references: [ { location: {...}, kind: "call" }, ... ]
# - impact: { files_affected: 2, references_count: 4 }

# Step 4: Apply the rename
tug run --apply --verify syntax rename-symbol --at src/utils.py:42:5 --to transform_data
```

### Rename a Class

```bash
# Step 1: Find the class definition
grep -rn "class DataProcessor" src/

# Step 2: Analyze impact
tug analyze-impact rename-symbol --at src/processors.py:10:7 --to DataTransformer

# Step 3: Apply (note: this will update constructor calls and type hints too)
tug run --apply --verify syntax rename-symbol --at src/processors.py:10:7 --to DataTransformer
```

### Rename a Method

```bash
# Step 1: Find the method definition
grep -rn "def calculate_total" src/

# Step 2: Analyze impact (use the method's line:col)
tug analyze-impact rename-symbol --at src/cart.py:25:9 --to compute_total

# Step 3: Apply the rename
tug run --apply --verify syntax rename-symbol --at src/cart.py:25:9 --to compute_total
```

## Error Handling Patterns

### Handle Each Error Code

```bash
tug run --apply rename-symbol --at file.py:1:5 --to new_name
exit_code=$?

case $exit_code in
  0)
    echo "Rename successful"
    ;;
  2)
    echo "Invalid arguments - check location format (file:line:col)"
    # Retry with corrected arguments
    ;;
  3)
    echo "Symbol not found - verify the location is correct"
    # Re-search for the symbol definition
    grep -rn "def old_name" src/
    ;;
  4)
    echo "Apply failed - files may have changed since analysis"
    # Re-run analyze-impact and try again
    tug analyze-impact rename-symbol --at file.py:1:5 --to new_name
    ;;
  5)
    echo "Verification failed - syntax errors in result"
    # Review the changes and fix manually
    ;;
  10)
    echo "Internal error - report to maintainers"
    ;;
esac
```

### Parse JSON Errors

```bash
output=$(tug analyze-impact rename-symbol --at file.py:1:5 --to bar 2>&1)
status=$(echo "$output" | jq -r '.status')

if [ "$status" = "error" ]; then
  error_code=$(echo "$output" | jq -r '.error.code')
  error_message=$(echo "$output" | jq -r '.error.message')
  echo "Error ($error_code): $error_message"
fi
```

## Claude Code Integration

Claude Code provides built-in slash commands for tug integration.

### Available Commands

- `/tug-rename` - Full rename workflow: analyze impact, dry-run preview, and apply with approval
- `/tug-rename-plan` - Preview only: analyze and dry-run without applying changes

### Using the Commands

When the user requests a symbol rename:

1. **Identify the location**: Determine file, line, and column of the symbol
2. **Run `/tug-rename`**: The command handles the full workflow:
   - Analyzes impact and shows affected files/references
   - Runs dry-run with syntax verification
   - Asks for approval before applying changes

For cautious workflows, use `/tug-rename-plan` to preview without any risk of modification.

### Skill-Based Discovery

The `tug-refactor` skill (`.claude/skills/tug-refactor/SKILL.md`) enables proactive tug suggestions when Claude detects refactoring-related requests like:
- "rename X to Y"
- "change the name of"
- "update all references"

### Agent Instructions Snippet

Add this to your Claude Code custom instructions or CLAUDE.md:

```markdown
When renaming Python symbols, use the tug CLI:

1. First analyze impact with `tug analyze-impact` to see all affected files
2. Review the references list to confirm the rename is safe
3. Execute with `tug run --apply --verify syntax` to apply changes

This ensures all references are updated atomically and the result is syntactically valid.
```

## Cursor Integration

Cursor can use tug through its AI rules system and CLI integration.

### Cursor Rules (Recommended)

The `.cursor/rules/tug.mdc` file provides Cursor AI with context about when and how to use tug. This enables Cursor to automatically suggest tug for refactoring requests.

Key features:
- Recognition patterns for refactoring requests
- Decision guidance (when to use vs. skip tug)
- Workflow rules for safe refactoring
- Error handling guidance

### CLI via Tasks

You can also integrate tug via custom tasks in Cursor.

Add to `.cursor/tasks.json`:

```json
{
  "tasks": [
    {
      "name": "Rename Symbol",
      "command": "tug run --apply --verify syntax rename-symbol --at ${file}:${line}:${column} --to ${input:newName}"
    },
    {
      "name": "Analyze Rename Impact",
      "command": "tug analyze-impact rename-symbol --at ${file}:${line}:${column} --to ${input:newName}"
    }
  ]
}
```

### Shell Integration

Use the CLI directly in Cursor's terminal:

```bash
# Analyze impact first
tug analyze-impact rename-symbol --at src/main.py:10:5 --to better_name

# Apply with verification
tug run --apply --verify syntax rename-symbol --at src/main.py:10:5 --to better_name
```

## Common Patterns

### Preview Before Apply

Always analyze before applying:

```bash
# Step 1: Analyze (read-only)
tug analyze-impact rename-symbol --at file.py:10:5 --to new_name | jq .

# Step 2: Review impact
# - Check files_affected count
# - Review references list
# - Look for warnings (dynamic references, etc.)

# Step 3: Apply only if satisfied
tug run --apply --verify syntax rename-symbol --at file.py:10:5 --to new_name
```

### Verification Workflow

Choose the appropriate verification level:

```bash
# Fast: Syntax check only (default)
tug run --apply --verify syntax rename-symbol --at file.py:10:5 --to bar

# Thorough: Run tests after rename
tug run --apply --verify tests rename-symbol --at file.py:10:5 --to bar

# Type-safe: Type check after rename
tug run --apply --verify typecheck rename-symbol --at file.py:10:5 --to bar

# Skip verification (dangerous - only for known-safe operations)
tug run --apply --verify none rename-symbol --at file.py:10:5 --to bar
```

### Multi-File Refactoring

Tug automatically handles cross-file renames:

```bash
# Analyze shows all affected files
tug analyze-impact rename-symbol --at src/utils.py:10:5 --to new_name

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
tug run --apply rename-symbol --at src/utils.py:10:5 --to new_name
```

### Fresh Session

If you encounter issues, start a fresh session:

```bash
tug --fresh analyze-impact rename-symbol --at file.py:10:5 --to bar
```

### Toolchain Setup

First-time setup for Python:

```bash
# Check if toolchain is valid
tug toolchain python check

# If not, set up managed environment
tug toolchain python setup

# Verify setup
tug toolchain python info
```

## When NOT to Use tug

Tug is not the right tool for:

- **External packages** - You can't edit code in site-packages or node_modules
- **Dynamic code patterns** - `getattr()`, `eval()`, `exec()` can't be statically analyzed. Tug will warn about these but may miss references.
- **Simple string replacement** - If you're just replacing a string literal (not a symbol), use `sed` or your editor's find-and-replace
- **Non-Python files** - Currently only Python is supported. Rust support is planned.

When in doubt, use `analyze-impact` first to see what tug can find. If references are missing, you may need to handle those manually.
