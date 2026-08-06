/**
 * fs-mkdir.ts — client for `POST /api/fs/mkdir`, tugcast's create-a-directory
 * endpoint.
 *
 * The default project directory is created lazily rather than at boot: when
 * the user accepts the ConfigureTug projects-folder step, and again before the
 * first workspace acquisition in case it was deleted since. Both callers want
 * the same thing — "make sure this exists" — and both tolerate it already
 * existing, which the server reports as success.
 *
 * @module lib/fs-mkdir
 */

/**
 * Create `path` and any missing parents. Resolves `true` when the directory
 * exists afterwards (including when it already did), `false` on any rejection
 * or transport failure — the caller decides whether that is fatal.
 */
export async function makeDirectory(path: string): Promise<boolean> {
  if (path === "") return false;
  try {
    const res = await fetch("/api/fs/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
