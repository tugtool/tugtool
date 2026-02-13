#!/bin/bash
# Auto-approve tugtool plugin Skill and Task invocations
#
# For Skill tool: checks if skill name starts with "tugtool:"
# For Task tool: checks if subagent_type starts with "tugtool:"

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

# Check if this is a tugtool component
IS_TUG=false

if [ "$TOOL_NAME" = "Skill" ]; then
  SKILL_NAME=$(echo "$INPUT" | jq -r '.tool_input.skill // empty')
  if [[ "$SKILL_NAME" == tugtool:* ]]; then
    IS_TUG=true
  fi
elif [ "$TOOL_NAME" = "Task" ]; then
  AGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // empty')
  if [[ "$AGENT_TYPE" == tugtool:* ]]; then
    IS_TUG=true
  fi
fi

if [ "$IS_TUG" = true ]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Tugtool plugin component auto-approved"
    }
  }'
else
  # Not a tugtool component - let normal permission flow handle it
  exit 0
fi
