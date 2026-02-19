#!/usr/bin/env bash
# Integration tests for the deterministic fake `bd` binary.
# Exercises the Beads JSON contract and sync/status/pull-like workflows without real Beads.
# Run from repo root: TUG_BD_STATE=<tmp> tests/integration/bd-fake-tests.sh
# Or: cd tests/integration && ./bd-fake-tests.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BD_FAKE="${REPO_ROOT}/tests/bin/bd-fake"

# Use temp state dir so tests are isolated and reproducible
export TUG_BD_STATE="${TUG_BD_STATE:-$(mktemp -d "${TMPDIR:-/tmp}/tug-bd-fake-state.XXXXXX")}"

need_jq() {
  if ! command -v jq &>/dev/null; then
    echo "Integration tests require jq" >&2
    exit 1
  fi
}

bd() {
  "$BD_FAKE" "$@"
}

# Reset state between test groups that need a clean slate (optional: some tests share state on purpose)
reset_state() {
  rm -f "$TUG_BD_STATE/issues.json" "$TUG_BD_STATE/deps.json"
  bd init >/dev/null
}

# Normalize bd show output: contract allows array or single object; return single object for assertions
normalize_show() {
  jq 'if type == "array" then .[0] else . end'
}

run_test() {
  local name="$1"
  echo -n "  $name ... "
  if ( "$@" ); then
    echo "ok"
  else
    echo "FAIL"
    return 1
  fi
}

# --- Contract tests ---
test_create_returns_issue() {
  reset_state
  local out
  out=$(bd create --json "Test issue")
  echo "$out" | jq -e '.id and .title and .status and (.priority | type == "number") and .issue_type' >/dev/null
  [[ $(echo "$out" | jq -r .title) == "Test issue" ]]
  [[ $(echo "$out" | jq -r .status) == "open" ]]
}

test_show_returns_details_with_dependencies() {
  reset_state
  local id
  id=$(bd create --json "Show me" | jq -r .id)
  local out
  out=$(bd show "$id" | normalize_show)
  echo "$out" | jq -e '.id and .title and .status and .dependencies | type == "array"' >/dev/null
  [[ $(echo "$out" | jq -r .id) == "$id" ]]
  [[ $(echo "$out" | jq -r '.dependencies | length') -eq 0 ]]
}

test_show_array_compatible() {
  # Tug must accept both array and single object; simulate array response
  reset_state
  local id
  id=$(bd create --json "Array test" | jq -r .id)
  local single
  single=$(bd show "$id")
  local as_array
  as_array=$(echo "$single" | jq -c '[.]')
  local first
  first=$(echo "$as_array" | jq '.[0]')
  [[ $(echo "$first" | jq -r .id) == "$id" ]]
  echo "$first" | jq -e '.dependencies | type == "array"' >/dev/null
}

test_dep_add_and_list_contract() {
  reset_state
  local a b
  a=$(bd create --json "Issue A" | jq -r .id)
  b=$(bd create --json "Issue B" | jq -r .id)
  bd dep add "$a" "$b" --json >/dev/null
  local list
  list=$(bd dep list "$a" --json 2>/dev/null || bd dep list "$a")
  [[ $(echo "$list" | jq 'length') -ge 1 ]]
  echo "$list" | jq -e '.[0] | .id and .dependency_type' >/dev/null
  [[ $(echo "$list" | jq -r '.[0].id') == "$b" ]]
}

# --- Sync-like workflow: root + step beads + dependency edges ---
test_sync_like_creates_root_and_step_beads() {
  reset_state
  local root s1 s2 s3
  root=$(bd create --json --type epic "Phase 1" | jq -r .id)
  s1=$(bd create --json --parent "$root" "Step 1" | jq -r .id)
  s2=$(bd create --json --parent "$root" "Step 2" | jq -r .id)
  s3=$(bd create --json --parent "$root" "Step 3" | jq -r .id)
  # IDs are hierarchical
  [[ "$root" == bd-fake-* && "$root" != *.* ]]
  [[ "$s1" == "${root}.1" ]]
  [[ "$s2" == "${root}.2" ]]
  [[ "$s3" == "${root}.3" ]]
}

