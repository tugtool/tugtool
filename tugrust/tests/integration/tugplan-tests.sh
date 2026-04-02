#!/usr/bin/env bash
# Integration tests for the `tugtool tugplan` command.
# Exercises the planning loop with the mock claude CLI.
#
# Run from repo root: tests/integration/tugplan-tests.sh
# Or with verbose output: VERBOSE=1 tests/integration/tugplan-tests.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TUGTOOL_BIN="${REPO_ROOT}/target/debug/tugtool"
CLAUDE_MOCK="${REPO_ROOT}/tests/bin/claude-mock-plan"

# Test temp directory
TEST_TMPDIR="${TEST_TMPDIR:-$(mktemp -d "${TMPDIR:-/tmp}/tug-tugplan-tests.XXXXXX")}"

# State file for mock
MOCK_STATE="${TEST_TMPDIR}/mock-state"

verbose() {
    if [[ -n "$VERBOSE" ]]; then
        echo "  [verbose] $*"
    fi
}

cleanup() {
    rm -rf "$TEST_TMPDIR"
}
trap cleanup EXIT

# Build tug if needed
build_tug() {
    if [[ ! -f "$TUGTOOL_BIN" ]]; then
        echo "Building tug..."
        (cd "$REPO_ROOT" && cargo build --quiet)
    fi
}

# Create a test project directory with .tugtool initialized
create_test_project() {
    local project_dir="$1"
    mkdir -p "$project_dir/.tugtool"
    mkdir -p "$project_dir/agents"

    # Create minimal agent definitions (needed by AgentRunner)
    for agent in clarifier-agent author-agent critic-agent; do
        cat > "$project_dir/agents/${agent}.md" << EOF
---
name: $agent
description: Mock $agent for testing
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a mock $agent for integration testing.
EOF
    done

    # Create minimal config
    cat > "$project_dir/.tugtool/config.toml" << 'EOF'
[tug]
validation_level = "default"
EOF
}

run_test() {
    local name="$1"
    shift
    echo -n "  $name ... "
    # Reset mock state
    rm -f "$MOCK_STATE"
    export TUG_CLAUDE_MOCK_PLAN_STATE="$MOCK_STATE"

    if ( "$@" ); then
        echo "ok"
        return 0
    else
        echo "FAIL"
        return 1
    fi
}

# --- Test: plan command requires initialization ---
test_plan_requires_init() {
    local test_dir="${TEST_TMPDIR}/no-init"
    mkdir -p "$test_dir"
    cd "$test_dir"

    # Running plan without .tugtool should fail with exit code 9
    if "$TUGTOOL_BIN" plan "test idea" 2>&1; then
        return 1  # Should have failed
    fi
    local exit_code=$?
    [[ $exit_code -eq 9 ]]
}

# --- Test: plan command with no input shows error ---
test_plan_no_input() {
    local test_dir="${TEST_TMPDIR}/no-input"
    create_test_project "$test_dir"
    cd "$test_dir"

    # Running plan without input should fail
    if "$TUGTOOL_BIN" plan 2>&1; then
        return 1  # Should have failed
    fi
    local exit_code=$?
    [[ $exit_code -eq 1 ]]
}

# --- Test: plan --help works ---
test_plan_help() {
    "$TUGTOOL_BIN" plan --help 2>&1 | grep -q "iterative agent collaboration"
}

# --- Test: plan JSON error output ---
test_plan_json_error() {
    local test_dir="${TEST_TMPDIR}/json-error"
    mkdir -p "$test_dir"
    cd "$test_dir"

    local output
    output=$("$TUGTOOL_BIN" --json plan "test idea" 2>&1 || true)
    verbose "Output: $output"

    # Should be valid JSON with error
    echo "$output" | jq -e '.status == "error"' >/dev/null
    echo "$output" | jq -e '.issues[0].code == "E009"' >/dev/null
}

# --- Test: plan detects Claude CLI not installed ---
test_plan_claude_not_installed() {
    local test_dir="${TEST_TMPDIR}/no-claude"
    create_test_project "$test_dir"
    cd "$test_dir"

    # Set PATH to exclude claude
    local old_path="$PATH"
    export PATH="/nonexistent:$PATH"

    local exit_code=0
    "$TUGTOOL_BIN" plan "test idea" 2>&1 || exit_code=$?

    export PATH="$old_path"
    [[ $exit_code -eq 6 ]]  # E019 exit code
}

