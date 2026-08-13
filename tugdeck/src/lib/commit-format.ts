/**
 * Commit formatting — the one vocabulary for stating a commit's shape.
 *
 * "What did this commit touch?" is answered on five surfaces: the hover over
 * a sha, the History shade's rows, the `/commit` receipt's stat badges, the
 * Changes sheet header, and the copy payload. Each grew its own spelling of
 * the same three facts — a status mark, a ± pair, and a file count — so the
 * same commit could read `33 files changed, +3461 −128` in one place and
 * `33 files changed +3461 −128` two inches away.
 *
 * This module owns the parts, and the sentences are assembled from them here
 * rather than at each call site. Two status vocabularies arrive at the door
 * ({@link GitCommitFile}'s words, {@link CommitFile}'s letters), so
 * {@link statusMark} accepts both and answers in letters.
 *
 * Pure and presentation-only: nothing here knows where its facts came from.
 *
 * @module lib/commit-format
 */

/**
 * A changed file, as any surface knows it. Structural on purpose — the
 * commit-files store, the receipt parser, and the annotator's facts all
 * satisfy it without importing each other's types.
 */
export interface CommitFileShape {
  /** Path relative to the repo root (rename destination when renamed). */
  path: string;
  /** A status word (`modified`) or an already-abbreviated mark (`M`). */
  status: string;
  /** Added line count; `0` for a binary file. */
  added: number;
  /** Removed line count; `0` for a binary file. */
  removed: number;
}

/** Short display form of a sha — git's own abbreviation length. */
export const COMMIT_LABEL_LENGTH = 8;

/** How many files a hover lists before it starts counting instead. */
export const HOVER_FILE_LIMIT = 8;

/** `git show`'s status words, as the single character a roster shows. */
const STATUS_WORD_MARK: Record<string, string> = {
  created: "A",
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

/**
 * The one-letter mark for a file's status. Accepts either vocabulary — a
 * status word (`created`) or a mark that is already a letter (`A`) — and
 * falls back to `M`, the status a file most often has.
 */
export function statusMark(status: string): string {
  const word = STATUS_WORD_MARK[status.toLowerCase()];
  if (word !== undefined) return word;
  const trimmed = status.trim();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return "M";
}

/**
 * `+12 −3`, dropping a side that contributed nothing, and empty when the
 * file changed no lines at all (a binary, a pure rename). Uses the real
 * minus sign (U+2212) so the pair aligns under a tabular font.
 */
export function deltaCounts(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`−${removed}`);
  return parts.join(" ");
}

/** `3 files` / `1 file` — the count with its noun agreeing. */
export function fileCountLabel(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

/** The ± totals across a roster. */
export function totalsOf(files: readonly CommitFileShape[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    added += file.added;
    removed += file.removed;
  }
  return { added, removed };
}

/**
 * `3 files changed, +40 −12` — the commit's shape in one line, and the
 * sentence every surface states it with. The tail is dropped when nothing
 * changed textually, leaving `3 files changed`.
 */
export function statLineFrom(count: number, added: number, removed: number): string {
  const counts = deltaCounts(added, removed);
  const head = `${fileCountLabel(count)} changed`;
  return counts === "" ? head : `${head}, ${counts}`;
}

/** {@link statLineFrom} over a roster, which carries its own totals. */
export function statLine(files: readonly CommitFileShape[]): string {
  const { added, removed } = totalsOf(files);
  return statLineFrom(files.length, added, removed);
}

/** One roster line's parts: `M  path/to/file  +12 −3`. */
export interface RosterEntry {
  path: string;
  mark: string;
  /** `+12 −3`, or empty when the file changed no lines. */
  counts: string;
}

/**
 * The roster a glance shows: up to `limit` files, and how many were left
 * out. A hover is a glance, not a diff — so the list is capped, and a capped
 * list says how many it dropped rather than trailing off, so the reader
 * knows the shape of what they are not seeing.
 */
export function commitRoster(
  files: readonly CommitFileShape[],
  limit: number = HOVER_FILE_LIMIT,
): { entries: RosterEntry[]; hidden: number } {
  const entries = files.slice(0, limit).map((file) => ({
    path: file.path,
    mark: statusMark(file.status),
    counts: deltaCounts(file.added, file.removed),
  }));
  return { entries, hidden: Math.max(0, files.length - limit) };
}