test_sync_like_dependency_edges_match_depends_on() {
  reset_state
  local root s1 s2 s3
  root=$(bd create --json --type epic "Phase 1" | jq -r .id)
  s1=$(bd create --json --parent "$root" "Step 1" | jq -r .id)
  s2=$(bd create --json --parent "$root" "Step 2" | jq -r .id)
  s3=$(bd create --json --parent "$root" "Step 3" | jq -r .id)
  # Depends on: s2 -> s1, s3 -> s2
  bd dep add "$s2" "$s1" --json >/dev/null
  bd dep add "$s3" "$s2" --json >/dev/null
  local list2 list3
  list2=$(bd dep list "$s2")
  list3=$(bd dep list "$s3")
  [[ $(echo "$list2" | jq -r '.[0].id') == "$s1" ]]
  [[ $(echo "$list3" | jq -r '.[0].id') == "$s2" ]]
}

test_deterministic_ids_on_fresh_state() {
  reset_state
  local r1 r2 c1 c2
  r1=$(bd create --json "Root" | jq -r .id)
  c1=$(bd create --json --parent "$r1" "Child" | jq -r .id)
  r2=$(bd create --json "Root2" | jq -r .id)
  c2=$(bd create --json --parent "$r2" "Child2" | jq -r .id)
  [[ "$r1" == "bd-fake-1" ]]
  [[ "$c1" == "bd-fake-1.1" ]]
  [[ "$r2" == "bd-fake-2" ]]
  [[ "$c2" == "bd-fake-2.1" ]]
}

# --- Status: bd show returns status so readiness can be computed ---
test_status_readiness_from_show() {
  reset_state
  local id
  id=$(bd create --json "Status issue" | jq -r .id)
  local out
  out=$(bd show "$id" | normalize_show)
  [[ $(echo "$out" | jq -r .status) == "open" ]]
  echo "$out" | jq -e '.status' >/dev/null
}

# --- Pull: bd show provides status for checkbox mapping ---
test_pull_data_status_field() {
  reset_state
  local id
  id=$(bd create --json "Pull issue" | jq -r .id)
  local out
  out=$(bd show "$id" | normalize_show)
  # Consumer (tug beads pull) maps status "closed" -> checkbox checked
  echo "$out" | jq -e '.status | type == "string"' >/dev/null
  [[ $(echo "$out" | jq -r .status) == "open" ]]
}

# --- Convergent behavior: re-running same creates in same state; dep list is authoritative ---
test_dep_list_authoritative_for_reconciliation() {
  reset_state
  local a b
  a=$(bd create --json "A" | jq -r .id)
  b=$(bd create --json "B" | jq -r .id)
  bd dep add "$a" "$b" --json >/dev/null
  local list
  list=$(bd dep list "$a")
  # Spec S06: sync uses bd dep list for direct-dependency reconciliation
  echo "$list" | jq -e 'map(select(.id == "'"$b"'")) | length == 1' >/dev/null
}

main() {
  need_jq
  echo "Using TUG_BD_STATE=$TUG_BD_STATE"
  echo "Contract and workflow tests (bd-fake):"
  run_test test_create_returns_issue || exit 1
  run_test test_show_returns_details_with_dependencies || exit 1
  run_test test_show_array_compatible || exit 1
  run_test test_dep_add_and_list_contract || exit 1
  run_test test_sync_like_creates_root_and_step_beads || exit 1
  run_test test_sync_like_dependency_edges_match_depends_on || exit 1
  run_test test_deterministic_ids_on_fresh_state || exit 1
  run_test test_status_readiness_from_show || exit 1
  run_test test_pull_data_status_field || exit 1
  run_test test_dep_list_authoritative_for_reconciliation || exit 1
  echo "All bd-fake integration tests passed."
}

main "$@"
