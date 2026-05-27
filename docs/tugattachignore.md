# `.tugattachignore`

Workspace-local file that keeps additional paths out of Tide's `@`-completion popup. Same syntax as `.gitignore` (parsed by the [`ignore`](https://docs.rs/ignore) crate). Optional; a workspace without one falls back to Tide's [built-in denylist](../tugrust/crates/tugcast/src/feeds/secret_filter.rs).

## Where it lives

At the workspace root: `<workspace>/.tugattachignore`. Nested files are not honored — keep all entries in the one root file.

## Syntax

Standard gitignore patterns:

```
# Comments start with `#`
local-secrets/        # entire directory excluded
*.draft               # any file with the extension
plans/private/*.md    # all .md files in a specific subtree
!plans/private/README.md   # negation re-includes
```

## What's filtered

`@`-completion suggestions in the Tide prompt entry. Files matched by `.tugattachignore` never appear in the popup. The built-in denylist (`.env`, `*.pem`, `id_rsa*`, `**/.ssh/**`, and similar — see [List L01](../roadmap/tide-atoms.md#l01-secret-file-denylist)) applies on top, regardless of whether `.tugattachignore` exists.

Already-`.gitignored` paths are filtered upstream by the workspace walker. `.tugattachignore` adds to that — it's for files that are checked into the repo but shouldn't show up in completion.

## What's NOT filtered

- **Manually-typed paths.** Users who type `@plans/private/notes.md` directly still send the path as text. This mirrors Claude Code's posture: the terminal would also have surfaced the path had the user typed it. See [Risk R04](../roadmap/tide-atoms.md#r04-manual-path-leak).
- **Tool reads.** Claude's `Read` tool gates apply to the path independently; `.tugattachignore` is a UI-side hint, not a security boundary.

## Editing

Edits to `.tugattachignore` are picked up live: the filetree watcher detects the change, the filter rebuilds, and the next `@`-completion query reflects the new rules. No restart needed.

## Parse errors

A malformed line is dropped and logged via `tugcast`'s tracing channel; the remaining valid lines still apply. The file is never silently disabled — one bad pattern doesn't break the whole filter. See [Table T01](../roadmap/tide-atoms.md#t01-failure-modes).
