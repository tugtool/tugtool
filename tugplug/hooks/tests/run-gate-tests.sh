#!/bin/bash
# Feed every case in gate-app-test-output.cases through the gate and compare the
# decision (and, for a rewrite, the exact command) against the expectation.
#
# The cases file writes the recipe name as `AT` and this expands it, so that
# neither the cases nor this runner is itself a command line the gate would have
# an opinion about.

set -u

HERE=$(cd "$(dirname "$0")" && pwd)
GATE=$HERE/../gate-app-test-output.sh
CASES=$HERE/gate-app-test-output.cases
RECIPE=app-$(printf 'test')

pass=0
fail=0

while IFS=$'\t' read -r expected cmd want; do
    case ${expected:-} in '' | '#'*) continue ;; esac
    cmd=${cmd//AT/$RECIPE}
    want=${want//AT/$RECIPE}

    out=$(jq -n --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' | bash "$GATE")
    if [ -z "$out" ]; then
        got=pass
        gotcmd=""
    else
        got=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision')
        gotcmd=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.updatedInput.command // ""')
    fi

    if [ "$got" != "$expected" ]; then
        printf 'FAIL  %s\n      expected %s, got %s\n' "$cmd" "$expected" "$got"
        fail=$((fail + 1))
    elif [ "$expected" = allow ] && [ "$gotcmd" != "$want" ]; then
        printf 'FAIL  %s\n      expected rewrite: %s\n      got rewrite:      %s\n' "$cmd" "$want" "$gotcmd"
        fail=$((fail + 1))
    else
        pass=$((pass + 1))
    fi
done < "$CASES"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
