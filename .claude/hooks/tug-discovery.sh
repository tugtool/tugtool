#!/bin/bash
# tug-discovery.sh - Lightweight hook for tug discovery
#
# This hook checks user prompts for refactoring-related keywords and
# outputs a brief reminder if detected. It never blocks (always exits 0).

# Read the JSON input from stdin
INPUT=$(cat)

# Extract the user prompt from the JSON
# The format is: {"session_id": "...", "prompt": "..."}
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)

# If we couldn't extract the prompt, exit silently
if [ -z "$PROMPT" ]; then
    exit 0
fi

# Check for refactoring-related patterns (case-insensitive)
if echo "$PROMPT" | grep -qi -E \
    'rename[[:space:]]+(the[[:space:]]+)?(function|class|method|variable|symbol)|rename[[:space:]]+[a-zA-Z_]+[[:space:]]+to[[:space:]]|change[[:space:]]+(the[[:space:]]+)?name[[:space:]]+of|refactor.*(name|rename)|update[[:space:]]+all[[:space:]]+references'; then

    # Output a brief reminder (this becomes part of Claude's context)
    echo "[tug hint] For symbol renames across multiple files, consider using /tug-rename for verified, scope-aware refactoring."
fi

# Always exit 0 - never block the user's prompt
exit 0
