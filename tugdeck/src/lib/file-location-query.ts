/**
 * file-location-query.ts — parse a pasted or typed file reference into a
 * searchable path plus an optional line to reveal.
 *
 * Open Quickly accepts what a person actually has on the clipboard: the
 * `file:line` form every compiler, linter, stack trace, and grep hit emits,
 * and the absolute paths the shell and the file dialogs hand out. The search
 * index (FILETREE) keys on project-relative POSIX paths, so this normalizes
 * to that shape and hands the line back separately for the reveal.
 *
 * Handled forms (`:col` is parsed off and discarded — the reveal is
 * line-granular):
 *
 *   tug-list-view.tsx:123          → { search: "tug-list-view.tsx", line: 123 }
 *   src/lib/foo.ts:12:30           → { search: "src/lib/foo.ts",    line: 12 }
 *   /abs/root/src/lib/foo.ts:12    → { search: "src/lib/foo.ts",    line: 12 }
 *   ./src/lib/foo.ts               → { search: "src/lib/foo.ts" }
 *   "src/lib/foo.ts:12"            → { search: "src/lib/foo.ts",    line: 12 }
 *
 * The suffix is only stripped when a non-empty path remains, so a bare `123`
 * still searches for files named `123` rather than parsing to nothing.
 *
 * @module lib/file-location-query
 */

/** A file reference split into its search term and its optional location. */
export interface FileLocationQuery {
  /** The path to search the file index for — relative, unquoted, untrimmed of nothing else. */
  search: string;
  /** 1-based line to reveal on open, when the reference carried one. */
  line?: number;
}

/** `path`, `path:line`, or `path:line:col`. */
const LOCATION_SUFFIX = /^(.*?):(\d+)(?::(\d+))?$/;

/** Wrapping quotes a paste from a shell or a JSON blob drags along. */
const WRAPPING_QUOTES = /^["'`](.*)["'`]$/;

/**
 * Strip `root` off `path` when `path` sits inside it, yielding the
 * project-relative form FILETREE indexes. A path outside the root is
 * returned unchanged.
 */
function relativize(path: string, root: string | null): string {
  if (root === null || root === "") return path;
  const base = root.replace(/\/+$/, "");
  if (path === base) return "";
  if (path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  return path;
}

/**
 * Parse one file reference. `projectRoot` (when known) lets an absolute path
 * inside the project collapse to its relative form so the fuzzy index can
 * match it.
 */
export function parseFileLocationQuery(
  raw: string,
  projectRoot: string | null = null,
): FileLocationQuery {
  let text = raw.trim();

  const unquoted = WRAPPING_QUOTES.exec(text);
  if (unquoted !== null) text = unquoted[1].trim();

  let line: number | undefined;
  const located = LOCATION_SUFFIX.exec(text);
  // Only take the suffix when a path survives it — a bare "123" is a search
  // for a file named 123, not a line number with no file.
  if (located !== null && located[1].trim() !== "") {
    text = located[1].trim();
    const parsed = Number.parseInt(located[2], 10);
    if (parsed > 0) line = parsed;
  }

  text = relativize(text, projectRoot);
  // A leading "./" is noise, and a leading "/" survives only on a path
  // outside the project — either way the index keys on the bare relative form.
  text = text.replace(/^\.\//, "").replace(/^\/+/, "");

  return line === undefined ? { search: text } : { search: text, line };
}
