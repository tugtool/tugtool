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

/** One directory completion: a display `label` and the `value` to set the input to. */
export interface DirCompletion {
  /** Basename with a trailing slash, e.g. `private/` — what the user sees. */
  label: string;
  /** Full drop-in input value, e.g. `/abs/private/` or `../private/`. */
  value: string;
}

/** Narrow an unknown entry to a `DirCompletion`, or `null` if malformed. */
function coerceCompletion(entry: unknown): DirCompletion | null {
  if (entry === null || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  if (typeof obj.label !== "string" || typeof obj.value !== "string") return null;
  return { label: obj.label, value: obj.value };
}

/**
 * Fetch directory completions for `partial` resolved under `base`. Returns the
 * matching child directories, or `[]` on any error / non-OK response.
 */
export async function fetchDirectoryCompletions(
  base: string,
  partial: string,
): Promise<DirCompletion[]> {
  try {
    const res = await fetch(
      `/api/fs/complete?base=${encodeURIComponent(base)}&partial=${encodeURIComponent(partial)}`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { completions?: unknown };
    if (!Array.isArray(body.completions)) return [];
    return body.completions
      .map(coerceCompletion)
      .filter((c): c is DirCompletion => c !== null);
  } catch {
    return [];
  }
}