# --- Test: plan with mock claude completes (integration test, requires mock in PATH) ---
test_plan_with_mock_completes() {
    local test_dir="${TEST_TMPDIR}/mock-complete"
    create_test_project "$test_dir"
    cd "$test_dir"

    # Add mock directory to PATH (as "claude")
    mkdir -p "${test_dir}/bin"
    cp "$CLAUDE_MOCK" "${test_dir}/bin/claude"
    chmod +x "${test_dir}/bin/claude"
    export PATH="${test_dir}/bin:$PATH"

    # Run plan with mock - should complete successfully
    verbose "Running: tugtool tugplan 'add a test feature' --name test-feature"
    local output exit_code=0
    output=$("$TUGTOOL_BIN" plan "add a test feature" --name test-feature 2>&1) || exit_code=$?
    verbose "Output: $output"
    verbose "Exit code: $exit_code"

    # Check exit code
    if [[ $exit_code -ne 0 ]]; then
        verbose "Failed with exit code $exit_code"
        return 1
    fi

    # Check that plan file was created
    if [[ ! -f "${test_dir}/.tugtool/plan-test-feature.md" ]]; then
        verbose "Plan file not created"
        return 1
    fi

    verbose "Plan file created successfully"
    return 0
}

# --- Test: plan with abort ---
test_plan_with_abort() {
    local test_dir="${TEST_TMPDIR}/mock-abort"
    create_test_project "$test_dir"
    cd "$test_dir"

    # Add mock directory to PATH
    mkdir -p "${test_dir}/bin"
    cp "$CLAUDE_MOCK" "${test_dir}/bin/claude"
    chmod +x "${test_dir}/bin/claude"
    export PATH="${test_dir}/bin:$PATH"

    # Configure mock to abort
    export TUG_CLAUDE_MOCK_PLAN_ABORT="true"

    local exit_code=0
    "$TUGTOOL_BIN" plan "test idea" --name abort-test 2>&1 || exit_code=$?

    unset TUG_CLAUDE_MOCK_PLAN_ABORT

    # Should exit with code 5 (user aborted)
    [[ $exit_code -eq 5 ]]
}

# --- Test: plan JSON output format ---
test_plan_json_output() {
    local test_dir="${TEST_TMPDIR}/json-output"
    create_test_project "$test_dir"
    cd "$test_dir"

    # Add mock directory to PATH
    mkdir -p "${test_dir}/bin"
    cp "$CLAUDE_MOCK" "${test_dir}/bin/claude"
    chmod +x "${test_dir}/bin/claude"
    export PATH="${test_dir}/bin:$PATH"

    local output
    output=$("$TUGTOOL_BIN" --json plan "test idea" --name json-test 2>&1)
    verbose "Output: $output"

    # Should be valid JSON
    echo "$output" | jq -e '.schema_version == "1"' >/dev/null
    echo "$output" | jq -e '.command == "plan"' >/dev/null
    echo "$output" | jq -e '.status == "ok" or .status == "error"' >/dev/null

    # If successful, check data structure
    if echo "$output" | jq -e '.status == "ok"' >/dev/null 2>&1; then
        echo "$output" | jq -e '.data.plan_name' >/dev/null
        echo "$output" | jq -e '.data.mode' >/dev/null
        echo "$output" | jq -e '.data.iterations' >/dev/null
    fi
}

main() {
    echo "Using TEST_TMPDIR=$TEST_TMPDIR"
    build_tug

    echo "Plan command integration tests:"
    run_test test_plan_help || exit 1
    run_test test_plan_requires_init || exit 1
    run_test test_plan_no_input || exit 1
    run_test test_plan_json_error || exit 1
    run_test test_plan_claude_not_installed || exit 1

    # Skip mock-dependent tests if claude-mock-plan doesn't exist
    if [[ -f "$CLAUDE_MOCK" && -x "$CLAUDE_MOCK" ]]; then
        run_test test_plan_with_mock_completes || exit 1
        run_test test_plan_with_abort || exit 1
        run_test test_plan_json_output || exit 1
    else
        echo "  (skipping mock-dependent tests: $CLAUDE_MOCK not found)"
    fi

    echo "All plan command integration tests passed."
}

main "$@"
