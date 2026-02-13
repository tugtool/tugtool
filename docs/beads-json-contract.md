# Beads JSON Contract (Tugtool)

This document is the **minimal contract** between Tugtool and the Beads CLI (or a mock `bd` in tests). All parsing of `bd ... --json` output and all fake `bd` implementations MUST conform to this.

**Normative source:** [.tugtool/tugplan-1.md §1.0.1.6 Beads JSON Contract](../.tugtool/tugplan-1.md#beads-json-contract-normative).

## Commands and output shapes

| Command | Output shape | Fields Tugtool reads |
|---------|--------------|---------------------|
| `bd create --json` | Single object (Issue) | `id`, `title`, `description`, `status`, `priority`, `issue_type` |
| `bd show <id> --json` | **Array** of IssueDetails (one element) **or** single IssueDetails object | `id`, `title`, `status`, `priority`, `issue_type`; `dependencies[].id`, `dependencies[].dependency_type` |
| `bd dep list <id> --json` | Array of IssueWithDependencyMetadata | `id`, `dependency_type` (per direct dep) |
| `bd dep add` / `bd dep remove` with `--json` | Small object | `status`; optionally `issue_id`, `depends_on_id`, `type` |
| `bd ready [--parent <id>] --json` | Array of Issue objects (open, unblocked) | `id`, `title`, `status`, `priority` |
| `bd close <id> [--reason "..."]` | (no output on success) | Sets status to closed |
| `bd sync` | (no output) | Flushes state to JSONL |

## Parsing rules

- **`bd show`:** If the response is a JSON array, use the first element. If it is a single object, use it as-is. Do not assume one or the other.
- **Field stability:** Only rely on the fields listed above. Other fields may be present but must be ignored for contract compliance.
- **Bead ID format:** For regex-only validation use `^[a-z0-9][a-z0-9-]*-[a-z0-9]+(\.[0-9]+)*$`. When Beads is available, existence can be verified with `bd show <id> --json`.

## Mock-bd requirements

A fake `bd` used in tests must:

1. Accept `bd create [--parent <id>] --json` and return a single Issue object with at least `id`, `title`, `status`, `priority`, `issue_type`.
2. Accept `bd show <id> --json` and return either a one-element array or a single object with `id`, `title`, `status`, `priority`, `issue_type`, and `dependencies` (array of `{ id, dependency_type }`).
3. Accept `bd dep list <id> --json` and return an array of objects with `id`, `dependency_type`.
4. Accept `bd dep add <from> <to> [--type blocks]` and optionally `bd dep remove <from> <to>`; `--json` output a small object with `status`.
5. Accept `bd ready [--parent <id>] --json` and return an array of open issues whose dependencies are all closed (i.e., unblocked work).
6. Accept `bd close <id> [--reason "..."]` and set the issue's status to "closed".
7. Accept `bd sync` as a no-op (state is already persisted in the mock).

State: the fake must persist issues and edges (e.g. in-memory or a temp JSON file) so that create → show → dep list → ready → close behave consistently.
