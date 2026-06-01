/**
 * memory-destinations.ts — the memory files/folders `/memory` offers to open
 * ([#step-12a]).
 *
 * Mirrors Claude Code's `/memory`: the project memory (`<cwd>/CLAUDE.md`,
 * checked in), the user memory (`~/.claude/CLAUDE.md`), and the auto-memory
 * folder (`~/.claude/projects/<encoded-cwd>/memory`). Selecting a row hands
 * the path to the OS (see {@link openPathInOS}) — read-only here, editing
 * happens in the OS editor.
 *
 * Pure: paths are derived from the session cwd alone. `~`-relative paths are
 * left for the host to expand (the web layer has no home dir). The auto-memory
 * folder encodes the cwd the same way Claude Code does (`/` → `-`), so it
 * resolves to the same on-disk directory.
 *
 * @module lib/memory-destinations
 */

/** A memory file or folder `/memory` can open in the OS. */
export interface MemoryDestination {
  /** Stable list key. */
  id: string;
  /** Row title, e.g. "Project memory". */
  label: string;
  /** Row subtitle — where it lives, e.g. "Checked in at ./CLAUDE.md". */
  detail: string;
  /** Path to open — absolute, or `~`-relative for the host to expand. */
  path: string;
  /** Whether the path is a file (opens in an editor) or a folder (Finder). */
  kind: "file" | "folder";
}

/**
 * Encode an absolute cwd into Claude Code's project-directory naming
 * convention (`/` → `-`). Mirrors `encodeProjectDir` in tugcode
 * (`session.ts` / `context-breakdown.ts`), so the auto-memory folder resolves
 * to the same directory Claude Code writes.
 */
export function encodeProjectDir(absDir: string): string {
  return absDir.replace(/\//g, "-");
}

/**
 * The memory destinations for the session's `cwd`. The user-memory row is
 * always present; the project + auto-memory rows need the cwd (Claude Code's
 * real resolved cwd — `system_metadata.cwd`), so they're omitted when it's
 * unknown. Order matches Claude Code's `/memory`: project, user, auto-memory.
 */
export function memoryDestinations(cwd: string | null): MemoryDestination[] {
  const dests: MemoryDestination[] = [];
  if (cwd !== null && cwd.length > 0) {
    dests.push({
      id: "project",
      label: "Project memory",
      detail: "Checked in at ./CLAUDE.md",
      path: `${cwd}/CLAUDE.md`,
      kind: "file",
    });
  }
  dests.push({
    id: "user",
    label: "User memory",
    detail: "Saved in ~/.claude/CLAUDE.md",
    path: "~/.claude/CLAUDE.md",
    kind: "file",
  });
  if (cwd !== null && cwd.length > 0) {
    dests.push({
      id: "auto",
      label: "Auto-memory folder",
      detail: "Per-conversation memory entries",
      path: `~/.claude/projects/${encodeProjectDir(cwd)}/memory`,
      kind: "folder",
    });
  }
  return dests;
}
