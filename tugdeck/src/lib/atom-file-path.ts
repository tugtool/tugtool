/**
 * atom-file-path.ts — the absolute path behind a `file` atom's value.
 *
 * A file atom does not carry an address; it carries whatever minted it. An
 * `@` mention takes its value straight from the FILETREE index, which
 * reports paths relative to the project root. Session ▸ Insert File… and
 * the transcript's Insert into Composer both carry absolute paths. So the
 * same chip type holds two different kinds of string, and any gesture that
 * acts on the file — opening it, revealing it — has to close that gap
 * before it hands the path to a service that only speaks absolute.
 *
 * The root is the project directory when the card is bound to one, because
 * that is the root the index counted from. The session cwd is the fallback:
 * a card with no project binding still runs somewhere, and a mention typed
 * there was written relative to that. With neither, the value is returned
 * as written rather than joined against a guess — an honest "unresolved"
 * that surfaces as the file service's own not-found, instead of an open on
 * some other file that happens to share the tail.
 *
 * @module lib/atom-file-path
 */

import { joinPath } from "./annotator/path-resolution";

/** The roots a relative atom value may be resolved against, in order. */
export interface AtomPathRoots {
  /** The card's project directory — the root the file index counts from. */
  projectDir: string | null;
  /** The session's working directory; `null` until the handshake lands. */
  cwd: string | null;
}

/**
 * The absolute path a `file` atom's value names. Absolute values are
 * normalized (so `.` / `..` segments collapse) and otherwise unchanged;
 * relative ones are joined onto the first available root.
 */
export function resolveAtomFilePath(
  value: string,
  roots: AtomPathRoots,
): string {
  if (value.startsWith("/")) return joinPath("/", value);
  const base = roots.projectDir ?? roots.cwd;
  return base === null ? value : joinPath(base, value);
}
