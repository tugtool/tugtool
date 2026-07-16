/**
 * session-card-title.ts — the pane title-bar override for a Session card.
 *
 * The pane chrome renders `"Session : <override>"`; this module builds the
 * `<override>` as `"<project-leaf> <session-label>"`, where the session label
 * follows the same name → tag precedence as the Z4B chip ({@link
 * sessionChipDisplay}): a `/rename` custom name wins, and the mnemonic tag
 * shows for the common un-renamed case. When the session has neither (a legacy
 * pre-tag session, or before the tag lands), the override is just the project
 * leaf.
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
 * The Session card's title-bar override: the project leaf followed by the
 * session's label (name → tag). Falls back to just the project leaf when the
 * session has neither a name nor a tag. Blank name/tag are treated as unset.
 */
export function sessionCardTitleOverride(
  projectDir: string,
  name: string | null,
  tag: string | null,
): string {
  const project = projectLeafName(projectDir);
  const label = name?.trim() || tag?.trim() || "";
  return label.length > 0 ? `Session: ${project}/${label}` : `Session: ${project}`;
}
