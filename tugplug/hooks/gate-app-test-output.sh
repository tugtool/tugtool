#!/bin/bash
# Strip the filter off a piped `just app-test*` run, or deny it if it cannot be
# stripped cleanly.
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
# Denying it costs a round trip every time the reflex fires. When the command is
# a plain pipeline — one app-test invocation feeding one or more filters, nothing
# else — the pipe can just be removed and the bare run allowed through, which is
# what the author wanted in the first place. Anything more tangled (a `&&` chain,
# a subshell, a redirect into a file) is not safe to rewrite, so it still gets
# the deny and its explanation.
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
FILTER='(/usr/bin/|/bin/)?(grep|egrep|fgrep|rg|ag|head|tail|sed|awk|cut|wc|sort|uniq|tr)'
printf '%s' "$CMD" | grep -Eq "\\|[[:space:]]*${FILTER}([[:space:]]|$)" || exit 0

# Is the whole command one app-test invocation feeding filters and nothing else?
# `2>&1` is the one shell metacharacter allowed through, so it is removed before
# the shape is matched; the rewrite keeps it, since it only redirects a stream
# the summary already merges.
PROBE=${CMD//2>&1/}
ARG='[^|;&`$()<>]*'
SHAPE="^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]|]*[[:space:]]+)*"
SHAPE="${SHAPE}just([[:space:]]+--[[:alnum:]-]+)*[[:space:]]+app-test(-changed|-all)?${ARG}"
SHAPE="${SHAPE}(\\|[[:space:]]*${FILTER}${ARG})+[[:space:]]*\$"

if printf '%s' "$PROBE" | grep -Eq "$SHAPE"; then
    # Everything from the first pipe on is the filter chain; drop it.
    BARE=${CMD%%|*}
    BARE=${BARE%"${BARE##*[![:space:]]}"}
    REASON="Removed the output filter and ran the app-test command bare. The recipe already prints a finished report (per-file results, Diagnostics, a Failures section with each failure message and its location, and a closing VERDICT line), and the pipe would have replaced the exit code of the recipe with the exit code of the filter. Run it bare next time; for a machine-readable result set TUG_APPTEST_JSON=<path> and read that file afterwards."
    jq -n --arg cmd "$BARE" --arg reason "$REASON" --argjson input "$INPUT" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: $reason,
        updatedInput: ($input.tool_input + {command: $cmd})
      }
    }'
    exit 0
fi

jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "Run the app-test command on its own, with no pipe. The recipe already prints the report — per-file results, Diagnostics, a Failures section with each failure'"'"'s message and location, and a closing VERDICT line — and a green one-file run is about twenty lines. Piping it into a filter also replaces the recipe'"'"'s exit code with the filter'"'"'s, so a passing run comes back empty and non-zero. If you want a machine-readable result instead of the text report, set TUG_APPTEST_JSON=<path> and read that file afterwards."
  }
}'
