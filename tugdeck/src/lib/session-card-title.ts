/**
 * session-card-title.ts — the shared session identity label.
 *
 * `<project-leaf>/<session-label> (<branch>)`, where the session label follows
 * the same name → tag precedence as the Z4B chip ({@link sessionChipDisplay}):
 * a `/rename` custom name wins, the mnemonic tag shows for the common un-renamed
 * case, and the label is dropped when the session has neither. The `(<branch>)`
 * suffix is omitted on `main` (the common case) and when the branch is unknown.
 *
 * This one label is used BOTH as the Session card's pane title-bar override AND
 * as the Lens Sessions monitor row's name, so the two always read identically.
 *
 * Pure string logic — no React, no DOM, no store. Unit-testable in isolation.
 *
 * @module lib/session-card-title
 */

/**
 * The trailing path component (basename) of a directory: the project's
 * leaf-name identity in the title bar. Trailing slashes are ignored; an empty
 * or slash-only path yields the trimmed input.
 */
export function projectLeafName(dir: string): string {
  const trimmed = dir.replace(/\/+$/, "");
  const leaf = trimmed.split("/").pop() ?? "";
  return leaf.length > 0 ? leaf : trimmed;
}

/**
 * The shared session identity label: `<project>/<label> (<branch>)`. The label
 * follows name → tag precedence; it is dropped when the session has neither
 * (blank name/tag are unset). The `(<branch>)` suffix is omitted on `main` and
 * when `branch` is null/blank. Used for both the card title bar and the Lens
 * monitor row.
 */
export function sessionCardTitleOverride(
  projectDir: string,
  name: string | null,
  tag: string | null,
  branch: string | null,
): string {
  const project = projectLeafName(projectDir);
  const label = name?.trim() || tag?.trim() || "";
  const base = label.length > 0 ? `${project}/${label}` : project;
  const b = branch?.trim() ?? "";
  return b.length > 0 && b !== "main" ? `${base} (${b})` : base;
}
