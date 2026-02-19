#!/bin/bash
# Auto-approve tugplug plugin invocations and safe Bash commands
#
# For Skill tool: checks if skill name starts with "tugplug:"
# For Task tool: checks if subagent_type starts with "tugplug:"
# For Bash tool: checks if command starts with a safe prefix

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

APPROVE=false

if [ "$TOOL_NAME" = "Skill" ]; then
  SKILL_NAME=$(echo "$INPUT" | jq -r '.tool_input.skill // empty')
  if [[ "$SKILL_NAME" == tugplug:* ]]; then
    APPROVE=true
  fi
elif [ "$TOOL_NAME" = "Task" ]; then
  AGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // empty')
  if [[ "$AGENT_TYPE" == tugplug:* ]]; then
    APPROVE=true
  fi
elif [ "$TOOL_NAME" = "Bash" ]; then
  CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
  # Strip leading whitespace
  CMD_TRIMMED=$(echo "$CMD" | sed 's/^[[:space:]]*//')
  # Check against safe command prefixes
  case "$CMD_TRIMMED" in
    grep\ *|grep)       APPROVE=true ;;
    ls\ *|ls)           APPROVE=true ;;
    tugtool\ *|tugtool) APPROVE=true ;;
    find\ *)            APPROVE=true ;;
  esac
fi

if [ "$APPROVE" = true ]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Tugtool plugin auto-approved"
    }
  }'
else
  # Not matched - let normal permission flow handle it
  exit 0
fi
