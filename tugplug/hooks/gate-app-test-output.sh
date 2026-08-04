#!/bin/bash
# Deny piping a `just app-test*` run into a text filter.
#
# The recipe already renders a report: a per-file result table, a `Diagnostics:`
# section, a `Failures:` section carrying each failure's message and location,
# and a closing `VERDICT:` line. A green one-file run is about twenty lines.
# There is nothing to extract that the summary has not already extracted.
#
# The pipe is not merely redundant. It replaces the recipe's exit code with the
# filter's, so `just app-test X | grep -A 8 "Failures:"` on a passing run prints
# nothing and exits 1 — a green run reported as a silent failure. A fixed `-A N`
# also truncates the second failure and drops `Diagnostics:` entirely.
#
# Machine-readable output has its own channel: TUG_APPTEST_JSON=<path> writes a
# document serialized from the same arrays the summary renders.
#
# Anything unexpected — no jq — exits 0 and falls through to the normal
# permission flow: a broken gate must never block work.

INPUT=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" = "Bash" ] || exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
[ -n "$CMD" ] || exit 0

# Only the recipes that print the summary. `app-test-select` and
# `app-test-covers-check` emit plain lists and are legitimately filtered.
printf '%s' "$CMD" | grep -Eq \
    '(^|[^-[:alnum:]_/])just([[:space:]]+--[[:alnum:]-]+)*[[:space:]]+app-test(-changed|-all)?([[:space:]]|$)' \
    || exit 0

# `tee` and `cat` pass the report through intact; a filter does not.
printf '%s' "$CMD" | grep -Eq \
    '\|[[:space:]]*(/usr/bin/|/bin/)?(grep|egrep|fgrep|rg|ag|head|tail|sed|awk|cut|wc|sort|uniq)([[:space:]]|$)' \
    || exit 0

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "Run the app-test command on its own, with no pipe. The recipe already prints the report — per-file results, Diagnostics, a Failures section with each failure'"'"'s message and location, and a closing VERDICT line — and a green one-file run is about twenty lines. Piping it into a filter also replaces the recipe'"'"'s exit code with the filter'"'"'s, so a passing run comes back empty and non-zero. If you want a machine-readable result instead of the text report, set TUG_APPTEST_JSON=<path> and read that file afterwards."
  }
}'
