/**
 * fs-complete.ts — client for tugcast's `GET /api/fs/complete`, the directory
 * completion backing the `/permissions` Workspace tab's "Add directory" field.
 *
 * Given the session `base` (cwd) and the `partial` path typed so far, returns
 * the child directories of the partial's parent whose names prefix-match — the
 * graphical equivalent of the terminal's `Tab to complete`. Best-effort: any
 * transport or shape error yields `[]` so the form degrades to plain text
 * entry rather than throwing.
 *
 * @module lib/fs-complete
 */

/** What to complete: directories only, or files too (dirs still appear to descend). */
export type CompletionKind = "directory" | "file";

/** One filesystem completion: a display `label`, the `value` to set the input to, and whether it's a directory. */
export interface PathCompletion {
  /** Basename — directories carry a trailing slash, e.g. `private/`; files don't. */
  label: string;
  /** Full drop-in input value, e.g. `/abs/private/` or `../notes.md`. */
  value: string;
  /** True for a directory (descendable); false for a file. */
  isDir: boolean;
}

/** Narrow an unknown entry to a `PathCompletion`, or `null` if malformed. */
function coerceCompletion(entry: unknown): PathCompletion | null {
  if (entry === null || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  if (typeof obj.label !== "string" || typeof obj.value !== "string") return null;
  return { label: obj.label, value: obj.value, isDir: obj.isDir === true };
}

/**
 * Fetch filesystem completions for `partial` resolved under `base`. `kind`
 * "directory" (default) lists only child directories; "file" lists files too.
 * Returns the matches, or `[]` on any error / non-OK response.
 */
export async function fetchPathCompletions(
  base: string,
  partial: string,
  kind: CompletionKind = "directory",
): Promise<PathCompletion[]> {
  try {
    const res = await fetch(
      `/api/fs/complete?base=${encodeURIComponent(base)}&partial=${encodeURIComponent(partial)}&kind=${encodeURIComponent(kind)}`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { completions?: unknown };
    if (!Array.isArray(body.completions)) return [];
    return body.completions
      .map(coerceCompletion)
      .filter((c): c is PathCompletion => c !== null);
  } catch {
    return [];
  }
}
