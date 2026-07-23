/**
 * dir-existence.ts — client for `POST /api/fs/stat` with `kind: "dir"`, the
 * batched directory-existence probe.
 *
 * The session picker's PROJECT PATH combo box seeds its dropdown from the
 * stored recent-project paths (tugbank `recent-projects`). Some of those
 * directories may have been deleted or moved since they were recorded; opening
 * one dead-ends at the "Can't open project" screen. This probe answers "does
 * this directory still exist?" for a batch of paths in one round trip so the
 * picker can drop the gone ones from the dropdown up front.
 *
 * Best-effort: any transport or shape error yields `{}` (all paths treated as
 * present), so a probe failure degrades to showing every recent rather than
 * hiding good ones.
 *
 * @module lib/dir-existence
 */

/**
 * Probe `paths` for directory existence. Returns a map from each input path to
 * whether it resolves to a directory on disk. Paths absent from the map (e.g.
 * on transport failure, or beyond the server's per-batch cap) are unknown and
 * should be treated as present by callers.
 */
export async function probeDirExistence(
  paths: readonly string[],
): Promise<Record<string, boolean>> {
  if (paths.length === 0) return {};
  try {
    const res = await fetch("/api/fs/stat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths, kind: "dir" }),
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { exists?: unknown };
    const exists = body.exists;
    if (exists === null || typeof exists !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [path, value] of Object.entries(exists as Record<string, unknown>)) {
      out[path] = value === true;
    }
    return out;
  } catch {
    return {};
  }
}
