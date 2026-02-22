#!/bin/bash
# Ensure tugplug is initialized before tugplug agents run.
# Hooks PreToolUse:Task — fires right before the first agent is spawned.
# Runs `tugcode init --quiet` as a side effect — milliseconds, no API call.
# Idempotent: if .tugtool/ exists, tugcode init is a no-op.
#
# IMPORTANT: Always run from the git repo root, not from whatever CWD
# the Bash tool happens to have (which may be a worktree). Running
# tugcode init inside a worktree can have destructive side effects.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

if [ "$TOOL_NAME" = "Task" ]; then
  AGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // empty')
  if [[ "$AGENT_TYPE" == tugplug:* ]]; then
    REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
    if [ -n "$REPO_ROOT" ]; then
      (cd "$REPO_ROOT" && tugcode init --quiet 2>/dev/null) || true
    fi
  fi
fi

# No JSON output — don't interfere with permission decisions
exit 0
