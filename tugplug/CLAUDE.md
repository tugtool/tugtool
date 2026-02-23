# Tugplug Plugin Guidelines

## Beads Policy

Beads tracks per-step data in SQLite. Each agent's and skill's own instructions define its beads interactions — do not run beads commands beyond what your specific instructions say.

- Plan files are never modified by beads sync.
- `tugcode init` removes git hooks containing beads references.

## Plan Mode Policy

**DO NOT automatically enter Plan mode.** Never use `EnterPlanMode` unless the user explicitly asks for it. Just do the work directly.
