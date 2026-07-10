/**
 * Shared face formatter for the Z4B path chips — the `Project` chip and the
 * shell route's `Cwd` chip ([P10]). Both show a filesystem path in a
 * fixed-footprint two-line button; a long path collapses to its leaf, then
 * mid-truncates with an ellipsis so the chip never grows unbounded.
 */

/** Max characters shown in a path-chip face before truncation kicks in. */
export const PATH_CHIP_MAX_CHARS = 16;

/**
 * Format a directory path for a Z4B path-chip face. Shown verbatim when it
 * fits {@link PATH_CHIP_MAX_CHARS}; otherwise reduced to the leaf directory,
 * and if that still overflows, mid-truncated (`he…il`) reserving one char for
 * the ellipsis.
 */
export function formatPathChipText(
  dir: string,
  max: number = PATH_CHIP_MAX_CHARS,
): string {
  if (dir.length <= max) return dir;
  const leaf = dir.replace(/\/+$/, "").split("/").pop() ?? dir;
  if (leaf.length <= max) return leaf;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${leaf.slice(0, head)}…${leaf.slice(leaf.length - tail)}`;
}
