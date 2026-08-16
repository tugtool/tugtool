/**
 * relative-path — shorten a path for DISPLAY against the root it sits under.
 *
 * A result list drawn from one workspace repeats that workspace's absolute
 * prefix on every row, where it carries no information and costs the width the
 * filename needs. Stripping it is a rendering decision only: the payload a row
 * hands to `OPEN_FILE` stays absolute ([P15]), and a path that does NOT sit
 * under the root comes back untouched rather than mangled — an unexpected path
 * is exactly the one worth showing in full.
 *
 * @module lib/relative-path
 */

/**
 * `path` with `root`'s prefix removed, or `path` unchanged when it does not
 * sit under `root` (or when there is no root to measure against).
 */
export function pathRelativeTo(path: string, root: string): string {
  if (root === "") return path;
  const base = root.replace(/\/+$/, "");
  if (base === "") return path;
  if (!path.startsWith(`${base}/`)) return path;
  const relative = path.slice(base.length + 1);
  // A path that IS the root has no remainder to show; keep it whole.
  return relative === "" ? path : relative;
}
