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
  return (await probeDirs(paths)).exists;
}

/**
 * The full `/api/fs/stat` answer for a batch of directory paths: existence
 * keyed by the path as sent, plus the server's canonical spelling for each
 * reachable one.
 *
 * The canonical map is what makes two spellings of the same directory
 * recognizable as one. Tug is routinely reached through more than one path to
 * the same tree — a home-relative mount and its short symlink, `/tmp` and
 * `/private/tmp`, a firmlink — and the recent-projects list records whichever
 * spelling was used at the time. Only the server can resolve them ([L29] — the
 * frontend never mints a canonical form of its own), so a caller that needs
 * identity rather than existence asks for it here.
 */
export async function probeDirs(
  paths: readonly string[],
): Promise<{
  exists: Record<string, boolean>;
  canonical: Record<string, string>;
}> {
  if (paths.length === 0) return { exists: {}, canonical: {} };
  try {
    const res = await fetch("/api/fs/stat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths, kind: "dir" }),
    });
    if (!res.ok) return { exists: {}, canonical: {} };
    const body = (await res.json()) as {
      exists?: unknown;
      canonical?: unknown;
    };
    const exists: Record<string, boolean> = {};
    if (body.exists !== null && typeof body.exists === "object") {
      for (const [path, value] of Object.entries(
        body.exists as Record<string, unknown>,
      )) {
        exists[path] = value === true;
      }
    }
    const canonical: Record<string, string> = {};
    if (body.canonical !== null && typeof body.canonical === "object") {
      for (const [path, value] of Object.entries(
        body.canonical as Record<string, unknown>,
      )) {
        if (typeof value === "string" && value !== "") canonical[path] = value;
      }
    }
    return { exists, canonical };
  } catch {
    return { exists: {}, canonical: {} };
  }
}
