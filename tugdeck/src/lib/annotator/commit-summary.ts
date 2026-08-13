/**
 * `commitSummary` — what a hover over a commit sha says.
 *
 * A sha is the least self-describing thing in transcript ink: eight
 * characters of hex that name a specific, knowable change and tell you
 * nothing about it. Everywhere else the annotator can lean on the text —
 * a path says what file it is — but a hash has to be described, and the
 * answer that verified it already carries the description
 * ({@link CommitFacts}).
 *
 * So the summary leads with the subject, because that is the commit's own
 * name for itself, then attributes it, then says what it touched: the file
 * count and the ± totals, then the files themselves. The list is capped —
 * a hover is a glance, not a diff — and a truncated list says how many it
 * dropped rather than trailing off, so the reader knows the shape of what
 * they are not seeing.
 *
 * Plain text with newlines, because the consumer is a `title` attribute:
 * the inline marks are stamped imperatively onto DOM the annotator walks
 * (no React element to hang a tooltip component on), and the trailing
 * chips are in a different tree again. One formatter, one string, both
 * surfaces — a hover that differed between them would be two designs.
 *
 * Pure; every branch is exercised by the unit suite.
 *
 * @module lib/annotator/commit-summary
 */

import type { CommitFacts } from "./commit-resolution";

/** How many files a hover lists before it starts counting instead. */
const FILE_LIMIT = 8;

/** Short display form of a sha — git's own abbreviation length. */
export const COMMIT_LABEL_LENGTH = 8;

/** `git show`'s status words, as a single character for the hover's list. */
const STATUS_MARK: Record<string, string> = {
  created: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

/** `+12 −3`, or the empty string when nothing changed textually (a binary). */
function countsOf(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`−${removed}`);
  return parts.join(" ");
}

/** `3 files changed, +40 −12` — the commit's shape in one line. */
function statLine(facts: CommitFacts): string {
  const n = facts.files.length;
  let added = 0;
  let removed = 0;
  for (const file of facts.files) {
    added += file.added;
    removed += file.removed;
  }
  const noun = n === 1 ? "file" : "files";
  const counts = countsOf(added, removed);
  return counts === ""
    ? `${n} ${noun} changed`
    : `${n} ${noun} changed, ${counts}`;
}

/**
 * The hover text for a confirmed commit: subject, attribution, shape, and
 * the files themselves. `sha` is shown in full — the hover is where the
 * whole hash belongs, since the chip only ever shows its first eight.
 */
export function commitSummary(sha: string, facts: CommitFacts): string {
  const lines: string[] = [];
  // The subject is the commit's own name for itself and leads for that
  // reason. A commit with none (an empty message) still gets a first line,
  // so the hover never opens on blank space.
  lines.push(facts.subject === "" ? sha : facts.subject);
  const attribution = [facts.author, facts.date].filter((s) => s !== "");
  if (attribution.length > 0) lines.push(attribution.join(" · "));
  lines.push(sha);
  lines.push("");
  lines.push(statLine(facts));
  for (const file of facts.files.slice(0, FILE_LIMIT)) {
    const mark = STATUS_MARK[file.status] ?? "M";
    const counts = countsOf(file.added, file.removed);
    lines.push(
      counts === ""
        ? `  ${mark}  ${file.path}`
        : `  ${mark}  ${file.path}  ${counts}`,
    );
  }
  const hidden = facts.files.length - FILE_LIMIT;
  if (hidden > 0) lines.push(`  … and ${hidden} more`);
  return lines.join("\n");
}
