# Tugplug Plugin Guidelines

## Tugstate Policy

Tugstate tracks per-step state in an embedded SQLite database. Agents do not call `tugcode state` commands directly -- all state management is handled by the orchestrator (implement skill). Agents receive step context from the orchestrator and return structured JSON output; the orchestrator is responsible for heartbeats, checklist updates, artifact recording, and step completion.

## Plan Mode Policy

**DO NOT automatically enter Plan mode.** Never use `EnterPlanMode` unless the user explicitly asks for it. Just do the work directly.
